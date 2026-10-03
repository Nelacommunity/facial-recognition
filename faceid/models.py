"""Download and verify the OpenCV Zoo ONNX models.

Only public model weights are downloaded; no image or face data leaves the machine.
The app's Python worker has no network access, so run this once from a shell:

    python -m faceid.models
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelFile:
    filename: str
    url: str
    sha256: str


_ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models"

YUNET = ModelFile(
    "face_detection_yunet_2023mar.onnx",
    f"{_ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
)
SFACE = ModelFile(
    "face_recognition_sface_2021dec.onnx",
    f"{_ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
)
MODEL_FILES = (YUNET, SFACE)


class ModelDownloadError(Exception):
    pass


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def missing_models(models_dir: Path) -> list[ModelFile]:
    return [m for m in MODEL_FILES if not (models_dir / m.filename).is_file()]


def download_models(models_dir: Path, timeout: float = 60.0) -> None:
    """Download missing models, verifying each SHA-256 before it is moved into place."""
    models_dir.mkdir(parents=True, exist_ok=True)
    for model in missing_models(models_dir):
        target = models_dir / model.filename
        tmp = target.with_suffix(target.suffix + ".part")
        print(f"Downloading {model.filename}…")
        try:
            with urllib.request.urlopen(model.url, timeout=timeout) as resp, open(tmp, "wb") as out:
                while chunk := resp.read(1 << 16):
                    out.write(chunk)
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            raise ModelDownloadError(f"Failed to download {model.filename}: {exc}") from exc
        actual = sha256_of(tmp)
        if actual != model.sha256:
            tmp.unlink(missing_ok=True)
            raise ModelDownloadError(f"Checksum mismatch for {model.filename} (got {actual[:12]}…).")
        tmp.replace(target)


def main() -> int:
    from faceid.config import MODELS_DIR

    if not missing_models(MODELS_DIR):
        print(f"All models present in {MODELS_DIR}")
        return 0
    try:
        download_models(MODELS_DIR)
    except ModelDownloadError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(f"Models saved to {MODELS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
