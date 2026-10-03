"""Unit tests for the faceid package. They need no camera, images, model files or Supabase.

Run:  .aix/python/.venv/bin/python -m unittest discover tests
"""

from __future__ import annotations

import unittest

import numpy as np
from cryptography.fernet import Fernet

from faceid.config import Settings
from faceid.crypto import CryptoError, EmbeddingCipher, deserialize_embedding, serialize_embedding
from faceid.enrollment import MIN_SAMPLES_TO_FINISH, EnrollmentError, Session, finalize
from faceid.matching import Gallery, match_embedding
from faceid.service import FaceService, StaleGallery
rng = np.random.default_rng(42)


def unit(v: np.ndarray) -> np.ndarray:
    return (v / np.linalg.norm(v)).astype(np.float32)


def person_samples(base: np.ndarray, n: int, noise: float = 0.4) -> list[np.ndarray]:
    """n distinct embeddings clustered around one identity."""
    return [unit(base + rng.normal(0, noise, base.size)) for _ in range(n)]


class CryptoTests(unittest.TestCase):
    def setUp(self):
        self.cipher = EmbeddingCipher(Fernet.generate_key().decode())

    def test_round_trip_and_ciphertext_only(self):
        vec = unit(rng.normal(size=128))
        token = self.cipher.encrypt(vec)
        self.assertTrue(token.startswith("gAAAAA"), "should be a Fernet token")
        np.testing.assert_allclose(self.cipher.decrypt(token), vec, rtol=1e-6)

    def test_wrong_key_and_bad_key_are_refused(self):
        token = self.cipher.encrypt(unit(rng.normal(size=128)))
        with self.assertRaises(CryptoError):
            EmbeddingCipher(Fernet.generate_key().decode()).decrypt(token)
        with self.assertRaises(CryptoError):
            EmbeddingCipher("not-a-key")

    def test_serialization_rejects_bad_payloads(self):
        with self.assertRaises(CryptoError):
            serialize_embedding(np.array([np.nan], dtype=np.float32))
        with self.assertRaises(CryptoError):
            deserialize_embedding(b"XX")


