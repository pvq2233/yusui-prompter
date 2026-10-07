"""Pure state machines for streaming text and bounded script alignment."""
from dataclasses import dataclass
from bisect import bisect_left
import json
from pathlib import Path
import re
import unicodedata
from difflib import SequenceMatcher
from functools import lru_cache
from opencc import OpenCC

_chinese = OpenCC('t2s')
TRACKING_OPTIONS = json.loads((Path(__file__).resolve().parent.parent / 'tracking-options.json').read_text(encoding='utf-8'))


@dataclass(frozen=True)
class TrackingConfig:
    similarity: float = TRACKING_OPTIONS['similarity']['default']
    max_jump_chars: int = TRACKING_OPTIONS['max_jump_chars']['default']
    lookahead_paragraphs: int = TRACKING_OPTIONS['lookahead_paragraphs']['default']
    recovery_misses: int = TRACKING_OPTIONS['recovery_misses']['default']

    @classmethod
    def from_dict(cls, values):
        if not isinstance(values, dict) or set(values) - set(TRACKING_OPTIONS):
            raise ValueError('跟踪策略格式无效')
        validated = {}
        for key, option in TRACKING_OPTIONS.items():
            value = values.get(key, option['default'])
            if type(value) not in (int, float) or value not in [choice['value'] for choice in option['choices']]:
                raise ValueError(f'跟踪策略档位无效：{key}')
            validated[key] = float(value) if key == 'similarity' else int(value)
        return cls(**validated)

@lru_cache(maxsize=8192)
def normalize_char(char: str) -> str:
    return _chinese.convert(unicodedata.normalize('NFKC', char).casefold())


def normalized(text: str) -> tuple[str, list[int]]:
    chars, offsets = [], []
    for index, char in enumerate(text):
        for value in normalize_char(char):
            if value.isalnum():
                chars.append(value)
                offsets.append(index)
    return "".join(chars), offsets


@dataclass
class TimedChar:
    text: str
    start: float
    end: float


class StableTranscript:
    """Two successive decodes must agree; timestamps preserve actual repetitions."""
    def __init__(self):
        self.previous: list[TimedChar] = []
        self.committed_until = -1.0
        self.tail = ''

    def update(self, words: list[dict], final: bool = False, audio_end: float | None = None) -> tuple[str, str]:
        current = []
        for word in words:
            text = word["text"]
            duration = max(0, word["end"] - word["start"])
            for i, char in enumerate(text):
                start = word["start"] + duration * i / max(1, len(text))
                end = word["start"] + duration * (i + 1) / max(1, len(text))
                if end > self.committed_until + 0.025:
                    current.append(TimedChar(char, start, end))
        # Timestamp drift at the overlap boundary must not repeat committed text.
        for count in range(min(12, len(current), len(self.tail)), 0, -1):
            if ''.join(c.text for c in current[:count]) == self.tail[-count:] and current[count - 1].start < self.committed_until - .02:
                current = current[count:]
                break
        if final:
            count = len(current)
        else:
            count = 0
            for old, new in zip(self.previous, current):
                if unicodedata.normalize('NFKC', old.text).casefold() != unicodedata.normalize('NFKC', new.text).casefold():
                    break
                # Same spelling at a later time is a new utterance, not agreement.
                if abs(old.start - new.start) > 0.65:
                    break
                count += 1
            # Bound revision latency. Older speech has enough right context;
            # finalize it rather than stalling forever on a changed punctuation.
            if audio_end is not None:
                aged = sum(char.end <= audio_end - 1.8 for char in current)
                count = max(count, aged)
        stable = "".join(char.text for char in current[:count])
        if count:
            self.committed_until = current[count - 1].end
            self.tail = (self.tail + stable)[-32:]
        self.previous = current[count:]
        return stable, "".join(char.text for char in self.previous)


