import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertAppStopped, publishSingleDir } from './winAppRelease.js';
import { buildNativeAudio } from './build-native-audio.js';
import { ensureIcons } from './generate-icons.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const targetDir = path.join(root, 'release/win-unpacked');
const target = path.join(targetDir, '傻逼面试.exe');
assertAppStopped(target);

const { icoPath } = ensureIcons();
buildNativeAudio();
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const { buildId } = JSON.parse(fs.readFileSync(path.join(root, 'dist/build-info.json'), 'utf8'));
const runtime = path.join(root, 'node_modules/electron/dist');
const electronInstaller = path.join(root, 'node_modules/electron/install.js');
if (!fs.existsSync(path.join(runtime, 'electron.exe')) && fs.existsSync(electronInstaller)) {
  execFileSync(process.execPath, [electronInstaller], { cwd: root, stdio: 'inherit' });
}
if (!fs.existsSync(runtime)) throw new Error('Electron runtime is missing');
const release = path.join(root, 'release/builds', buildId);
const staging = path.join(release, '.傻逼面试-staging-win');
fs.mkdirSync(release, { recursive: true });
try {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(runtime, staging, { recursive: true });
  const payload = path.join(staging, 'resources/app');
  fs.mkdirSync(payload, { recursive: true });
  fs.cpSync(path.join(root, 'dist'), path.join(payload, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(payload, 'package.json'));
  // Exclude the macOS Mach-O helper binary when packaging for Windows.
  fs.cpSync(path.join(root, 'resources'), path.join(payload, 'resources'), {
    recursive: true,
    filter: source => path.basename(source) !== 'system-audio'
  });

  // Ship runtime dependencies only. Copying devDependencies embeds a second Electron
  // application and bloats the payload with build tooling.
  const copied = new Set();
  function copyDependency(name, from = root) {
    let cursor = from, source;
    while (true) {
      const candidate = path.join(cursor, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        source = candidate;
        break;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    if (!source) return; // Optional, non-host native packages may be absent.
    if (copied.has(source)) return;
    copied.add(source);
    const relative = path.relative(path.join(root, 'node_modules'), source);
    if (relative.startsWith('..')) throw Error('Dependency outside workspace: ' + name);
    fs.cpSync(source, path.join(payload, 'node_modules', relative), { recursive: true });
    const dependency = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    for (const child of Object.keys({ ...dependency.dependencies, ...dependency.optionalDependencies })) {
      copyDependency(child, source);
    }
  }
  for (const name of Object.keys(pkg.dependencies)) copyDependency(name);

  const stagedExe = path.join(staging, '傻逼面试.exe');
  fs.renameSync(path.join(staging, 'electron.exe'), stagedExe);

  // Stamp Windows PE icon and version metadata in an ASCII temp path so legacy rcedit ANSI argv
  // works reliably even when the repository resides inside a non-ASCII directory.
  const rceditCandidates = [
    path.join(root, 'node_modules/electron-winstaller/vendor/rcedit.exe'),
    path.join(root, 'node_modules/rcedit/bin/rcedit-x64.exe'),
    path.join(root, 'node_modules/rcedit/bin/rcedit.exe')
  ];
  const rcedit = rceditCandidates.find(candidate => fs.existsSync(candidate));
  if (process.platform === 'win32' && rcedit && fs.existsSync(icoPath)) {
    const asciiTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pe-'));
    try {
      const tmpRcedit = path.join(asciiTmp, 'rcedit.exe');
      const tmpExe = path.join(asciiTmp, 'app.exe');
      const tmpIco = path.join(asciiTmp, 'icon.ico');
      fs.copyFileSync(rcedit, tmpRcedit);
      fs.copyFileSync(stagedExe, tmpExe);
      fs.copyFileSync(icoPath, tmpIco);
      execFileSync(
        tmpRcedit,
        [
          tmpExe,
          '--set-icon', tmpIco,
          '--set-version-string', 'ProductName', '傻逼面试',
          '--set-version-string', 'FileDescription', '傻逼面试 - 知识库与面试辅助',
          '--set-version-string', 'CompanyName', 'Independent',
          '--set-version-string', 'InternalName', 'ShaBiMianShi',
          '--set-version-string', 'OriginalFilename', '傻逼面试.exe',
          '--set-file-version', pkg.version,
          '--set-product-version', pkg.version
        ],
        { stdio: 'inherit', windowsHide: true }
      );
      fs.copyFileSync(tmpExe, stagedExe);
    } catch (err) {
      console.warn('Warning: failed to stamp PE metadata via rcedit:', err.message);
    } finally {
      fs.rmSync(asciiTmp, { recursive: true, force: true });
    }
  }

  const previous = publishSingleDir(staging, targetDir);
  const manifest = path.join(root, 'release/latest-build-win.json');
  fs.writeFileSync(manifest + '.tmp', JSON.stringify({ buildId, path: target, appDir: targetDir }, null, 2));
  fs.renameSync(manifest + '.tmp', manifest);
  if (previous) console.log('Previous build archived to:', previous);
  console.log('Packaged application:', target);
} finally {
  fs.rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (fs.existsSync(release) && !fs.readdirSync(release).length) fs.rmdirSync(release);
}