class _FakeEngine:
    """Stands in for FaceEngine so service tests need no models or images."""

    model_id = "test-model"
    dim = 128


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = FaceService(engine=_FakeEngine())
        self.cipher = EmbeddingCipher(Fernet.generate_key().decode())
        self.ada = rng.normal(size=128)

    def load(self, user: str, version: str):
        tokens = [self.cipher.encrypt(e) for e in person_samples(self.ada, 5)]
        return self.service.load_gallery(user, version, [{"id": 7, "name": "Ada", "ciphertexts": tokens}], self.cipher)

    def test_gallery_is_per_user_and_versioned(self):
        self.assertEqual(self.load("u1", "v1"), {"loaded": 1, "samples": 5})
        self.assertEqual(self.service._gallery("u1", "v1").names, {7: "Ada"})
        with self.assertRaises(StaleGallery):
            self.service._gallery("u1", "v0")
        with self.assertRaises(StaleGallery):
            self.service._gallery("u2", "v1")  # another user never sees u1's gallery

    def test_sessions_belong_to_their_user(self):
        sid = self.service.enroll_start("u1", None, Settings())["sessionId"]
        with self.assertRaises(EnrollmentError):
            self.service._session("u2", sid)
        self.service.enroll_cancel("u2", sid)  # ignored: not u2's session
        self.assertEqual(self.service._session("u1", sid).owner, "u1")

    def test_finish_returns_ciphertexts_and_requires_consent(self):
        self.load("u1", "v1")
        sid = self.service.enroll_start("u1", None, Settings())["sessionId"]
        for e in person_samples(rng.normal(size=128), 6):
            self.service._session("u1", sid).add(e)
        with self.assertRaises(EnrollmentError):
            self.service.enroll_finish("u1", sid, "v1", False, False, Settings(), self.cipher)
        r = self.service.enroll_finish("u1", sid, "v1", True, False, Settings(), self.cipher)
        self.assertTrue(r["ready"])
        self.assertEqual(r["modelId"], "test-model")
        self.assertTrue(all(t.startswith("gAAAAA") for t in r["ciphertexts"]))

    def test_finish_flags_duplicate_of_enrolled_person(self):
        self.load("u1", "v1")
        sid = self.service.enroll_start("u1", None, Settings())["sessionId"]
        for e in person_samples(self.ada, 6):
            self.service._session("u1", sid).add(e)
        r = self.service.enroll_finish("u1", sid, "v1", True, False, Settings(), self.cipher)
        self.assertEqual((r["ready"], r["duplicateOf"]), (False, "Ada"))

    def test_events_wait_for_stable_frames_and_cooldown(self):
        face = {"recognized": True, "personId": 7, "name": "Ada", "similarity": 0.9}
        s = Settings.from_dict({"event_cooldown_seconds": 60})
        logged = [self.service._events("u1", [face], s) for _ in range(5)]
        self.assertEqual([len(e) for e in logged], [0, 0, 1, 0, 0])
        unknown = {"recognized": False, "personId": None, "name": None, "similarity": 0.1}
        quiet = Settings.from_dict({"log_unknown_faces": False})
        self.assertEqual(sum(len(self.service._events("u1", [unknown], quiet)) for _ in range(5)), 0)

    def test_forget_drops_user_state(self):
        self.load("u1", "v1")
        sid = self.service.enroll_start("u1", None, Settings())["sessionId"]
        self.service.forget("u1")
        with self.assertRaises(StaleGallery):
            self.service._gallery("u1", "v1")
        with self.assertRaises(EnrollmentError):
            self.service._session("u1", sid)


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.ada, self.bob = rng.normal(size=128), rng.normal(size=128)
        samples = person_samples(self.ada, 6) + person_samples(self.bob, 6)
        self.gallery = Gallery(np.array([1] * 6 + [2] * 6), np.vstack(samples), {1: "Ada", 2: "Bob"})

    def test_recognizes_the_right_person(self):
        match = match_embedding(person_samples(self.ada, 1)[0], self.gallery, 0.5)
        self.assertTrue(match.recognized)
        self.assertEqual((match.person_id, match.name), (1, "Ada"))

    def test_stranger_is_unknown_but_reports_closest(self):
        match = match_embedding(unit(rng.normal(size=128)), self.gallery, 0.5)
        self.assertFalse(match.recognized)
        self.assertIsNone(match.name)
        self.assertIn(match.closest, ("Ada", "Bob"))
        self.assertLess(match.similarity, 0.5)

    def test_threshold_controls_the_decision(self):
        query = person_samples(self.ada, 1, noise=0.8)[0]
        score = match_embedding(query, self.gallery, 0.0).similarity
        self.assertTrue(match_embedding(query, self.gallery, score - 0.01).recognized)
        self.assertFalse(match_embedding(query, self.gallery, score + 0.01).recognized)

    def test_empty_gallery_and_wrong_dimension(self):
        self.assertIsNone(match_embedding(unit(self.ada), Gallery.empty(), 0.5).similarity)
        self.assertFalse(match_embedding(unit(rng.normal(size=64)), self.gallery, 0.5).recognized)


class EnrollmentTests(unittest.TestCase):
    def test_rejects_near_duplicates_and_other_people(self):
        base = rng.normal(size=128)
        session = Session("s", "u1", target=10, person_id=None)
        first = person_samples(base, 1)[0]
        self.assertEqual(session.add(first), "ok")
        self.assertEqual(session.add(first), "too_similar")
        for e in person_samples(base, 3):
            self.assertEqual(session.add(e), "ok")
        self.assertEqual(session.add(unit(-np.mean(session.embeddings, axis=0))), "inconsistent")

    def test_finalize_needs_enough_samples(self):
        session = Session("s", "u1", target=10, person_id=None)
        for e in person_samples(rng.normal(size=128), MIN_SAMPLES_TO_FINISH - 1):
            session.add(e)
        with self.assertRaises(EnrollmentError):
            finalize(session, Gallery.empty(), 0.5)

    def test_finalize_flags_possible_duplicate_except_self(self):
        base = rng.normal(size=128)
        gallery = Gallery(np.array([7] * 5), np.vstack(person_samples(base, 5)), {7: "Ada"})
        session = Session("s", "u1", target=10, person_id=None)
        for e in person_samples(base, 6):
            session.add(e)
        _, duplicate, _ = finalize(session, gallery, 0.5)
        self.assertEqual(duplicate, "Ada")
        session.person_id = 7  # re-enrolling Ada is not a duplicate of herself
        _, duplicate, _ = finalize(session, gallery, 0.5)
        self.assertIsNone(duplicate)


class SettingsTests(unittest.TestCase):
    def test_values_are_clamped_and_unknown_keys_ignored(self):
        s = Settings.from_dict({"recognition_threshold": 9, "min_face_size": 1, "unknown_key": 1, "log_unknown_faces": None})
        self.assertEqual((s.recognition_threshold, s.min_face_size, s.log_unknown_faces), (0.95, 20, True))

    def test_empty_means_defaults(self):
        self.assertEqual(Settings.from_dict(None), Settings())


if __name__ == "__main__":
    unittest.main()
