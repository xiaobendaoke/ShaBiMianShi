import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') throw Error('This release script must be run on Windows.');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const unpackedDir = path.join(root, 'release/win-unpacked');
const exePath = path.join(unpackedDir, '傻逼面试.exe');
if (!fs.existsSync(exePath)) throw Error('Run npm run pack:win first.');

const filename = `ShaBiMianShi-${pkg.version}-win-${process.arch}-portable.zip`;
const output = path.join(root, 'release', filename);
if (fs.existsSync(output)) fs.rmSync(output, { force: true });

const stagingParent = path.join(root, 'release');
fs.mkdirSync(stagingParent, { recursive: true });
const stagingRoot = fs.mkdtempSync(path.join(stagingParent, 'win-zip-'));
const asciiFolder = path.join(stagingRoot, 'ShaBiMianShi');
const appFolder = path.join(stagingRoot, '傻逼面试');

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function resolvePowerShell() {
  for (const bin of ['pwsh.exe', 'pwsh', 'powershell.exe']) {
    try {
      execFileSync(bin, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore' });
      return bin;
    } catch {}
  }
  return 'powershell.exe';
}

try {
  // Stage into an ASCII directory first to avoid Node 22 Windows fs.cpSync CJK target path bug,
  // then rename the populated directory to the final Chinese folder name before zipping.
  fs.cpSync(unpackedDir, asciiFolder, { recursive: true });
  fs.writeFileSync(
    path.join(asciiFolder, '使用说明.txt'),
    [
      '【傻逼面试 Windows 免安装版使用说明】',
      '',
      '1. 请先将压缩包完整解压到任意目录（不要直接在压缩包内双击运行），然后双击“傻逼面试.exe”启动。',
      '2. 当前版本未购买商业 EV 代码签名证书，首次启动如遇 Windows SmartScreen 提示“Windows 已保护你的电脑”，请点击“更多信息” -> “仍要运行”。',
      '3. 首次使用请在左侧“模型与 API”中配置你自己的模型 API（问答、图片、语音转写、向量服务）；本压缩包不包含任何个人简历、知识库或 API 密钥。',
      '4. 采集系统声音使用 Windows 原生 WASAPI Loopback（无需额外安装虚拟声卡）；开启“隐身模式”可防常见会议软件共享屏幕采集。',
      '',
      '项目主页与使用指南：https://github.com/xiaobendaoke/ShaBiMianShi',
      ''
    ].join('\r\n'),
    'utf8'
  );
  fs.renameSync(asciiFolder, appFolder);
  if (!fs.existsSync(path.join(appFolder, '傻逼面试.exe'))) {
    throw new Error('Staged Windows portable folder is missing 傻逼面试.exe');
  }

  const psScript = [
    '$ErrorActionPreference = "Stop";',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `[System.IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(appFolder)}, ${psQuote(output)}, [System.IO.Compression.CompressionLevel]::Optimal, $true, [System.Text.Encoding]::UTF8)`
  ].join(' ');
  const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
  const shellBin = resolvePowerShell();

  execFileSync(shellBin, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
    stdio: 'inherit'
  });

  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${filename}\n`, 'utf8');
  console.log('ZIP:', output);
  console.log('SHA256:', `${digest}  ${filename}`);
} catch (err) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::error title=create-win-zip failed::${String(err?.stack || err).replace(/\r?\n/g, ' | ')}`);
  }
  throw err;
} finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
