import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function assertAppStopped(exePath, listProcesses=()=>execFileSync('tasklist',['/FI',`IMAGENAME eq ${path.basename(exePath)}`,'/FO','CSV','/NH'],{encoding:'utf8'})) {
  let processes;
  try {processes=listProcesses();}
  catch(error) {
    // tasklist prints an INFO line ("没有运行的任务匹配指定标准。") when nothing matches and may
    // still exit non-zero; that output is a valid empty listing, not a failure to inspect.
    if(error&&typeof error.stdout==='string'&&error.stdout.trim())processes=error.stdout;
    else throw Error('无法确认应用是否运行，未更新应用。');
  }
  const name=path.basename(exePath);
  const lines=processes.split(/\r?\n/);
  // tasklist writes its listing in the console code page, so a non-ASCII image name can arrive
  // mojibake through a utf8 decode. The IMAGENAME filter already narrowed the listing, so a quoted
  // CSV record carrying non-ASCII bytes still means this executable is running.
  const running=lines.some(line=>line.includes(name))||lines.some(line=>/^\s*"/.test(line)&&/[\u0080-\uffff]/.test(line));
  if(running)throw Error('新版应用仍在运行，请先完全退出，再执行 npm run pack:win。未覆盖应用资源。');
}

// Keep one unpacked Windows build at a fixed path. Previous builds are archived under
// release/old and stay restorable by hand; user data outside the release tree is untouched.
export function publishSingleDir(staging,target,{archiveDir=path.join(root,'release/old')}={}) {
  let isDirectory=false;
  try {isDirectory=fs.statSync(staging).isDirectory();} catch {}
  if(!isDirectory)throw Error('打包暂存目录无效');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  let previous;
  if(fs.existsSync(target)) {
    fs.mkdirSync(archiveDir,{recursive:true});
    previous=path.join(archiveDir,`傻逼面试-旧构建-${Date.now()}-${crypto.randomUUID().slice(0,8)}`);
    fs.renameSync(target,previous);
  }
  try {fs.renameSync(staging,target);}
  catch(error){if(previous)fs.renameSync(previous,target);throw error;}
  return previous;
}
