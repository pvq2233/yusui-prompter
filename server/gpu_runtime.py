"""Prepare optional Windows CUDA libraries before starting the model worker."""
from __future__ import annotations

import os
from pathlib import Path
import site
import subprocess
import sys
import threading
import time


LIBRARIES = ('cublas64_12.dll', 'cublasLt64_12.dll', 'cudnn64_9.dll',
             'cudnn_ops64_9.dll', 'cudnn_cnn64_9.dll', 'cudnn_engines_precompiled64_9.dll')


def missing_libraries() -> list[str]:
    folders = [Path(p) for p in os.environ.get('PROMPTER_CUDA_PATH', '').split(os.pathsep) if p]
    for package_path in site.getsitepackages():
        folders.extend(Path(package_path).glob('nvidia/*/bin'))
    return [name for name in LIBRARIES if not any((folder / name).is_file() for folder in folders)]


def install_packages(root: Path, report, cancelled: threading.Event) -> None:
    log_path = root / 'data' / 'gpu-install.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, '-m', 'pip', 'install', '--upgrade', '--force-reinstall',
               '-r', str(root / 'requirements-gpu.txt'), '--disable-pip-version-check',
               '--no-input', '--progress-bar', 'off', '--timeout', '60', '--retries', '2']
    env = {**os.environ, 'PYTHONUNBUFFERED': '1', 'PYTHONIOENCODING': 'utf-8'}
    with log_path.open('w', encoding='utf-8') as output:
        process = subprocess.Popen(command, cwd=root, env=env, stdout=output,
                                   stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            deadline = time.monotonic() + 30 * 60
            with log_path.open(encoding='utf-8', errors='replace') as reader:
                pending = ''
                while True:
                    pending += reader.read()
                    lines = pending.split('\n')
                    pending = lines.pop()
                    for line in lines:
                        line = line.strip()
                        if line.startswith('Downloading '):
                            report('正在下载 GPU 加速库，请保持联网…\n' + line[:220])
                        elif line.startswith('Using cached '):
                            report('正在准备 GPU 加速库（使用下载缓存）…\n' + line[:220])
                        elif line.startswith('Installing collected packages:'):
                            report('GPU 加速库下载完成，正在安装 cuBLAS / cuDNN…')
                    if cancelled.is_set():
                        raise RuntimeError('已取消 GPU 加速库安装')
                    code = process.poll()
                    if code is not None:
                        if code:
                            raise RuntimeError('GPU 加速库下载或安装失败，请检查网络后点击重试；详情见 data/gpu-install.log')
                        return
                    if time.monotonic() > deadline:
                        raise RuntimeError('GPU 加速库下载超时，请检查网络后点击重试')
                    cancelled.wait(.25)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def ensure_gpu_runtime(root: Path, device: str, report, cancelled: threading.Event) -> None:
    if device == 'cpu' or sys.platform != 'win32':
        return
    import ctranslate2
    if ctranslate2.get_cuda_device_count() == 0:
        return
    report('已检测到 NVIDIA 显卡，正在检查 GPU 加速库…')
    if not missing_libraries():
        return
    report('正在下载 GPU 加速库（cuBLAS / cuDNN），首次下载可能需要几分钟，请保持联网…')
    install_packages(root, report, cancelled)
    missing = missing_libraries()
    if missing:
        raise RuntimeError('GPU 加速库安装不完整（' + ', '.join(missing) + '），请点击重试')
    report('GPU 加速库已安装，正在准备 Whisper small…')
