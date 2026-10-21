import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function assertAppStopped(appPath, listProcesses=()=>execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'})) {
  let processes;
  try {processes=listProcesses();} catch {throw Error('无法确认应用是否运行，未更新应用。请在可检查进程的终端中打包。');}
  const prefix=path.resolve(appPath)+'/Contents/MacOS/';
  const running=processes.split('\n').filter(line=>line.includes(prefix));
  if(running.length)throw Error('新版应用仍在运行，请先从应用菜单完整退出，再执行 npm run pack。未覆盖应用资源。');
}

// Keep one installed application at a fixed path. Previous binaries are recoverable
// from Trash; configuration, Keychain entries and Application Support are untouched.
export function publishSingleApp(staging,target,{trashDirectory=path.join(os.homedir(),'.Trash'),listProcesses}={}) {
  assertAppStopped(target,listProcesses);
  if(!fs.statSync(staging).isDirectory())throw Error('打包暂存目录无效');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  let previous;
  if(fs.existsSync(target)) {
    if(fs.lstatSync(target).isSymbolicLink())throw Error('应用安装位置不能是符号链接，请先检查安装路径');
    fs.mkdirSync(trashDirectory,{recursive:true});
    previous=path.join(trashDirectory,`傻逼面试-旧构建-${Date.now()}-${crypto.randomUUID().slice(0,8)}.app`);
    fs.renameSync(target,previous);
  }
  try {fs.renameSync(staging,target);}
  catch(error){if(previous)fs.renameSync(previous,target);throw error;}
  return previous;
}
