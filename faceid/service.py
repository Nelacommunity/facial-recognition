"""The facade tools/faces.py calls. Pure compute: no network, no files besides the models.

Supabase is the source of truth and is read and written by the TypeScript server. This process
keeps, per signed-in user and only in memory:

- the decrypted gallery, tagged with a version chosen by the TypeScript side (a stale version
  makes recognize() ask for a reload instead of matching against old data);
- enrollment sessions (embeddings collected so far);
- event debouncing state (stable-frame streaks and per-person cooldowns).
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from faceid import config
from faceid.config import Settings
from faceid.crypto import EmbeddingCipher
from faceid.engine import FaceEngine, decode_image
from faceid.enrollment import MESSAGES, SESSION_TTL_SECONDS, EnrollmentError, Session, analyze_and_capture, finalize
from faceid.matching import NO_MATCH, Gallery, match_embedding

# A result is reported for logging only after it has been seen in this many consecutive frames.
STABLE_FRAMES = 3
# Users idle this long have their in-memory gallery and state dropped.
USER_TTL_SECONDS = 30 * 60


class StaleGallery(Exception):
    """The caller's gallery version differs from the one loaded here."""


@dataclass
class UserState:
    gallery: Gallery = field(default_factory=Gallery.empty)
    version: str | None = None
    streaks: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    last_logged: dict[str, float] = field(default_factory=dict)
    touched: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock)


