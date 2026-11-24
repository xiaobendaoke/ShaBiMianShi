import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isUpToDate(output, inputs) {
  if (!fs.existsSync(output)) return false;
  const outStat = fs.statSync(output);
  if (outStat.size === 0) return false;
  return inputs.every(input => fs.existsSync(input) && fs.statSync(input).mtimeMs <= outStat.mtimeMs);
}

function findWindowsCsc() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'FrameworkArm64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

export function buildNativeAudio({ force = false, targetArch = process.arch, optional = false } = {}) {
  const resourcesDir = path.join(root, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });

  if (process.platform === 'darwin') {
    const src = path.join(root, 'native/SystemAudio.swift');
    const plist = path.join(root, 'native/SystemAudio-Info.plist');
    const out = path.join(resourcesDir, 'system-audio');
    if (!force && isUpToDate(out, [src, plist])) return out;

    const swiftArch = targetArch === 'x64' ? 'x86_64' : 'arm64';
    try {
      execFileSync(
        'swiftc',
        [
          '-module-cache-path',
          path.join(os.tmpdir(), 'interviewdog-swift-cache'),
          '-target',
          `${swiftArch}-apple-macosx13.0`,
          '-parse-as-library',
          '-O',
          '-Xlinker',
          '-sectcreate',
          '-Xlinker',
          '__TEXT',
          '-Xlinker',
          '__info_plist',
          '-Xlinker',
          plist,
          src,
          '-o',
          out
        ],
        { cwd: root, stdio: 'inherit' }
      );
      return out;
    } catch (error) {
      if (optional) {
        console.warn('[native-audio] swiftc unavailable, skipping native helper build:', error.message);
        return null;
      }
      throw error;
    }
  }

  if (process.platform === 'win32') {
    const src = path.join(root, 'native/SystemAudio.cs');
    const out = path.join(resourcesDir, 'system-audio.exe');
    if (!force && isUpToDate(out, [src])) return out;

    const csc = findWindowsCsc();
    if (!csc) {
      if (optional) {
        console.warn('[native-audio] Built-in .NET csc.exe not found; WebAudio loopback fallback will be used.');
        return null;
      }
      throw new Error('未找到 Windows 内置 C# 编译器 (csc.exe)，无法编译 system-audio.exe');
    }

    execFileSync(
      csc,
      ['/nologo', '/optimize+', '/unsafe', '/target:exe', '/platform:anycpu', `/out:${out}`, src],
      { cwd: root, stdio: 'inherit', windowsHide: true }
    );
    return out;
  }

  return null;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const optional = process.argv.includes('--optional');
  const force = process.argv.includes('--force');
  const built = buildNativeAudio({ force, optional });
  if (built) console.log('Native system audio helper ready:', built);
}
