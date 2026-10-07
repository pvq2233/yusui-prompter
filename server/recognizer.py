"""Runs only in a dedicated child process. No microphone audio leaves this host."""
import os
from pathlib import Path
import time
import site

_model = None
_info = None
_dll_handles = []
_simplify = None


def warm_model(config: dict) -> dict:
    global _model, _info, _simplify
    if _model is not None:
        return _info
    # Optional CUDA DLLs can be supplied without modifying the machine PATH.
    if os.name == "nt":
        folders = os.environ.get("PROMPTER_CUDA_PATH", "").split(os.pathsep)
        for package_path in site.getsitepackages():
            folders.extend(str(p) for p in Path(package_path).glob('nvidia/*/bin'))
        for folder in folders:
            if folder and Path(folder).is_dir():
                _dll_handles.append(os.add_dll_directory(folder))
                os.environ['PATH'] = folder + os.pathsep + os.environ.get('PATH', '')
    import ctranslate2
    import numpy as np
    from faster_whisper import WhisperModel
    from opencc import OpenCC
    _simplify = OpenCC('t2s')
    device = config.get("device", "auto")
    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() else "cpu"
    model_path = config.get("model_path")
    if not model_path:
        cache = Path(config['cache']) / 'models--Systran--faster-whisper-small'
        revision = cache / 'refs' / 'main'
        snapshot = cache / 'snapshots' / revision.read_text().strip() if revision.exists() else None
        model_path = str(snapshot) if snapshot and (snapshot / 'model.bin').exists() else 'small'
    warning = ""
    try:
        _model = WhisperModel(model_path, device=device, compute_type="float16" if device == "cuda" else "int8", download_root=config["cache"], cpu_threads=4)
        # Consume the generator: constructing it alone does not run CUDA kernels.
        list(_model.transcribe(np.zeros(16000, dtype=np.float32), language="zh", beam_size=1, vad_filter=False)[0])
    except Exception as exc:
        if device != "cuda" or config.get("device") == "cuda":
            _model = None
            raise
        warning = f"GPU 初始化失败，已切换 CPU INT8（{type(exc).__name__}）"
        device = "cpu"
        _model = WhisperModel(model_path, device="cpu", compute_type="int8", download_root=config["cache"], cpu_threads=4)
        list(_model.transcribe(np.zeros(16000, dtype=np.float32), language="zh", beam_size=1, vad_filter=False)[0])
    _info = {"device": device, "compute_type": "float16" if device == "cuda" else "int8", "model": "small", "warning": warning}
    return _info


def decode(samples, origin: float, language: str) -> dict:
    if _model is None:
        raise RuntimeError("模型尚未加载")
    started = time.perf_counter()
    segments, _ = _model.transcribe(samples, language=language or None, task="transcribe", beam_size=1,
        word_timestamps=True, condition_on_previous_text=False, temperature=0,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 350, "speech_pad_ms": 150},
        initial_prompt=None)
    words = []
    for segment in segments:
        # Reject repetitive hallucinations, but not genuine speech solely because
        # one short-window confidence score is low.
        if segment.compression_ratio > 2.4 or (segment.no_speech_prob > .7 and segment.avg_logprob < -1.0):
            continue
        for word in segment.words or []:
            words.append({"text": _simplify.convert(word.word) if language == 'zh' else word.word, "start": word.start + origin, "end": word.end + origin})
    return {"words": words, "inference_ms": round((time.perf_counter() - started) * 1000)}
