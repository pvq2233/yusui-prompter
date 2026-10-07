from __future__ import annotations
import asyncio
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
import json
import multiprocessing
import os
from pathlib import Path
import struct
import time
from urllib.parse import urlparse

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .core import GenerationGate, ScriptAligner, StableTranscript, TrackingConfig
from .recognizer import warm_model, decode

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("PROMPTER_PORT", "8765"))
ALLOWED_PORTS = {PORT, 5173}
RATE = 16000


def allowed_origin(origin: str | None) -> bool:
    if not origin:
        return True  # Native local clients do not set Origin.
    try:
        parsed = urlparse(origin)
        return parsed.scheme in ("http", "https") and parsed.hostname in ("localhost", "127.0.0.1", "[::1]", "::1") and parsed.port in ALLOWED_PORTS
    except ValueError:
        return False


class ModelService:
    def __init__(self):
        self.pool = None
        self.task = None
        self.status = {"state": "loading", "model": "small", "message": "正在准备 Whisper small，首次使用需下载模型"}
        self.active = False

    async def load(self):
        if self.status["state"] == "ready":
            return
        self.status = {"state": "loading", "model": "small", "message": "正在下载或加载 Whisper small…"}
        if self.pool is None:
            self.pool = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
        config = {"device": os.environ.get("PROMPTER_DEVICE", "auto"), "model_path": os.environ.get("WHISPER_MODEL_PATH"), "cache": str(ROOT / "data" / "models")}
        try:
            info = await asyncio.get_running_loop().run_in_executor(self.pool, warm_model, config)
            self.status = {"state": "ready", "message": "模型已就绪", **info}
        except Exception as exc:
            self.status = {"state": "error", "model": "small", "message": f"模型加载失败：{str(exc)[:500]}。可重试或设置 WHISPER_MODEL_PATH 使用本地 small 模型。"}
            self.pool.shutdown(wait=False, cancel_futures=True)
            self.pool = None

    def start(self):
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self.load())

    async def transcribe(self, samples, origin, language):
        return await asyncio.get_running_loop().run_in_executor(self.pool, decode, samples, origin, language)


service = ModelService()


@asynccontextmanager
async def lifespan(app):
    service.start()
    yield
    if service.task and not service.task.done():
        service.task.cancel()
    if service.pool:
        service.pool.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="语随直播提词器", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"])


