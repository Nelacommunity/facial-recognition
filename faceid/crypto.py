"""Encryption of face embeddings before they leave the Python worker.

Each vector is serialized as little-endian float32 with a small header and encrypted with
Fernet (AES-128-CBC + HMAC-SHA256) using FACEID_ENCRYPTION_KEY. Only the resulting tokens are
stored in Supabase, so the database (and the TypeScript server) never see plaintext vectors.

Threat model: protects embeddings against anyone who can read the database but not the key
(a leaked backup, a Supabase dashboard user, an over-broad policy). It does not protect against
someone who has both the database and the key.
"""

from __future__ import annotations

import struct

import numpy as np
from cryptography.fernet import Fernet, InvalidToken

_MAGIC = b"FE1"
_HEADER = struct.Struct("<3sH")  # magic, dim


class CryptoError(Exception):
    pass


def serialize_embedding(vector: np.ndarray) -> bytes:
    arr = np.asarray(vector, dtype="<f4").reshape(-1)
    if arr.size == 0 or arr.size > 65535 or not np.all(np.isfinite(arr)):
        raise CryptoError("Invalid embedding vector.")
    return _HEADER.pack(_MAGIC, arr.size) + arr.tobytes()


def deserialize_embedding(blob: bytes) -> np.ndarray:
    if len(blob) < _HEADER.size:
        raise CryptoError("Embedding payload is truncated.")
    magic, dim = _HEADER.unpack_from(blob)
    if magic != _MAGIC or len(blob) != _HEADER.size + 4 * dim:
        raise CryptoError("Embedding payload is malformed.")
    return np.frombuffer(blob, dtype="<f4", offset=_HEADER.size, count=dim).astype(np.float32)


class EmbeddingCipher:
    def __init__(self, key: str | bytes):
        try:
            self._fernet = Fernet(key.encode() if isinstance(key, str) else key)
        except (ValueError, TypeError) as exc:
            raise CryptoError(
                "FACEID_ENCRYPTION_KEY is not a valid Fernet key. Generate one with: "
                'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            ) from exc

    def encrypt(self, vector: np.ndarray) -> str:
        return self._fernet.encrypt(serialize_embedding(vector)).decode("ascii")

    def decrypt(self, token: str) -> np.ndarray:
        try:
            return deserialize_embedding(self._fernet.decrypt(token.encode("ascii")))
        except InvalidToken as exc:
            raise CryptoError("Stored face data could not be decrypted: FACEID_ENCRYPTION_KEY differs from the one used to enroll.") from exc
