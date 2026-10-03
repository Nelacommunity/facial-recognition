"""Paths and recognition settings.

Settings are stored per user in Supabase (table face_settings) and sent with each call;
this module only defines their defaults and safe ranges.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# ONNX model weights (read-only). Inside .aix so they stay out of git and the dev watcher.
MODELS_DIR = Path(os.environ.get("FACEID_MODELS_DIR", ROOT / ".aix" / "faceid" / "models"))

# Minimum cosine similarity (0..1) for a match. Higher = stricter. OpenCV's published
# operating point for SFace is 0.363; 0.50 trades more "Unknown" for fewer false matches.
RECOGNITION_THRESHOLD = 0.50
# Faces smaller than this many pixels (in the frame sent by the browser, ~640 px wide) are ignored.
MIN_FACE_SIZE = 48
DETECTION_SCORE_THRESHOLD = 0.80
ENROLLMENT_SAMPLES = 15
# The same person (or "Unknown") is logged at most once per this many seconds.
EVENT_COOLDOWN_SECONDS = 10.0
LOG_UNKNOWN_FACES = True


@dataclass(frozen=True)
class Settings:
    recognition_threshold: float = RECOGNITION_THRESHOLD
    min_face_size: int = MIN_FACE_SIZE
    detection_score_threshold: float = DETECTION_SCORE_THRESHOLD
    enrollment_samples: int = ENROLLMENT_SAMPLES
    event_cooldown_seconds: float = EVENT_COOLDOWN_SECONDS
    log_unknown_faces: bool = LOG_UNKNOWN_FACES

    @staticmethod
    def from_dict(values: dict | None) -> "Settings":
        """Defaults overlaid with known keys from ``values``, every value clamped into range."""
        known = {f.name for f in fields(Settings)}
        merged = {**asdict(Settings()), **{k: v for k, v in (values or {}).items() if k in known and v is not None}}
        return Settings(
            recognition_threshold=_clamp(float(merged["recognition_threshold"]), 0.20, 0.95),
            min_face_size=int(_clamp(int(merged["min_face_size"]), 20, 400)),
            detection_score_threshold=_clamp(float(merged["detection_score_threshold"]), 0.3, 0.99),
            enrollment_samples=int(_clamp(int(merged["enrollment_samples"]), 5, 40)),
            event_cooldown_seconds=_clamp(float(merged["event_cooldown_seconds"]), 0.0, 3600.0),
            log_unknown_faces=bool(merged["log_unknown_faces"]),
        )


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))
