import unittest
from server.core import GenerationGate, ScriptAligner, StableTranscript, normalized


def words(text, start=0, end=2):
    return [{"text": text, "start": start, "end": end}]


class TranscriptTests(unittest.TestCase):
    def test_provisional_text_does_not_advance(self):
        state = StableTranscript()
        self.assertEqual(state.update(words("欢迎来到直播间")), ("", "欢迎来到直播间"))
        self.assertEqual(state.update(words("欢迎来到直播间")), ("欢迎来到直播间", ""))

    def test_revised_suffix_is_not_committed_prematurely(self):
        state = StableTranscript()
        state.update(words("今天讲苹果"))
        stable, partial = state.update(words("今天讲香蕉"))
        self.assertEqual(stable, "今天讲")
        self.assertEqual(partial, "香蕉")

    def test_overlap_is_deduplicated(self):
        state = StableTranscript()
        state.update(words("你好欢迎大家"), final=True)
        stable, partial = state.update(words("你好欢迎大家") + words("接着往下说", 2.3, 4.3), final=True)
        self.assertEqual(stable, "接着往下说")

    def test_real_repeated_speech_is_preserved(self):
        state = StableTranscript()
        state.update(words("谢谢大家", 0, 1), final=True)
        self.assertEqual(state.update(words("谢谢大家", 2, 3), final=True)[0], "谢谢大家")

    def test_same_word_at_different_time_is_not_agreement(self):
        state = StableTranscript()
        state.update(words("欢迎大家", 0, 1))
        self.assertEqual(state.update(words("欢迎大家", 3, 4))[0], "")

    def test_revision_horizon_prevents_unbounded_backlog(self):
        state = StableTranscript()
        stable, partial = state.update(words('过去的语音', 0, 1) + words('最新', 3, 4), audio_end=4)
        self.assertEqual(stable, '过去的语音')
        self.assertEqual(partial, '最新')

    def test_overlap_timestamp_drift_is_not_a_repeat(self):
        state = StableTranscript()
        state.update(words('今天的', 0, 1), final=True)
        stable, _ = state.update(words('的', .9, 1.12) + words('直播', 1.15, 2), final=True)
        self.assertEqual(stable, '直播')


class AlignmentTests(unittest.TestCase):
    def setUp(self):
        self.paragraphs = ["大家晚上好，欢迎来到今天的直播。", "第一件事，是找到自己的节奏。说话可以慢一点。", "今天的分享就到这里，谢谢每一位朋友。"]

    def test_follows_chinese_with_punctuation(self):
        aligner = ScriptAligner(self.paragraphs)
        result = aligner.update("大家晚上好欢迎来到今天的直播")
        self.assertEqual(result['paragraph'], 0)
        self.assertGreater(result['offset'], 10)

    def test_short_or_unrelated_text_does_not_jump(self):
        aligner = ScriptAligner(self.paragraphs)
        self.assertIsNone(aligner.update("大家"))
        self.assertIsNone(aligner.update("今天外面下着很大的雨还打雷了"))

    def test_manual_jump_restricts_match_to_target(self):
        aligner = ScriptAligner(self.paragraphs, paragraph=1)
        self.assertIsNone(aligner.update("大家晚上好欢迎来到今天的直播"))
        result = aligner.update("第一件事是找到自己的节奏")
        self.assertEqual(result['paragraph'], 1)

    def test_ambiguous_repetition_does_not_guess(self):
        text = "欢迎来到今天的直播" + "中间完全不同的一段话" * 5 + "欢迎来到今天的直播"
        self.assertIsNone(ScriptAligner([text]).update("欢迎来到今天的直播"))

    def test_full_width_normalization_keeps_source_offsets(self):
        text, offsets = normalized("价格：ＡＢＣ１２３！")
        self.assertEqual(text, "价格abc123")
        self.assertEqual(offsets[-1], 8)

    def test_traditional_and_simplified_scripts_share_matching_form(self):
        self.assertEqual(normalized('歡迎來到直播間')[0], normalized('欢迎来到直播间')[0])


class GenerationTests(unittest.TestCase):
    def test_old_inflight_audio_rejected_after_seek(self):
        gate = GenerationGate(); gate.reset(1)
        self.assertTrue(gate.accept(1, 30))
        gate.reset(2)
        self.assertFalse(gate.accept(1, 31))
        self.assertTrue(gate.accept(2, 0))
        self.assertFalse(gate.accept(2, 0))

    def test_versions_only_increase(self):
        gate = GenerationGate(); gate.reset(3)
        with self.assertRaises(ValueError): gate.reset(2)


if __name__ == '__main__': unittest.main()
