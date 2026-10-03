"""Guided enrollment: validate frames, collect embeddings in memory, then commit.

Only embeddings are kept, and only in memory until the session is saved. No face image
is written anywhere.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

import numpy as np

from faceid.engine import FaceEngine, sharpness
from faceid.matching import Gallery, match_embedding

MIN_SAMPLES_TO_FINISH = 5
# Samples more similar than this to an earlier one add no information.
MAX_SIMILARITY_TO_EXISTING_SAMPLE = 0.97
# Samples less similar than this to the session average are probably another person.
MIN_SIMILARITY_TO_CENTROID = 0.30
MIN_SHARPNESS = 20.0
# Abandoned sessions are dropped after this long.
SESSION_TTL_SECONDS = 15 * 60

MESSAGES = {
    "ok": "Sample captured. Keep turning your head slowly.",
    "no_face": "No face detected. Look at the camera.",
    "multiple_faces": "More than one face in view. Only the person enrolling should be visible.",
    "too_small": "Face is too far away. Move closer.",
    "blurry": "Image is blurry. Hold still or improve the lighting.",
    "too_similar": "Turn your head slightly for a different angle.",
    "inconsistent": "Sample rejected: it doesn't match the earlier samples.",
    "encoding_failed": "Couldn't process this face. Try again.",
    "complete": "All samples captured.",
}


class EnrollmentError(Exception):
    pass


@dataclass
class Session:
    id: str
    owner: str
    target: int
    person_id: int | None  # set when re-enrolling an existing person
    embeddings: list[np.ndarray] = field(default_factory=list)
    touched: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, embedding: np.ndarray) -> str:
        """Add a normalized embedding if it is new and consistent. Returns a status key."""
        with self.lock:
            if len(self.embeddings) >= self.target:
                return "complete"
            if self.embeddings:
                existing = np.vstack(self.embeddings)
                if float(np.max(existing @ embedding)) > MAX_SIMILARITY_TO_EXISTING_SAMPLE:
                    return "too_similar"
                if len(self.embeddings) >= 3 and float(_centroid(existing) @ embedding) < MIN_SIMILARITY_TO_CENTROID:
                    return "inconsistent"
            self.embeddings.append(embedding)
            return "ok"


def analyze_and_capture(engine: FaceEngine, session: Session, frame: np.ndarray, min_face_size: int, score_threshold: float) -> tuple[str, list]:
    """Check one frame and add its face to the session. Returns (status, detected faces)."""
    session.touched = time.monotonic()
    if len(session.embeddings) >= session.target:
        return "complete", []
    faces = engine.detect(frame, score_threshold=score_threshold)  # no size filter, so "too far" can be reported
    if not faces:
        return "no_face", faces
    if len(faces) > 1:
        return "multiple_faces", faces
    face = faces[0]
    if min(face.w, face.h) < min_face_size:
        return "too_small", faces
    if sharpness(frame, face) < MIN_SHARPNESS:
        return "blurry", faces
    try:
        embedding = engine.encode(frame, face)
    except Exception:  # noqa: BLE001 - a bad crop must not end the session
        return "encoding_failed", faces
    return session.add(embedding), faces


def finalize(session: Session, gallery: Gallery, threshold: float) -> tuple[list[np.ndarray], str | None, list[str]]:
    """Validate the collected samples. Returns (embeddings to store, duplicate-of name, warnings)."""
    with session.lock:
        embeddings = list(session.embeddings)
    if len(embeddings) < MIN_SAMPLES_TO_FINISH:
        raise EnrollmentError(f"At least {MIN_SAMPLES_TO_FINISH} good samples are needed (captured {len(embeddings)}).")
    centroid = _centroid(np.vstack(embeddings))
    consistent = [e for e in embeddings if float(centroid @ e) >= MIN_SIMILARITY_TO_CENTROID]
    warnings = []
    if len(consistent) < len(embeddings):
        warnings.append(f"Discarded {len(embeddings) - len(consistent)} inconsistent sample(s).")
    if len(consistent) < MIN_SAMPLES_TO_FINISH:
        raise EnrollmentError("Samples were too inconsistent. Please enroll again in good lighting.")
    match = match_embedding(centroid, gallery.without(session.person_id), threshold)
    return consistent, (match.name if match.recognized else None), warnings


def _centroid(matrix: np.ndarray) -> np.ndarray:
    c = matrix.mean(axis=0)
    return c / max(float(np.linalg.norm(c)), 1e-12)
