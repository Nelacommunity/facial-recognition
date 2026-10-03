"""Match an embedding against the enrolled gallery.

The score is cosine similarity clipped to 0..1: how alike two faces look *to the model*.
It is not a probability and not proof of identity.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# A person's score is the mean of their best K sample similarities: more robust than the max alone.
TOP_K = 3


@dataclass(frozen=True)
class Gallery:
    """Every enrolled embedding, ready for one matrix multiply."""

    person_ids: np.ndarray  # (N,) int64, row -> person id
    embeddings: np.ndarray  # (N, D) float32, L2-normalized
    names: dict[int, str]

    @property
    def is_empty(self) -> bool:
        return self.embeddings.shape[0] == 0

    @staticmethod
    def empty(dim: int = 128) -> "Gallery":
        return Gallery(np.zeros((0,), np.int64), np.zeros((0, dim), np.float32), {})

    def without(self, person_id: int | None) -> "Gallery":
        if person_id is None:
            return self
        keep = self.person_ids != person_id
        return Gallery(self.person_ids[keep], self.embeddings[keep], self.names)


@dataclass(frozen=True)
class Match:
    recognized: bool
    person_id: int | None
    name: str | None
    # Best similarity to any enrolled person, even below the threshold; None with an empty gallery.
    similarity: float | None
    # Closest person, whether or not they passed the threshold.
    closest: str | None = None

    def to_dict(self) -> dict:
        return {
            "recognized": self.recognized,
            "personId": self.person_id,
            "name": self.name,
            "similarity": None if self.similarity is None else round(self.similarity, 4),
            "closest": self.closest,
        }


NO_MATCH = Match(False, None, None, None)


def match_embedding(embedding: np.ndarray, gallery: Gallery, threshold: float) -> Match:
    if gallery.is_empty:
        return NO_MATCH
    query = np.asarray(embedding, dtype=np.float32).reshape(-1)
    if query.size != gallery.embeddings.shape[1]:
        return NO_MATCH  # different model than the gallery: never a match
    norm = float(np.linalg.norm(query))
    if norm < 1e-12 or not np.isfinite(norm):
        return NO_MATCH
    sims = gallery.embeddings @ (query / norm)

    best_id, best = None, -1.0
    for person_id in np.unique(gallery.person_ids):
        person_sims = sims[gallery.person_ids == person_id]
        k = min(TOP_K, person_sims.size)
        score = float(np.mean(np.partition(person_sims, -k)[-k:]))
        if score > best:
            best_id, best = int(person_id), score

    score = float(np.clip(best, 0.0, 1.0))
    closest = gallery.names.get(best_id) if best_id is not None else None
    if best_id is not None and score >= threshold:
        return Match(True, best_id, closest, score, closest)
    return Match(False, None, None, score, closest)
