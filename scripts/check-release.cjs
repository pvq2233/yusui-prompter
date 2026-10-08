const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const legacyOwner = 's2901457171' + '-arch';
const ignored = new Set(['.git', 'node_modules', 'data', 'client', 'dist', 'release', '.venv', '__pycache__', 'test-results', 'playwright-report']);

function normalizeRepository(value) {
  value = value.trim().replace(/^git\+/, '');
  if (value.startsWith('https://')) {
    const url = new URL(value);
    if (url.host !== 'github.com' || url.username || url.password || url.search || url.hash) throw new Error('Repository must use HTTPS github.com');
    value = url.pathname.replace(/^\/+|\/+$/g, '');
  }
  value = value.replace(/\.git$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('Repository must be owner/repo or an HTTPS GitHub repository URL');
  if (value.split('/')[0].toLowerCase() === legacyOwner) throw new Error('The retired repository owner cannot be used for releases');
  return value;
}

function resolveRepository(pkg, explicit, env = process.env) {
  const configured = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const value = explicit || env.GITHUB_REPOSITORY || configured;
  if (!value) throw new Error('Set --repository, GITHUB_REPOSITORY or package.json repository.url');
  return normalizeRepository(value);
}

function scanLegacy(root) {
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (ignored.has(item.name) || item.isSymbolicLink()) continue;
    const file = path.join(root, item.name);
    if (item.isDirectory()) scanLegacy(file);
    else if (/\.(md|json|py|cjs|js|ts|tsx|ps1|cmd|txt|ya?ml|html|css)$/.test(item.name)) {
      if (fs.readFileSync(file, 'utf8').toLowerCase().includes(legacyOwner)) throw new Error(`Retired owner found in ${file}`);
    }
  }
}

function checkRelease(root, options = {}) {
  // Shipped ZIPs omit the source package.json; validate them against this checkout.
  const packagePath = fs.existsSync(path.join(root, 'package.json')) ? path.join(root, 'package.json') : path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const repository = resolveRepository(pkg, options.repository, options.env);
  const base = `https://github.com/${repository}/releases/download/v${pkg.version}/`;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'desktop/runtime-download.json'), 'utf8'));
  if (manifest.url !== base + 'python-runtime-win-x64.zip') throw new Error(`Runtime URL must be ${base}python-runtime-win-x64.zip`);
  if (!/^[0-9a-f]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0) throw new Error('Invalid runtime checksum or byte count');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  if (!readme.includes(`](${base}Yusui-win-x64.zip)`)) throw new Error('README must link to the matching version of Yusui-win-x64.zip');
  scanLegacy(root);
  if (options.releaseNotes) {
    const notes = fs.readFileSync(options.releaseNotes, 'utf8');
    if (notes.toLowerCase().includes(legacyOwner)) throw new Error('Retired owner found in release notes');
    for (const match of notes.matchAll(/https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\//g)) {
      if (match[1] !== repository) throw new Error('Release screenshot repository does not match publishing repository');
    }
  }
  return { repository, version: pkg.version, manifest, clientURL: base + 'Yusui-win-x64.zip' };
}

async function checkOnline(config) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'yusui-release-check' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com/repos/${config.repository}/releases/tags/v${config.version}`, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`);
  const release = await response.json();
  if (release.draft || release.tag_name !== `v${config.version}`) throw new Error('Expected a published release with the matching tag');
  for (const [name, url] of [['Yusui-win-x64.zip', config.clientURL], ['python-runtime-win-x64.zip', config.manifest.url]]) {
    const asset = release.assets.find(item => item.name === name);
    if (!asset || asset.state !== 'uploaded' || asset.browser_download_url !== url) throw new Error(`Missing or incorrect release asset: ${name}`);
    if (name.startsWith('python-runtime') && (asset.size !== config.manifest.bytes || asset.digest !== `sha256:${config.manifest.sha256}`)) throw new Error('Runtime asset size or SHA-256 differs from the manifest');
  }
  const notes = release.body || '';
  if (notes.toLowerCase().includes(legacyOwner)) throw new Error('Retired owner found in published release notes');
  for (const match of notes.matchAll(/https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\//g)) {
    if (match[1] !== config.repository) throw new Error('Published screenshot repository does not match publishing repository');
  }
}

if (require.main === module) {
  (async () => {
    const { values } = parseArgs({ options: { root: { type: 'string' }, repository: { type: 'string' }, 'release-notes': { type: 'string' }, online: { type: 'boolean', default: false } } });
    const config = checkRelease(path.resolve(values.root || path.join(__dirname, '..')), { repository: values.repository, releaseNotes: values['release-notes'] });
    if (values.online) await checkOnline(config);
    console.log(`Release links verified: ${config.repository} v${config.version}${values.online ? ' (published assets verified)' : ''}`);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { checkRelease, checkOnline, normalizeRepository, resolveRepository };