class ScriptAligner:
    def __init__(self, paragraphs: list[str], paragraph: int = 0, offset: int = 0, tracking: TrackingConfig | None = None):
        self.paragraphs = paragraphs
        self.normalized = [normalized(text) for text in paragraphs]
        self.starts = []
        count = 0
        for target, _ in self.normalized:
            self.starts.append(count)
            count += len(target)
        self.paragraph = max(0, min(paragraph, len(paragraphs) - 1))
        self.offset = max(0, offset)
        self.evidence = ""
        self.relocating = True
        self.tracking = tracking or TrackingConfig()
        self.misses = 0

    def configure(self, tracking: TrackingConfig):
        self.tracking = tracking
        self.misses = 0

    def update(self, text: str) -> dict | None:
        incoming, _ = normalized(text)
        self.evidence = (self.evidence + incoming)[-48:]
        if len(incoming) == 0 or len(self.evidence) < 5 or not self.paragraphs:
            return None
        query = self.evidence[-32:]
        # Prefer nearby text. A fresh manual anchor gets the first chance to
        # match its selected paragraph, then recovery can advance within limits.
        nearby_paragraphs = 0 if self.relocating else min(1, self.tracking.lookahead_paragraphs)
        best = self._match(query, min(120, self.tracking.max_jump_chars), nearby_paragraphs)
        if best is None:
            self.misses += 1
            if self.misses >= self.tracking.recovery_misses:
                best = self._match(query, self.tracking.max_jump_chars, self.tracking.lookahead_paragraphs)
        if best is None:
            return None
        _, paragraph, offset, confidence, _ = best
        self.paragraph, self.offset = paragraph, offset
        self.relocating = False
        self.misses = 0
        return {"paragraph": paragraph, "offset": offset, "confidence": round(confidence, 3)}

    def _match(self, query: str, jump_chars: int, paragraph_limit: int):
        candidates = []
        current_index = bisect_left(self.normalized[self.paragraph][1], self.offset)
        current_global = self.starts[self.paragraph] + current_index
        allowed_end = current_global + jump_chars
        for p in range(self.paragraph, min(len(self.paragraphs), self.paragraph + paragraph_limit + 1)):
            target, offsets = self.normalized[p]
            minimum = max(0, current_index - 40) if p == self.paragraph else 0
            # The cap is cumulative across paragraphs, measured from the cursor,
            # not from the beginning of each independently searched paragraph.
            maximum = min(len(target), allowed_end - self.starts[p])
            # Try recent suffixes so an ad-lib does not poison the entire buffer.
            for qlen in sorted({min(len(query), 8), min(len(query), 12), min(len(query), 24), len(query)}, reverse=True):
                if qlen < 5:
                    continue
                q = query[-qlen:]
                for end in range(minimum + 5, maximum + 1):
                    start = max(minimum, end - qlen)
                    sample = target[start:end]
                    ratio = SequenceMatcher(None, q, sample, autojunk=False).ratio()
                    if ratio < self.tracking.similarity or min(len(sample), len(q)) < 5:
                        continue
                    raw_end = offsets[end - 1] + 1
                    if p == self.paragraph and raw_end <= self.offset:
                        continue
                    # Longer evidence and nearby positions win ties.
                    score = ratio + min(qlen, 24) * .003 - (p - self.paragraph) * .025
                    candidates.append((score, p, raw_end, ratio, qlen))
        if not candidates:
            return None
        candidates.sort(reverse=True)
        best = candidates[0]
        # Repeated wording at two distant locations must not cause a guess.
        if any(abs(c[0] - best[0]) < .025 and (c[1] != best[1] or abs(c[2] - best[2]) > 35) for c in candidates[1:]):
            return None
        return best


class GenerationGate:
    def __init__(self):
        self.generation = 0
        self.last_sequence = -1

    def reset(self, generation: int):
        if generation <= self.generation:
            raise ValueError("定位版本必须递增")
        self.generation = generation
        self.last_sequence = -1

    def accept(self, generation: int, sequence: int) -> bool:
        if generation != self.generation or sequence <= self.last_sequence:
            return False
        self.last_sequence = sequence
        return True
