"""Build the small, standalone Python asset used by the Windows release."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import sys
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
stage = output / 'python-runtime'
if stage.exists():
    raise RuntimeError(f'Choose a fresh staging directory: {stage}')
base = Path(sys.base_prefix)
ignore = shutil.ignore_patterns('__pycache__', '*.pyc', 'site-packages', 'test', 'tests', 'idlelib', 'turtledemo')
shutil.copytree(base / 'Lib', stage / 'Lib', ignore=ignore)
shutil.copytree(base / 'DLLs', stage / 'DLLs', ignore=ignore)
scripts = stage / 'Scripts'
scripts.mkdir()
for file in base.iterdir():
    if file.is_file() and (file.suffix.lower() == '.dll' or file.name in ['python.exe', 'LICENSE.txt']):
        shutil.copy2(file, scripts / file.name)
paths = '../Lib\n../DLLs\n../Lib/site-packages\n../../..\nimport site\n'
for name in ['python._pth', f'python{sys.version_info.major}{sys.version_info.minor}._pth']:
    (scripts / name).write_text(paths, encoding='utf-8')
packages = stage / 'Lib/site-packages'
packages.mkdir()
(packages / 'sitecustomize.py').write_text('''from pathlib import Path
import sys
import site
_runtime = Path(__file__).resolve().parents[2]
sys.prefix = sys.exec_prefix = sys.base_prefix = sys.base_exec_prefix = str(_runtime)
site.PREFIXES[:] = [str(_runtime)]
sys.path[:] = [str(_runtime / 'Lib'), str(_runtime / 'DLLs'), str(_runtime / 'Lib/site-packages'), str(_runtime.parent.parent)]
''', encoding='utf-8')
asset = output / 'python-runtime-win-x64.zip'
with zipfile.ZipFile(asset, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(stage.rglob('*')):
        if file.is_file():
            archive.write(file, file.relative_to(stage))
version = json.loads((root / 'package.json').read_text())['version']
manifest = {
    'python_version': sys.version.split()[0],
    'url': f'https://github.com/s2901457171-arch/yusui-prompter/releases/download/v{version}/{asset.name}',
    'sha256': hashlib.sha256(asset.read_bytes()).hexdigest(),
    'bytes': asset.stat().st_size,
}
(root / 'desktop/runtime-download.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest))
