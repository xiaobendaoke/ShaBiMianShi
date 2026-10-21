import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertAppStopped,publishSingleApp} from '../scripts/macAppRelease.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'single-mac-app-'));
const target=path.join(directory,'release/傻逼面试.app'),staging=path.join(directory,'new.app'),trash=path.join(directory,'trash');
const idle=()=>'',running=()=>`123 ${target}/Contents/MacOS/Electron\n`;
try {
 assert.throws(()=>assertAppStopped(target,running),/仍在运行/);
 assert.throws(()=>assertAppStopped(target,()=>{throw Error('EPERM')}),/无法确认/);
 console.log('PASS 运行中或无法检查进程时拒绝发布');
 fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'version'),'old');fs.mkdirSync(staging);fs.writeFileSync(path.join(staging,'version'),'new');
 assert.throws(()=>publishSingleApp(staging,target,{trashDirectory:trash,listProcesses:running}),/仍在运行/);
 assert.equal(fs.readFileSync(path.join(target,'version'),'utf8'),'old');assert.ok(fs.existsSync(staging));
 const previous=publishSingleApp(staging,target,{trashDirectory:trash,listProcesses:idle});
 assert.equal(fs.readFileSync(path.join(target,'version'),'utf8'),'new');assert.equal(fs.readFileSync(path.join(previous!,'version'),'utf8'),'old');assert.ok(!fs.existsSync(staging));
 console.log('PASS 只发布一个新版，旧包可从废纸篓恢复，不改用户数据');
 fs.mkdirSync(staging);fs.writeFileSync(path.join(staging,'version'),'next');
 const rename=fs.renameSync;
 (fs as any).renameSync=(from:any,to:any)=>{if(from===staging)throw Error('publication failure');return rename(from,to);};
 try {assert.throws(()=>publishSingleApp(staging,target,{trashDirectory:trash,listProcesses:idle}),/publication failure/);}finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(path.join(target,'version'),'utf8'),'new');assert.equal(fs.readFileSync(path.join(staging,'version'),'utf8'),'next');
 console.log('PASS 发布失败原路径恢复旧包，不报告成功');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
