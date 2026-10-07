import unittest

from server.core import ScriptAligner, TrackingConfig, normalized


class TrackingTests(unittest.TestCase):
    def config(self, **values):
        return TrackingConfig.from_dict(values)

    def test_only_supported_tiers_are_accepted(self):
        self.assertEqual(self.config(), TrackingConfig())
        for values in [None, [], {'similarity': .5}, {'max_jump_chars': 100000},
                       {'lookahead_paragraphs': True}, {'recovery_misses': 0}, {'unknown': 1}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.config(**values) if isinstance(values, dict) else TrackingConfig.from_dict(values)

    def test_similarity_tier_changes_acceptance(self):
        text = '春天的花园里面开满鲜花'
        spoken = '春天的公园里面开满鲜花'
        loose = ScriptAligner([text], tracking=self.config(similarity=.65))
        strict = ScriptAligner([text], tracking=self.config(similarity=.88))
        # Put substitutions in every available suffix, including the shortest.
        spoken = '春天的公园里边开满红花'
        self.assertIsNotNone(loose.update(spoken))
        self.assertIsNone(strict.update(spoken))

    def test_skipping_a_sentence_can_follow_the_next_sentence(self):
        opening = '欢迎大家来到我们的直播间'
        skipped = '这一句话主播今天决定临时跳过去不读'
        next_sentence = '接下来我们揭晓神秘嘉宾的真实身份'
        state = ScriptAligner([opening + '。' + skipped + '。' + next_sentence + '。'])
        self.assertIsNotNone(state.update(opening))
        result = state.update(next_sentence)
        self.assertIsNotNone(result)
        self.assertGreater(result['offset'], len(opening + skipped) + 2)

    def test_manual_relock_can_recover_into_later_paragraph(self):
        state = ScriptAligner(['甲' * 20, '下面我们揭晓神秘嘉宾的真实身份'], tracking=self.config(recovery_misses=2))
        self.assertIsNone(state.update('下面我们揭晓神秘'))
        self.assertTrue(state.relocating)
        result = state.update('嘉宾的真实身份')
        self.assertEqual(result['paragraph'], 1)
        self.assertFalse(state.relocating)

    def test_recovery_waits_for_selected_number_of_new_speech_updates(self):
        state = ScriptAligner(['甲' * 20, '下面我们揭晓神秘嘉宾的真实身份'], tracking=self.config(recovery_misses=4))
        for _ in range(3):
            self.assertIsNone(state.update('下面我们揭晓神秘嘉宾的真实身份'))
        for _ in range(5):
            self.assertIsNone(state.update(' … '))
        self.assertEqual(state.misses, 3)
        self.assertEqual(state.update('下面我们揭晓神秘嘉宾的真实身份')['paragraph'], 1)

    def test_character_distance_is_cumulative_across_paragraphs(self):
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        paragraphs = ['甲' * 90, '乙' * 90, phrase]
        near = ScriptAligner(paragraphs, tracking=self.config(max_jump_chars=120, recovery_misses=1))
        far = ScriptAligner(paragraphs, tracking=self.config(max_jump_chars=300, recovery_misses=1))
        self.assertIsNone(near.update(phrase))
        self.assertEqual(far.update(phrase)['paragraph'], 2)

    def test_distance_is_measured_from_cursor_not_paragraph_start_or_lookbehind(self):
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        paragraph = '甲' * 300 + '，' + '乙' * 90 + '，' + phrase
        state = ScriptAligner([paragraph], offset=301, tracking=self.config(max_jump_chars=120, recovery_misses=1))
        self.assertEqual(state.update(phrase)['offset'], len(paragraph))

    def test_long_jump_tier_reaches_beyond_medium_tier(self):
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        paragraph = '甲' * 600 + phrase
        medium = ScriptAligner([paragraph], tracking=self.config(max_jump_chars=300, recovery_misses=1))
        long = ScriptAligner([paragraph], tracking=self.config(max_jump_chars=800, recovery_misses=1))
        self.assertIsNone(medium.update(phrase))
        self.assertEqual(long.update(phrase)['offset'], len(paragraph))

    def test_paragraph_limit_still_applies_when_distance_allows_jump(self):
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        paragraphs = ['甲' * 10, '乙' * 10, phrase]
        for limit in (0, 1):
            state = ScriptAligner(paragraphs, tracking=self.config(lookahead_paragraphs=limit, recovery_misses=1))
            self.assertIsNone(state.update(phrase))
        state = ScriptAligner(paragraphs, tracking=self.config(lookahead_paragraphs=3, recovery_misses=1))
        self.assertEqual(state.update(phrase)['paragraph'], 2)

    def test_punctuation_does_not_consume_jump_distance(self):
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        paragraph = '甲，' * 100 + phrase
        state = ScriptAligner([paragraph], tracking=self.config(max_jump_chars=120, recovery_misses=1))
        result = state.update(phrase)
        self.assertIsNotNone(result)
        self.assertLessEqual(len(normalized(paragraph[:result['offset']])[0]), 120)

    def test_recovery_never_goes_backwards_or_guesses_between_repetitions(self):
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        state = ScriptAligner([phrase, '甲' * 30], paragraph=1, tracking=self.config(recovery_misses=1))
        self.assertIsNone(state.update(phrase))
        repeated = ScriptAligner([phrase + '甲' * 60 + phrase], tracking=self.config(recovery_misses=1))
        self.assertIsNone(repeated.update(phrase))

    def test_changing_policy_keeps_cursor_and_applies_new_limit(self):
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        state = ScriptAligner(['甲' * 180 + phrase], tracking=self.config(max_jump_chars=120, recovery_misses=1))
        self.assertIsNone(state.update(phrase))
        state.configure(self.config(max_jump_chars=300, recovery_misses=1))
        self.assertEqual((state.paragraph, state.offset), (0, 0))
        self.assertIsNotNone(state.update(phrase))


if __name__ == '__main__':
    unittest.main()
