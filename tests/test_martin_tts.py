import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "martin_tts", Path(__file__).resolve().parents[1] / "scripts/martin-tts.py"
)
martin = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(martin)


class MartinFrontendTests(unittest.TestCase):
    def test_short_umlaut_survives_before_vocabulary_check(self):
        # Training guide a12d041, section 2 requires ʏ→y after Misaki German G2P.
        for text, phonemes in [("fünf", "fˈʏnf"), ("München", "mˈʏnçən")]:
            with self.subTest(text=text):
                expected = phonemes.replace("ʏ", "y")
                self.assertEqual(
                    martin.phonemize(text, lambda _: (phonemes, None), set(expected)),
                    expected,
                )

    def test_preserves_misaki_diphthongs_and_affricates(self):
        # Misaki 0.9.4 EspeakG2P maps tied aɪ/aʊ/ts/tʃ to I/W/ʦ/ʧ.
        phones = "I W ʦ ʧ"
        self.assertEqual(
            martin.phonemize("Ei, aus, Zeit, Tschüss", lambda _: (phones, None), set(phones)),
            phones,
        )

    def test_rejects_unknown_phonemes_instead_of_dropping_them(self):
        with self.assertRaisesRegex(ValueError, "U\\+0294"):
            martin.phonemize("Text", lambda _: ("aʔ", None), {"a"})

    def test_rejects_empty_or_oversized_phonemes(self):
        for phones in ["", " ", "a" * 511]:
            with self.subTest(phones=phones), self.assertRaises(ValueError):
                martin.phonemize("Text", lambda _: (phones, None), {"a", " "})

    def test_normalizes_whitespace_without_dropping_phones(self):
        self.assertEqual(martin.phonemize("Text", lambda _: (" a\n b ", None), set("a b")), "a b")


class MartinRequestTests(unittest.TestCase):
    def test_accepts_spoken_input_without_rewriting_it(self):
        request = {"speed": 1, "clips": [{"id": "technical-terms", "text": "Die A-P-I nutzt K-I."}]}
        self.assertEqual(martin.validate_request(request), request)

    def test_rejects_invalid_requests(self):
        clip = {"id": "sample", "text": "Text"}
        cases = [
            None, {}, {"speed": 1, "clips": []},
            {"speed": True, "clips": [clip]},
            {"speed": float("nan"), "clips": [clip]},
            {"speed": 3, "clips": [clip]},
            {"speed": 1, "clips": [clip, clip]},
            {"speed": 1, "clips": [clip] * 65},
            {"speed": 1, "clips": [{"id": "../escape", "text": "Text"}]},
            {"speed": 1, "clips": [{"id": "a", "text": " "}]},
            {"speed": 1, "clips": [{"id": "a", "text": "a" * 2001}]},
            {"speed": 1, "clips": [{"id": "a", "text": 42}]},
            {"speed": 1, "clips": [clip], "unknown": True},
        ]
        for request in cases:
            with self.subTest(request=request), self.assertRaises(ValueError):
                martin.validate_request(request)

    def test_reads_bounded_request(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "request.json"
            request = {"speed": 1, "clips": [{"id": "a", "text": "fünf"}]}
            path.write_text(json.dumps(request), encoding="utf-8")
            self.assertEqual(martin.read_request(path), request)
            path.write_bytes(b" " * (128 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, "128 KiB"):
                martin.read_request(path)


class MartinAudioTests(unittest.TestCase):
    def test_attenuates_over_range_audio_before_pcm_conversion(self):
        import numpy as np

        original = np.array([-1.5, 0.5, 2.0], dtype=np.float32)
        audio, peak, gain = martin.prepare_pcm_audio(original)
        self.assertEqual(peak, 2.0)
        self.assertEqual(gain, 0.49)
        np.testing.assert_allclose(audio, [-0.735, 0.245, 0.98])
        np.testing.assert_array_equal(original, [-1.5, 0.5, 2.0])

    def test_preserves_ordinary_audio_exactly(self):
        import numpy as np

        original = np.array([-0.4, 0, 0.7], dtype=np.float32)
        audio, peak, gain = martin.prepare_pcm_audio(original)
        self.assertIs(audio, original)
        self.assertAlmostEqual(peak, 0.7)
        self.assertEqual(gain, 1.0)

    def test_rejects_empty_silent_nonfinite_or_multichannel_audio(self):
        import numpy as np

        for values in [[], [0, 0], [float("nan")], [float("inf")], [[0.1, 0.2]]]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                martin.prepare_pcm_audio(np.array(values))


@unittest.skipUnless(
    os.environ.get("PHONEMIZER_ESPEAK_LIBRARY") and importlib.util.find_spec("misaki"),
    "frontend integration requires Misaki and an explicit native eSpeak library",
)
class MartinNativeFrontendTests(unittest.TestCase):
    def test_native_german_frontend_matches_training_tokens(self):
        g2p, _, _, _ = martin.create_frontend()
        examples = {
            "fünf": "fˈynf",
            "München": "mˈynçən",
            "Ei, aus, Zeit, Tschüss": "ˈI, ˈWs, ʦˈIt, ʧˈys",
        }
        for text, expected in examples.items():
            with self.subTest(text=text):
                self.assertEqual(martin.phonemize(text, g2p, set(expected)), expected)


if __name__ == "__main__":
    unittest.main()
