import asyncio
import struct
import unittest
from unittest.mock import patch
import numpy as np
from fastapi.testclient import TestClient
from server.app import AudioSession, allowed_origin, app, service


class FakeSocket:
    def __init__(self): self.messages = []
    async def send_json(self, data): self.messages.append(data)


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_tracking_update_preserves_audio_transcript_and_pause(self):
        session = AudioSession(FakeSocket())
        session.reset({'generation': 1, 'paragraphs': ['测试讲稿内容'], 'paused': True})
        pcm = (np.ones(16000, dtype='<i2') * 1000).tobytes()
        await session.audio(struct.pack('<II', 1, 0) + pcm)
        samples, stabilizer = session.samples, session.stabilizer
        self.assertTrue(session.configure_tracking({'generation': 1, 'tracking': {'similarity': .65, 'max_jump_chars': 800}}))
        self.assertIs(session.samples, samples)
        self.assertIs(session.stabilizer, stabilizer)
        self.assertTrue(session.paused)
        self.assertEqual(session.gate.generation, 1)
        self.assertEqual(session.aligner.tracking.max_jump_chars, 800)
        self.assertFalse(session.configure_tracking({'generation': 0, 'tracking': {'max_jump_chars': 120}}))
        session.reset({'generation': 2, 'paragraph': 0})
        self.assertEqual(session.aligner.tracking.max_jump_chars, 800)
        session.reset({'generation': 3, 'tracking': {'max_jump_chars': 300}})
        self.assertEqual(session.aligner.tracking.max_jump_chars, 300)

    async def test_tracking_update_during_inference_uses_new_policy(self):
        ws = FakeSocket(); session = AudioSession(ws)
        phrase = '下面我们揭晓神秘嘉宾的真实身份'
        session.reset({'generation': 1, 'paragraphs': ['甲' * 180 + phrase], 'tracking': {'max_jump_chars': 120, 'recovery_misses': 1}})
        entered = asyncio.Event(); finish = asyncio.Event()
        async def transcribe(*args):
            entered.set(); await finish.wait()
            return {'words': [{'text': phrase, 'start': 0, 'end': .5}], 'inference_ms': 30}
        pcm = (np.ones(32000, dtype='<i2') * 1000).tobytes()
        with patch.object(service, 'transcribe', transcribe):
            runner = asyncio.create_task(session.recognition_loop())
            # 2.4 seconds makes the mocked phrase older than the stability horizon.
            await session.audio(struct.pack('<II', 1, 0) + pcm)
            await session.audio(struct.pack('<II', 1, 1) + pcm[:12800])
            await asyncio.wait_for(entered.wait(), 2)
            session.configure_tracking({'generation': 1, 'tracking': {'max_jump_chars': 300, 'recovery_misses': 1}})
            finish.set()
            for _ in range(30):
                if any(m['type'] == 'position' for m in ws.messages): break
                await asyncio.sleep(.01)
            session.closed = True; runner.cancel()
            await asyncio.gather(runner, return_exceptions=True)
        positions = [m for m in ws.messages if m['type'] == 'position']
        self.assertEqual(len(positions), 1)
        self.assertGreater(positions[0]['offset'], 180)

    async def test_seek_while_inference_is_running_ignores_old_result(self):
        ws = FakeSocket(); session = AudioSession(ws)
        session.reset({'generation': 1, 'paragraphs': ['大家晚上好欢迎来到今天的直播', '下面开始介绍今天的新内容']})
        entered = asyncio.Event(); finish = asyncio.Event()
        async def transcribe(*args):
            entered.set(); await finish.wait()
            return {'words': [{'text':'大家晚上好欢迎来到今天的直播', 'start':0, 'end':1}], 'inference_ms': 30}
        # The recognizer starts at 1.4 seconds; feed two seconds to enter it.
        pcm = (np.ones(32000, dtype='<i2') * 1000).tobytes()
        with patch.object(service, 'transcribe', transcribe):
            runner = asyncio.create_task(session.recognition_loop())
            await session.audio(struct.pack('<II', 1, 0) + pcm)
            await asyncio.wait_for(entered.wait(), 2)
            session.reset({'generation': 2, 'paragraph': 1})
            finish.set(); await asyncio.sleep(.03)
            self.assertEqual(ws.messages, [])
            self.assertEqual(len(session.samples), 0)
            await session.audio(struct.pack('<II', 1, 1) + pcm)
            self.assertEqual(len(session.samples), 0)
            session.closed = True; runner.cancel()
            await asyncio.gather(runner, return_exceptions=True)

    async def test_buffer_is_bounded_and_overload_is_visible(self):
        ws = FakeSocket(); session = AudioSession(ws)
        session.reset({'generation':1,'paragraphs':['测试讲稿内容']})
        pcm = (np.ones(16000, dtype='<i2') * 1000).tobytes()
        for i in range(15): await session.audio(struct.pack('<II',1,i)+pcm)
        self.assertLessEqual(len(session.samples), 16000 * 12)
        self.assertTrue(any(m['type'] == 'gap' for m in ws.messages))


class OriginTests(unittest.TestCase):
    def test_ui_entry_cannot_be_reused_from_http_cache(self):
        with patch.object(service, 'start'), TestClient(app, raise_server_exceptions=True) as client:
            for path in ['/', '/?view=presenter&session=cache-test', '/index.html']:
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers.get('cache-control'), 'no-store')

    def test_origins(self):
        self.assertTrue(allowed_origin('http://127.0.0.1:8765'))
        self.assertFalse(allowed_origin('https://untrusted.example'))
        self.assertFalse(allowed_origin('http://127.0.0.1.attacker.test:8765'))
        self.assertFalse(allowed_origin('null'))

    def test_foreign_origin_cannot_retry_model(self):
        with patch.object(service, 'start'), TestClient(app, raise_server_exceptions=True) as client:
            self.assertEqual(client.post('/api/model/retry', headers={'origin':'https://untrusted.example'}).status_code, 403)


if __name__ == '__main__': unittest.main()
