"""Face detection (YuNet) and embedding (SFace) with OpenCV's ONNX runtime.

    frame ─▶ YuNet: boxes + 5 landmarks ─▶ landmark-aligned 112×112 crop ─▶ SFace: 128-d vector (L2-normalized)
"""

from __future__ import annotations

import base64
import binascii
import threading
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from faceid.models import SFACE, YUNET, missing_models

# Largest frame side we accept; the browser sends ~640 px, so this only guards against abuse.
MAX_FRAME_SIDE = 1920


class ModelLoadError(Exception):
    """The recognition models are missing or could not be loaded."""


class ImageError(ValueError):
    """The submitted image could not be decoded."""


@dataclass(frozen=True)
class DetectedFace:
    x: int
    y: int
    w: int
    h: int
    score: float
    # Right eye, left eye, nose tip, right and left mouth corner: shape (5, 2).
    landmarks: np.ndarray = field(compare=False, repr=False)

    def box(self) -> dict:
        return {"x": self.x, "y": self.y, "width": self.w, "height": self.h}

    def yunet_row(self) -> np.ndarray:
        """Row layout expected by ``FaceRecognizerSF.alignCrop``."""
        row = np.zeros((15,), dtype=np.float32)
        row[:4] = (self.x, self.y, self.w, self.h)
        row[4:14] = self.landmarks.reshape(-1)[:10]
        row[14] = self.score
        return row


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    vec = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vec))
    if norm < 1e-12 or not np.isfinite(norm):
        raise ValueError("Cannot normalize a zero or non-finite vector.")
    return vec / norm


def decode_image(data: str) -> np.ndarray:
    """Decode a base64 image (optionally a ``data:image/...;base64,`` URL) into a BGR array."""
    if "," in data[:64]:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageError("Image is not valid base64.") from exc
    frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None or frame.size == 0:
        raise ImageError("Image could not be decoded (send a JPEG or PNG).")
    h, w = frame.shape[:2]
    if max(h, w) > MAX_FRAME_SIDE:
        scale = MAX_FRAME_SIDE / max(h, w)
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return frame


def sharpness(frame: np.ndarray, face: DetectedFace) -> float:
    """Variance of the Laplacian over the face: low values mean blur."""
    h, w = frame.shape[:2]
    x0, y0 = max(0, face.x), max(0, face.y)
    x1, y1 = min(w, face.x + face.w), min(h, face.y + face.h)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 0.0
    crop = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    crop = cv2.resize(crop, (112, 112), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(crop, cv2.CV_64F).var())


class FaceEngine:
    """YuNet detector + SFace encoder. Thread-safe; OpenCV nets are guarded by a lock."""

    model_id = "opencv_sface_2021dec"
    dim = 128

    def __init__(self, models_dir: Path, score_threshold: float = 0.8):
        missing = missing_models(models_dir)
        if missing:
            names = ", ".join(m.filename for m in missing)
            raise ModelLoadError(f"Missing model files in {models_dir}: {names}. Run: python -m faceid.models")
        try:
            self._detector = cv2.FaceDetectorYN.create(str(models_dir / YUNET.filename), "", (320, 320), score_threshold, 0.3, 5000)
            self._encoder = cv2.FaceRecognizerSF.create(str(models_dir / SFACE.filename), "")
        except cv2.error as exc:
            raise ModelLoadError(f"Could not load the face models: {exc}") from exc
        self._input_size = (320, 320)
        self._score_threshold = score_threshold
        self._lock = threading.Lock()

    def detect(self, frame: np.ndarray, min_face_size: int = 0, score_threshold: float | None = None) -> list[DetectedFace]:
        h, w = frame.shape[:2]
        with self._lock:
            # Settings are per user, so the threshold is applied per call.
            if score_threshold is not None and score_threshold != self._score_threshold:
                self._detector.setScoreThreshold(float(score_threshold))
                self._score_threshold = score_threshold
            if self._input_size != (w, h):
                self._detector.setInputSize((w, h))
                self._input_size = (w, h)
            _, rows = self._detector.detect(frame)
        if rows is None:
            return []
        faces = [
            DetectedFace(
                int(round(r[0])), int(round(r[1])), int(round(r[2])), int(round(r[3])), float(r[14]),
                np.asarray(r[4:14], dtype=np.float32).reshape(5, 2),
            )
            for r in rows
        ]
        return [f for f in faces if min(f.w, f.h) >= min_face_size]

    def encode(self, frame: np.ndarray, face: DetectedFace) -> np.ndarray:
        with self._lock:
            crop = self._encoder.alignCrop(frame, face.yunet_row())
            feature = self._encoder.feature(crop)
        return l2_normalize(feature)
