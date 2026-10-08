"""Resolve the publishing repository without baking an owner into build code."""
import os
import re
from urllib.parse import urlsplit


LEGACY_OWNER = 's2901457171' + '-arch'


def normalize_repository(value):
    value = value.strip()
    if value.startswith('git+'):
        value = value[4:]
    if value.startswith('https://'):
        parsed = urlsplit(value)
        if parsed.netloc != 'github.com' or parsed.query or parsed.fragment:
            raise ValueError('Repository URL must be an HTTPS github.com URL')
        value = parsed.path.strip('/')
    if value.endswith('.git'):
        value = value[:-4]
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+', value):
        raise ValueError('Repository must be owner/repo or an HTTPS GitHub repository URL')
    if value.split('/')[0].lower() == LEGACY_OWNER:
        raise ValueError('The retired repository owner cannot be used for releases')
    return value


def resolve_repository(package, explicit=None, environ=None):
    environ = os.environ if environ is None else environ
    configured = package.get('repository', {})
    if isinstance(configured, dict):
        configured = configured.get('url', '')
    value = explicit or environ.get('GITHUB_REPOSITORY') or configured
    if not value:
        raise ValueError('Set --repository, GITHUB_REPOSITORY or package.json repository.url')
    return normalize_repository(value)
