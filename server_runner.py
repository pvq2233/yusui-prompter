"""Local launcher; shared by the Windows shortcut and command-line use."""
import argparse
import json
import os
from pathlib import Path
import sys
import uvicorn


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--device', choices=['auto', 'cuda', 'cpu'], default='auto')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    os.chdir(root)
    os.environ['PROMPTER_PORT'] = str(args.port)
    os.environ['PROMPTER_DEVICE'] = args.device
    (root / 'data').mkdir(exist_ok=True)
    owner = os.environ.get('PROMPTER_DESKTOP_OWNER')
    state_file = f'desktop-server-{args.port}.json' if owner else 'server.json'
    (root / 'data' / state_file).write_text(json.dumps({'pid':os.getpid(), 'port':args.port, 'python':sys.executable, 'owner':owner}), encoding='utf-8')
    uvicorn.run('server.app:app', host='127.0.0.1', port=args.port, ws_max_size=1000000, log_level='info')