class FaceService:
    def __init__(self, engine: FaceEngine | None = None):
        self.engine = engine or FaceEngine(config.MODELS_DIR)
        self._users: dict[str, UserState] = {}
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    # ----------------------------------------------------------------- gallery
    def load_gallery(self, user: str, version: str, people: list[dict], cipher: EmbeddingCipher) -> dict:
        """Decrypt and cache a user's gallery. ``people``: [{id, name, ciphertexts: [...]}] for this engine's model."""
        ids, vectors, names = [], [], {}
        for person in people:
            pid = int(person["id"])
            names[pid] = str(person["name"])
            for token in person.get("ciphertexts") or []:
                vec = cipher.decrypt(token)
                if vec.size == self.engine.dim:
                    ids.append(pid)
                    vectors.append(vec)
        gallery = (
            Gallery(np.array(ids, dtype=np.int64), np.vstack(vectors).astype(np.float32), names) if vectors else Gallery.empty(self.engine.dim)
        )
        state = self._user(user)
        with state.lock:
            state.gallery, state.version = gallery, version
        return {"loaded": len(names), "samples": len(ids)}

    def _gallery(self, user: str, version: str) -> Gallery:
        state = self._user(user)
        with state.lock:
            if state.version != version:
                raise StaleGallery()
            return state.gallery

    # ------------------------------------------------------------- recognition
    def recognize(self, user: str, version: str, image: str, settings: Settings) -> dict:
        gallery = self._gallery(user, version)
        frame = decode_image(image)
        faces = []
        for face in self.engine.detect(frame, settings.min_face_size, settings.detection_score_threshold):
            try:
                match = match_embedding(self.engine.encode(frame, face), gallery, settings.recognition_threshold)
            except Exception:  # noqa: BLE001 - one bad crop must not fail the frame
                match = NO_MATCH
            faces.append({"box": face.box(), "score": round(face.score, 3), **match.to_dict()})
        h, w = frame.shape[:2]
        return {"width": w, "height": h, "faces": faces, "enrolled": len(gallery.names), "events": self._events(user, faces, settings)}

    def _events(self, user: str, faces: list[dict], settings: Settings) -> list[dict]:
        """Results to log: stable for STABLE_FRAMES frames, at most once per person (or Unknown) per cooldown."""
        state = self._user(user)
        seen = {str(f["personId"]) if f["recognized"] else "unknown": f for f in faces}
        now = time.monotonic()
        events = []
        with state.lock:
            for key in list(state.streaks):
                if key not in seen:
                    del state.streaks[key]
            for key, face in seen.items():
                state.streaks[key] += 1
                if state.streaks[key] < STABLE_FRAMES:
                    continue
                if key == "unknown" and not settings.log_unknown_faces:
                    continue
                if now - state.last_logged.get(key, float("-inf")) < settings.event_cooldown_seconds:
                    continue
                state.last_logged[key] = now
                events.append({"personId": face["personId"], "similarity": face["similarity"]})
        return events

    # -------------------------------------------------------------- enrollment
    def enroll_start(self, user: str, person_id: int | None, settings: Settings) -> dict:
        self._expire()
        session = Session(secrets.token_urlsafe(16), user, settings.enrollment_samples, person_id)
        with self._lock:
            self._sessions[session.id] = session
        return {"sessionId": session.id, "target": session.target}

    def enroll_sample(self, user: str, session_id: str, image: str, settings: Settings) -> dict:
        session = self._session(user, session_id)
        frame = decode_image(image)
        status, faces = analyze_and_capture(self.engine, session, frame, settings.min_face_size, settings.detection_score_threshold)
        h, w = frame.shape[:2]
        return {
            "status": status,
            "accepted": status == "ok",
            "message": MESSAGES[status],
            "samples": len(session.embeddings),
            "target": session.target,
            "width": w,
            "height": h,
            "faces": [f.box() for f in faces],
        }

    def enroll_finish(self, user: str, session_id: str, version: str, consent: bool, allow_duplicate: bool, settings: Settings, cipher: EmbeddingCipher) -> dict:
        """Validate the session and return encrypted embeddings for the caller to store.

        The session is kept until enroll_cancel(), so a failed database write can be retried.
        """
        if not consent:
            raise EnrollmentError("The person being enrolled must give explicit consent.")
        session = self._session(user, session_id)
        gallery = self._gallery(user, version)
        embeddings, duplicate_of, warnings = finalize(session, gallery, settings.recognition_threshold)
        if duplicate_of and not allow_duplicate:
            return {"ready": False, "duplicateOf": duplicate_of, "warnings": warnings}
        return {
            "ready": True,
            "personId": session.person_id,
            "modelId": self.engine.model_id,
            "ciphertexts": [cipher.encrypt(e) for e in embeddings],
            "duplicateOf": duplicate_of,
            "warnings": warnings,
        }

    def enroll_cancel(self, user: str, session_id: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.owner != user:
                return
            del self._sessions[session_id]
        with session.lock:
            session.embeddings.clear()

    def _session(self, user: str, session_id: str) -> Session:
        self._expire()
        with self._lock:
            session = self._sessions.get(session_id)
        if session is None or session.owner != user:
            raise EnrollmentError("Enrollment session expired. Start again.")
        session.touched = time.monotonic()
        return session

    # ------------------------------------------------------------------- reset
    def forget(self, user: str) -> None:
        """Drop everything held in memory for a user (sign-out, delete-all)."""
        with self._lock:
            self._users.pop(user, None)
            ids = [sid for sid, s in self._sessions.items() if s.owner == user]
        for sid in ids:
            self.enroll_cancel(user, sid)

    def forget_person(self, user: str, person_id: int) -> None:
        with self._lock:
            state = self._users.get(user)
        if state:
            with state.lock:
                state.last_logged.pop(str(person_id), None)
                state.streaks.pop(str(person_id), None)

    # ----------------------------------------------------------------- helpers
    def _user(self, user: str) -> UserState:
        if not user:
            raise PermissionError("No signed-in user.")
        with self._lock:
            state = self._users.get(user)
            if state is None:
                state = self._users[user] = UserState()
            state.touched = time.monotonic()
            return state

    def _expire(self) -> None:
        now = time.monotonic()
        with self._lock:
            old_sessions = [(s.owner, sid) for sid, s in self._sessions.items() if s.touched < now - SESSION_TTL_SECONDS]
            for uid in [u for u, s in self._users.items() if s.touched < now - USER_TTL_SECONDS]:
                del self._users[uid]
        for owner, sid in old_sessions:
            self.enroll_cancel(owner, sid)


_service: FaceService | None = None
_service_lock = threading.Lock()


def get_service() -> FaceService:
    """The process-wide service, created on first use (loads the models)."""
    global _service
    with _service_lock:
        if _service is None:
            _service = FaceService()
        return _service