@app.middleware("http")
async def local_requests(request: Request, call_next):
    if not allowed_origin(request.headers.get("origin")):
        return JSONResponse({"detail": "仅允许本机界面访问"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path in ("/", "/index.html"):
        # The HTML points at build-specific assets and must be fetched after an update.
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/status")
async def model_status():
    return {**service.status, "busy": service.active, "app": "whisper-live-prompter", "version": "1.0.0"}


@app.post("/api/model/retry")
async def retry_model():
    service.start()
    return service.status


class AudioSession:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.gate = GenerationGate()
        self.aligner = ScriptAligner([])
        self.stabilizer = StableTranscript()
        self.samples = np.empty(0, dtype=np.float32)
        self.origin = 0
        self.total = 0
        self.last_decode = 0
        self.last_voice = 0
        self.dirty = asyncio.Event()
        self.closed = False
        self.paused = False
        self.language = "zh"
        self.last_activity = time.monotonic()
        self.pending_final = False

    async def send(self, kind: str, generation=None, **data):
        await self.ws.send_json({"type": kind, "generation": self.gate.generation if generation is None else generation, **data})

    def reset(self, data):
        generation = int(data["generation"])
        self.gate.reset(generation)
        paragraphs = data.get("paragraphs", self.aligner.paragraphs)
        if not isinstance(paragraphs, list) or len(paragraphs) > 2000 or any(not isinstance(p, str) for p in paragraphs) or sum(map(len, paragraphs)) > 200000:
            raise ValueError("讲稿过大或格式无效（最多 20 万字、2000 段）")
        tracking = TrackingConfig.from_dict(data['tracking']) if 'tracking' in data else self.aligner.tracking
        self.aligner = ScriptAligner(paragraphs, int(data.get("paragraph", 0)), int(data.get("offset", 0)), tracking)
        self.stabilizer = StableTranscript()
        self.samples = np.empty(0, dtype=np.float32)
        self.origin = self.total = self.last_decode = self.last_voice = 0
        self.pending_final = False
        self.paused = bool(data.get("paused", False))
        self.language = data.get("language", "zh")
        if self.language not in ("zh", "en", ""):
            raise ValueError("不支持的识别语言")
        self.dirty.clear()

    def configure_tracking(self, data):
        if data.get('generation') != self.gate.generation:
            return False
        self.aligner.configure(TrackingConfig.from_dict(data['tracking']))
        return True

    async def audio(self, payload: bytes):
        if len(payload) < 10 or len(payload) > 64008 or (len(payload) - 8) % 2:
            raise ValueError("音频帧大小无效")
        generation, sequence = struct.unpack_from("<II", payload)
        if not self.gate.accept(generation, sequence):
            return
        chunk = np.frombuffer(payload, dtype="<i2", offset=8).astype(np.float32) / 32768.0
        self.samples = np.concatenate((self.samples, chunk))
        self.total += len(chunk)
        self.last_activity = time.monotonic()
        # Energy gates scheduling; Silero VAD inside the recognizer gates speech.
        if np.sqrt(np.mean(chunk * chunk)) > .006:
            self.last_voice = self.total
        self.pending_final = self.last_voice > 0 and self.total - self.last_voice >= int(.6 * RATE)
        if len(self.samples) > RATE * 12:
            cut = len(self.samples) - RATE * 8
            discarded_end = (self.origin + cut) / RATE
            if discarded_end > self.stabilizer.committed_until + .3 and self.last_voice > self.origin:
                self.stabilizer = StableTranscript()
                self.aligner.evidence = ""
                self.aligner.relocating = True
                await self.send("gap", message="识别暂时跟不上，部分音频已跳过；正在当前位置重新定位")
            self.samples = self.samples[cut:]
            self.origin += cut
        self.dirty.set()

    async def recognition_loop(self):
        while not self.closed:
            await self.dirty.wait()
            self.dirty.clear()
            if self.last_voice == 0 or self.total - self.last_decode < int(.7 * RATE):
                continue
            generation = self.gate.generation
            snapshot = self.samples.copy()
            origin, end = self.origin, self.total
            final = self.pending_final
            if len(snapshot) < RATE * 1.4 and not final:
                continue
            self.last_decode = end
            try:
                result = await service.transcribe(snapshot, origin / RATE, self.language)
                if generation != self.gate.generation or self.closed:
                    continue
                stable, partial = self.stabilizer.update(result["words"], final, end / RATE)
                await self.send("transcript", stable=stable, partial=partial, inference_ms=result["inference_ms"], lag_ms=round((self.total - end) / RATE * 1000), confirmed_audio_end=self.stabilizer.committed_until)
                if stable and not self.paused:
                    position = self.aligner.update(stable)
                    if position:
                        await self.send("position", **position)
                    elif self.aligner.paragraphs:
                        await self.send("uncertain", message="等待更多匹配文字")
                # Trim only committed material, retaining acoustic overlap.
                # Keep lexical context: trimming to a few hundred milliseconds
                # cuts Chinese syllables and can cause repeated hallucinations.
                trim_until = int(max(0, self.stabilizer.committed_until - 2.2) * RATE)
                trim = min(max(0, trim_until - self.origin), len(self.samples))
                if trim:
                    self.samples = self.samples[trim:]
                    self.origin += trim
                if final:
                    # Do not erase speech which arrived while this decode ran.
                    if self.last_voice <= end:
                        trim = min(max(0, end - self.origin), len(self.samples))
                        self.samples = self.samples[trim:]
                        self.origin += trim
                        self.last_voice = 0
                        self.pending_final = False
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await self.send("error", message=f"识别失败：{str(exc)[:220]}")
                self.closed = True
                await self.ws.close(code=1011)


@app.websocket("/ws/audio")
async def audio_socket(ws: WebSocket):
    if not allowed_origin(ws.headers.get("origin")):
        await ws.close(code=1008)
        return
    await ws.accept()
    if service.status["state"] != "ready" or service.active:
        await ws.send_json({"type": "error", "message": "模型未就绪" if service.status["state"] != "ready" else "麦克风识别已被另一个窗口占用"})
        await ws.close(code=1013)
        return
    service.active = True
    session = AudioSession(ws)
    consumer = asyncio.create_task(session.recognition_loop())
    try:
        await session.send("ready")
        while not session.closed:
            message = await asyncio.wait_for(ws.receive(), timeout=30)
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                await session.audio(message["bytes"])
            elif message.get("text") is not None:
                if len(message["text"]) > 800000:
                    raise ValueError("指令过大")
                data = json.loads(message["text"])
                if data.get("type") in ("start", "seek", "pause", "resume"):
                    session.reset(data)
                    await session.send("anchored")
                elif data.get('type') == 'tracking':
                    if session.configure_tracking(data):
                        await session.send('tracking_configured')
                elif data.get("type") == "ping":
                    await session.send("pong")
                elif data.get("type") == "stop":
                    # Finish the captured tail before releasing the session.
                    consumer.cancel()
                    await asyncio.gather(consumer, return_exceptions=True)
                    if session.last_voice and len(session.samples) >= RATE * .4:
                        result = await service.transcribe(session.samples.copy(), session.origin / RATE, session.language)
                        stable, _ = session.stabilizer.update(result["words"], True)
                        await session.send("transcript", stable=stable, partial="", inference_ms=result["inference_ms"], lag_ms=0)
                    break
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except (ValueError, KeyError, TypeError) as exc:
        try:
            await session.send("error", message=str(exc))
        except RuntimeError:
            pass
    finally:
        session.closed = True
        consumer.cancel()
        await asyncio.gather(consumer, return_exceptions=True)
        service.active = False
        try:
            await ws.close()
        except RuntimeError:
            pass


if (ROOT / "dist").exists():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="ui")
else:
    @app.get("/")
    async def no_build():
        return JSONResponse({"message": "请先运行 npm install 和 npm run build，或使用启动脚本"}, status_code=503)
