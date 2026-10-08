const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkRelease, checkOnline, normalizeRepository, resolveRepository } = require('./check-release.cjs');

const source = path.join(__dirname, '..');
const retired = 's2901457171' + '-arch';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yusui-release-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'desktop'));
  for (const file of ['package.json', 'README.md', 'desktop/runtime-download.json']) fs.copyFileSync(path.join(source, file), path.join(root, file));
  return root;
}
function changeManifest(root, values) {
  const file = path.join(root, 'desktop/runtime-download.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...values }));
}

test('repository configuration supports explicit and CI overrides', () => {
  const pkg = { repository: { url: 'https://github.com/example/project.git' } };
  assert.equal(resolveRepository(pkg, undefined, {}), 'example/project');
  assert.equal(resolveRepository(pkg, undefined, { GITHUB_REPOSITORY: 'ci/fork' }), 'ci/fork');
  assert.equal(resolveRepository(pkg, 'publisher/fork', { GITHUB_REPOSITORY: 'ci/fork' }), 'publisher/fork');
  assert.equal(normalizeRepository('git+https://github.com/example/project.git'), 'example/project');
  for (const value of [`${retired.toUpperCase()}/project`, 'https://evil.example/a/b', 'owner/repo/extra', 'https://github.com/a/b?download=1']) assert.throws(() => normalizeRepository(value));
  assert.throws(() => resolveRepository({}, undefined, {}));
});

test('current release URLs and manifest pass', t => {
  const result = checkRelease(fixture(t), { env: {} });
  assert.equal(result.manifest.url, result.clientURL.replace('Yusui-win-x64.zip', 'python-runtime-win-x64.zip'));
});

test('packaged manifest rejects wrong owner, version and asset name', t => {
  const root = fixture(t);
  const config = checkRelease(root, { env: {} });
  const original = config.manifest.url;
  for (const url of [original.replace(`/${config.repository}/`, '/another-owner/project/'), original.replace(`/v${config.version}/`, '/v0.0.0-invalid/'), original.replace('win-x64', 'linux-x64')]) {
    changeManifest(root, { url });
    assert.throws(() => checkRelease(root, { env: {} }), /Runtime URL/);
  }
});

test('a shipped directory without source package metadata is checked', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'package.json'));
  assert.equal(checkRelease(root, { env: {} }).manifest.url, checkRelease(source, { env: {} }).manifest.url);
});

test('invalid checksums and byte counts block packaging', t => {
  const root = fixture(t);
  changeManifest(root, { sha256: 'bad', bytes: 0 });
  assert.throws(() => checkRelease(root, { env: {} }), /checksum or byte count/);
});

test('old owner in another publishing file or notes is rejected', t => {
  const root = fixture(t);
  const notes = path.join(root, 'release-notes.md');
  fs.writeFileSync(notes, `https://raw.githubusercontent.com/${retired}/project/commit/image.jpg`);
  assert.throws(() => checkRelease(root, { env: {} }), /Retired owner/);
  fs.writeFileSync(notes, 'https://raw.githubusercontent.com/wrong/project/commit/image.jpg');
  assert.throws(() => checkRelease(root, { env: {}, releaseNotes: notes }), /screenshot repository/);
});

test('README must contain the versioned client download', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'README.md'), 'No Windows download link');
  assert.throws(() => checkRelease(root, { env: {} }), /README/);
});

test('online check verifies assets and rejects checksum drift', async t => {
  const config = checkRelease(fixture(t), { env: {} });
  const release = { tag_name: `v${config.version}`, draft: false, body: '', assets: [
    { name: 'Yusui-win-x64.zip', state: 'uploaded', browser_download_url: config.clientURL },
    { name: 'python-runtime-win-x64.zip', state: 'uploaded', browser_download_url: config.manifest.url, size: config.manifest.bytes, digest: `sha256:${config.manifest.sha256}` },
  ] };
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({ ok: true, json: async () => release });
  await checkOnline(config);
  release.assets[1].digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(checkOnline(config), /SHA-256/);
  release.assets.pop();
  await assert.rejects(checkOnline(config), /Missing or incorrect/);
});
