import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') throw Error('This release script must be run on macOS.');
const targetArch = process.env.TARGET_ARCH || (process.arch === 'x64' ? 'x64' : 'arm64');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const app = path.join(root, `release/mac-${targetArch}/傻逼面试.app`);
if (!fs.existsSync(app)) throw Error(`Run npm run pack first (expected ${app}).`);
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
const filename = `ShaBiMianShi-${pkg.version}-mac-${targetArch}.dmg`;
const output = path.join(root, 'release', filename);
if (fs.existsSync(output)) fs.rmSync(output, { force: true });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'shabimianshi-dmg-'));
try {
  fs.cpSync(app, path.join(staging, '傻逼面试.app'), { recursive: true, verbatimSymlinks: true });
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'));
  const archLabel = targetArch === 'arm64' ? 'Apple Silicon (arm64)' : 'Intel (x64)';
  fs.writeFileSync(
    path.join(staging, '安装说明.txt'),
    `将“傻逼面试.app”拖到 Applications，然后弹出磁盘映像，从应用程序打开。\n\n当前构建架构：macOS ${archLabel}，临时签名、未经 Apple 公证。首次打开如被拦截，请前往“系统设置 → 隐私与安全性”点击“仍要打开”。\n\n首次使用请配置自己的模型 API；不包含作者的资料或密钥。\n\n使用指南：https://github.com/xiaobendaoke/ShaBiMianShi\n`
  );
  execFileSync('hdiutil', ['create', '-volname', '傻逼面试', '-srcfolder', staging, '-format', 'UDZO', '-ov', output], { stdio: 'inherit' });
  execFileSync('hdiutil', ['verify', output], { stdio: 'inherit' });
  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.sha256', `${digest}  ${filename}\n`);
  console.log('DMG:', output);
  console.log('SHA256:', `${digest}  ${filename}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
