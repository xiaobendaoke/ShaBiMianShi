import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('This release script currently supports Apple Silicon macOS only.');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const app=path.join(root,'release/mac-arm64/傻逼面试.app');
if(!fs.existsSync(app))throw Error('Run npm run pack first.');
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const filename=`ShaBiMianShi-${pkg.version}-mac-arm64.dmg`;
const output=path.join(root,'release',filename);
if(fs.existsSync(output))throw Error('DMG already exists; move the previous artifact before rebuilding.');
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'shabimianshi-dmg-'));
try {
  fs.cpSync(app,path.join(staging,'傻逼面试.app'),{recursive:true,verbatimSymlinks:true});
  fs.symlinkSync('/Applications',path.join(staging,'Applications'));
  fs.writeFileSync(path.join(staging,'安装说明.txt'),'将“傻逼面试.app”拖到 Applications，然后弹出磁盘映像，从应用程序打开。\n\n当前为 Apple Silicon 测试版，临时签名、未经 Apple 公证。首次打开可能被系统拦截；请参阅项目 README 中的 Apple 官方说明。\n\n首次使用请配置自己的模型 API；不包含作者的资料或密钥。\n\n使用指南：https://github.com/xiaobendaoke/ShaBiMianShi\n');
  execFileSync('hdiutil',['create','-volname','傻逼面试','-srcfolder',staging,'-format','UDZO','-ov',output],{stdio:'inherit'});
  execFileSync('hdiutil',['verify',output],{stdio:'inherit'});
  const digest=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output+'.sha256',`${digest}  ${filename}\n`);
  console.log('DMG:',output);
} finally {fs.rmSync(staging,{recursive:true,force:true});}
