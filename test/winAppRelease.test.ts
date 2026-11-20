import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAppStopped, publishSingleDir } from '../scripts/winAppRelease.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'single-win-app-'));
const target = path.join(directory, 'release/win-unpacked');
const exe = path.join(target, '傻逼面试.exe');
const staging = path.join(directory, 'staging-win');
const archiveDir = path.join(directory, 'release/old');

const idle = () => 'INFO: No tasks are running which match the specified criteria.\r\n';
const runningExact = () => '"傻逼面试.exe","1234","Console","1","85,000 K"\r\n';
const runningMojibake = () => '"\ufffd\ufffd.exe","1234","Console","1","85,000 K"\r\n';

try {
  assert.doesNotThrow(() => assertAppStopped(exe, idle));
  assert.throws(() => assertAppStopped(exe, runningExact), /仍在运行/);
  assert.throws(() => assertAppStopped(exe, runningMojibake), /仍在运行/);
  assert.throws(() => assertAppStopped(exe, () => { throw Error('EPERM'); }), /无法确认/);
  console.log('PASS Windows 进程检查支持空闲、精确匹配、控制台代码页乱码拦截与异常保护');

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'version'), 'old');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'version'), 'new');

  const previous = publishSingleDir(staging, target, { archiveDir });
  assert.equal(fs.readFileSync(path.join(target, 'version'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(previous!, 'version'), 'utf8'), 'old');
  assert.ok(!fs.existsSync(staging));
  console.log('PASS Windows 解包目录原子替换并将旧版归档至 release/old');

  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'version'), 'next');
  const rename = fs.renameSync;
  (fs as any).renameSync = (from: any, to: any) => {
    if (from === staging) throw Error('publication failure');
    return rename(from, to);
  };
  try {
    assert.throws(() => publishSingleDir(staging, target, { archiveDir }), /publication failure/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(fs.readFileSync(path.join(target, 'version'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(staging, 'version'), 'utf8'), 'next');
  console.log('PASS Windows 发布失败时自动回滚原目录，不破坏现有版本');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
