const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.dirname(__dirname);
const runtime = path.dirname(require('electron'));
const destination = path.join(root, 'client');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Run npm run build first.');
execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'create-icon.ps1')], { windowsHide: true, stdio: 'inherit' });
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(runtime, destination, { recursive: true, filter: (source, target) => {
  if (!fs.statSync(source).isFile() || !fs.existsSync(target)) return true;
  return createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== createHash('sha256').update(fs.readFileSync(target)).digest('hex');
} });
const updatedExe = path.join(destination, '语随.pending.exe');
fs.copyFileSync(path.join(destination, 'electron.exe'), updatedExe);
execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'set-exe-icon.ps1'),'-ExePath',updatedExe], { windowsHide: true, stdio: 'inherit' });
try { fs.renameSync(updatedExe, path.join(destination, '语随.exe')); }
catch { console.log('The running EXE will receive its new icon on the next start-client launch.'); }
fs.unlinkSync(path.join(destination, 'electron.exe'));
const resources = path.join(destination, 'resources', 'app');
fs.mkdirSync(resources, { recursive: true });
for (const name of ['main.cjs','preload.cjs','loading.html','loading.js','icon.png','icon.ico']) fs.copyFileSync(path.join(__dirname, name), path.join(resources, name));
fs.writeFileSync(path.join(resources, 'package.json'), JSON.stringify({ name: 'yusui-desktop', productName: '语随提词器', version: '1.1.0', main: 'main.cjs' }, null, 2));
console.log(`Desktop client ready: ${path.join(destination, '语随.exe')}`);
