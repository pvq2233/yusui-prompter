import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from release_repository import normalize_repository, resolve_repository


class ReleaseRepositoryTests(unittest.TestCase):
    def test_configuration_precedence(self):
        package = {'repository': {'url': 'https://github.com/example/project.git'}}
        self.assertEqual(resolve_repository(package, environ={}), 'example/project')
        self.assertEqual(resolve_repository(package, environ={'GITHUB_REPOSITORY': 'ci/fork'}), 'ci/fork')
        self.assertEqual(resolve_repository(package, 'publisher/fork', {'GITHUB_REPOSITORY': 'ci/fork'}), 'publisher/fork')

    def test_git_url_and_string_metadata(self):
        self.assertEqual(normalize_repository('git+https://github.com/example/project.git'), 'example/project')
        self.assertEqual(resolve_repository({'repository': 'example/project'}, environ={}), 'example/project')

    def test_invalid_and_retired_repositories_fail_closed(self):
        retired = 's2901457171' + '-arch'
        for value in [f'{retired.upper()}/project', 'https://evil.example/a/b', 'owner/repo/extra', 'https://github.com/a/b?download=1']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_repository(value)
        with self.assertRaises(ValueError):
            resolve_repository({}, environ={})

    def test_builder_rejects_retired_owner_before_staging(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'output'
            result = subprocess.run([sys.executable, str(root / 'scripts/build-runtime.py'), '--output', str(output), '--repository', 's2901457171' + '-arch/project'], capture_output=True, text=True, env={**os.environ, 'GITHUB_REPOSITORY': 'ci/fork'})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('retired repository owner', result.stderr)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
