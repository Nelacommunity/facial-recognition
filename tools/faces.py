"""Face recognition tools (OpenCV YuNet + SFace), called by the routes in app/api/faces/.

They run in the "faceid" worker pool (.aix/languages.json): no network access and no file
writes. Supabase is read and written by the TypeScript routes; these tools only compute, keep
per-user state in memory, and encrypt/decrypt embeddings with FACEID_ENCRYPTION_KEY, so
plaintext vectors never leave this process.

The user always comes from ctx.user (set by the host from the verified Supabase identity),
never from tool input. The engine itself lives in the faceid/ package.
"""

from __future__ import annotations

import functools
import threading

from aix import AixError, tool

from faceid.config import Settings
from faceid.crypto import CryptoError, EmbeddingCipher
from faceid.engine import ImageError, ModelLoadError
from faceid.enrollment import EnrollmentError
from faceid.service import StaleGallery, get_service

KEY_SECRET = "FACEID_ENCRYPTION_KEY"
_cipher: tuple[str, EmbeddingCipher] | None = None
_cipher_lock = threading.Lock()


def _errors(fn):
    """Turn engine errors into AIX errors the routes can show to the user."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except StaleGallery as e:
            raise AixError("VALIDATION_FAILED", "Gallery is out of date.", details={"stale": True, "status": 409}) from e
        except ModelLoadError as e:
            raise AixError("CONFIG_INVALID", str(e), hint="Run: python -m faceid.models") from e
        except CryptoError as e:
            raise AixError("CONFIG_INVALID", str(e)) from e
        except PermissionError as e:
            raise AixError("UNAUTHENTICATED", str(e)) from e
        except (ImageError, EnrollmentError, ValueError) as e:
            raise AixError("VALIDATION_FAILED", str(e)) from e

    return wrapper


def _user(ctx) -> str:
    user = ctx.user or {}
    if not user.get("id"):
        raise PermissionError("No signed-in user.")
    return str(user["id"])


def _cipher_for(ctx) -> EmbeddingCipher:
    global _cipher
    key = ctx.secrets.get(KEY_SECRET)
    with _cipher_lock:
        if _cipher is None or _cipher[0] != key:
            _cipher = (key, EmbeddingCipher(key))
        return _cipher[1]


@tool
@_errors
def face_model(ctx) -> dict:
    """The embedding model id; stored embeddings from other models need re-enrollment."""
    return {"modelId": get_service().engine.model_id}


@tool(secrets=[KEY_SECRET])
@_errors
def face_load_gallery(version: str, people: list[dict], ctx) -> dict:
    """Decrypt and cache the signed-in user's gallery: people = [{id, name, ciphertexts}]."""
    return get_service().load_gallery(_user(ctx), version, people, _cipher_for(ctx))


@tool
@_errors
def face_recognize(image: str, version: str, settings: dict, ctx) -> dict:
    """Detect every face in a base64 JPEG/PNG and match each against the cached gallery."""
    return get_service().recognize(_user(ctx), version, image, Settings.from_dict(settings))


@tool
@_errors
def face_enroll_start(settings: dict, ctx, person_id: int | None = None) -> dict:
    """Start a guided enrollment session (pass person_id to re-enroll an existing person)."""
    return get_service().enroll_start(_user(ctx), person_id, Settings.from_dict(settings))


@tool
@_errors
def face_enroll_sample(session_id: str, image: str, settings: dict, ctx) -> dict:
    """Check one camera frame and, if it is usable, add its face to the enrollment session."""
    return get_service().enroll_sample(_user(ctx), session_id, image, Settings.from_dict(settings))


@tool(secrets=[KEY_SECRET])
@_errors
def face_enroll_finish(session_id: str, version: str, consent: bool, settings: dict, ctx, allow_duplicate: bool = False) -> dict:
    """Validate an enrollment session and return its encrypted embeddings for storage."""
    return get_service().enroll_finish(_user(ctx), session_id, version, consent, allow_duplicate, Settings.from_dict(settings), _cipher_for(ctx))


@tool
@_errors
def face_enroll_cancel(session_id: str, ctx) -> dict:
    """Discard an enrollment session and its in-memory samples."""
    get_service().enroll_cancel(_user(ctx), session_id)
    return {"ok": True}


@tool
@_errors
def face_forget(ctx, person_id: int | None = None) -> dict:
    """Drop in-memory state for the signed-in user (or only one person's debouncing state)."""
    if person_id is None:
        get_service().forget(_user(ctx))
    else:
        get_service().forget_person(_user(ctx), person_id)
    return {"ok": True}
