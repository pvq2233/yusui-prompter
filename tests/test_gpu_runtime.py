import asyncio
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock

from server.gpu_runtime import ensure_gpu_runtime, install_packages, missing_libraries, LIBRARIES
from server.app import ModelService


class GpuRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.cancelled = threading.Event()
        self.report = Mock()

    def test_cpu_does_not_detect_or_install_gpu(self):
        with patch('ctranslate2.get_cuda_device_count') as count, patch('server.gpu_runtime.install_packages') as install:
            ensure_gpu_runtime(Path('.'), 'cpu', self.report, self.cancelled)
        count.assert_not_called()
        install.assert_not_called()

    @patch('server.gpu_runtime.sys.platform', 'win32')
    @patch('ctranslate2.get_cuda_device_count', return_value=0)
    def test_no_nvidia_does_not_download(self, count):
        with patch('server.gpu_runtime.install_packages') as install:
            ensure_gpu_runtime(Path('.'), 'auto', self.report, self.cancelled)
        install.assert_not_called()

    @patch('server.gpu_runtime.sys.platform', 'win32')
    @patch('ctranslate2.get_cuda_device_count', return_value=1)
    def test_cached_complete_runtime_does_not_redownload(self, count):
        with patch('server.gpu_runtime.missing_libraries', return_value=[]), patch('server.gpu_runtime.install_packages') as install:
            ensure_gpu_runtime(Path('.'), 'auto', self.report, self.cancelled)
        install.assert_not_called()

    @patch('server.gpu_runtime.sys.platform', 'win32')
    @patch('ctranslate2.get_cuda_device_count', return_value=1)
    def test_missing_runtime_installs_and_reports_download(self, count):
        with patch('server.gpu_runtime.missing_libraries', side_effect=[['cublas64_12.dll'], []]), patch('server.gpu_runtime.install_packages') as install:
            ensure_gpu_runtime(Path('.'), 'auto', self.report, self.cancelled)
        install.assert_called_once()
        self.assertTrue(any('正在下载 GPU' in call.args[0] for call in self.report.call_args_list))

    @patch('server.gpu_runtime.sys.platform', 'win32')
    @patch('ctranslate2.get_cuda_device_count', return_value=1)
    def test_incomplete_install_is_not_reported_as_ready(self, count):
        with patch('server.gpu_runtime.missing_libraries', return_value=['cublas64_12.dll']), patch('server.gpu_runtime.install_packages'):
            with self.assertRaisesRegex(RuntimeError, '安装不完整'):
                ensure_gpu_runtime(Path('.'), 'auto', self.report, self.cancelled)

    def test_checks_libraries_in_custom_path(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in LIBRARIES:
                (Path(folder) / name).touch()
            with patch.dict('os.environ', {'PROMPTER_CUDA_PATH': folder}), patch('site.getsitepackages', return_value=[]):
                self.assertEqual(missing_libraries(), [])
                (Path(folder) / LIBRARIES[0]).unlink()
                self.assertEqual(missing_libraries(), [LIBRARIES[0]])

    def test_pip_failure_is_actionable_and_logged(self):
        with tempfile.TemporaryDirectory() as folder, patch('subprocess.Popen') as popen:
            process = popen.return_value
            process.poll.return_value = 1
            with self.assertRaisesRegex(RuntimeError, '检查网络后点击重试'):
                install_packages(Path(folder), self.report, self.cancelled)
            command = popen.call_args.args[0]
            self.assertIn('--force-reinstall', command)
            self.assertIn(str(Path(folder) / 'requirements-gpu.txt'), command)
            self.assertTrue((Path(folder) / 'data/gpu-install.log').exists())

    def test_cancel_terminates_installer(self):
        self.cancelled.set()
        with tempfile.TemporaryDirectory() as folder, patch('subprocess.Popen') as popen:
            popen.return_value.poll.return_value = None
            with self.assertRaisesRegex(RuntimeError, '已取消'):
                install_packages(Path(folder), self.report, self.cancelled)
            popen.return_value.terminate.assert_called_once()


class GpuModelServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_download_never_starts_model_and_retry_rechecks(self):
        model = ModelService()
        with patch('server.app.ensure_gpu_runtime', side_effect=RuntimeError('下载失败')), patch('server.app.ProcessPoolExecutor') as pool:
            await model.load()
            self.assertEqual(model.status['state'], 'error')
            self.assertIn('下载失败', model.status['message'])
            pool.assert_not_called()
        with patch('server.app.ensure_gpu_runtime', side_effect=RuntimeError('再次检查')) as prepare:
            await model.load()
            prepare.assert_called_once()

    async def test_download_progress_is_visible_before_model_worker_starts(self):
        model = ModelService()
        entered = threading.Event()
        finish = threading.Event()
        def prepare(root, device, report, cancelled):
            report('正在下载 GPU 加速库…')
            entered.set()
            finish.wait(2)
            raise RuntimeError('受控结束')
        with patch('server.app.ensure_gpu_runtime', prepare), patch('server.app.ProcessPoolExecutor') as pool:
            task = asyncio.create_task(model.load())
            await asyncio.to_thread(entered.wait, 2)
            self.assertEqual(model.status['phase'], 'gpu')
            self.assertIn('正在下载', model.status['message'])
            pool.assert_not_called()
            finish.set()
            await task


if __name__ == '__main__':
    unittest.main()
