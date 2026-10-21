import fs from 'node:fs';
import {assertAppStopped,publishSingleApp} from './macAppRelease.js';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const target=path.join(root,'release/mac-arm64/傻逼面试.app');
assertAppStopped(target);
execFileSync('swiftc', ['-module-cache-path',path.join(os.tmpdir(),'interviewdog-swift-cache'),'-target',(process.arch==='arm64'?'arm64':'x86_64')+'-apple-macosx13.0','-parse-as-library','-O','-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',path.join(root,'native/SystemAudio-Info.plist'),path.join(root,'native/SystemAudio.swift'),'-o',path.join(root,'resources/system-audio')], {cwd:root,stdio:'inherit'});
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const {buildId} = JSON.parse(fs.readFileSync(path.join(root,'dist/build-info.json'),'utf8'));
const release = path.join(root, 'release/builds', buildId);
const staging = path.join(release, '.傻逼面试-staging.app');
const runtime = path.join(root, 'node_modules/electron/dist/Electron.app');
if (!fs.existsSync(runtime)) throw new Error('Electron runtime is missing');
fs.mkdirSync(release, { recursive: true });
fs.rmSync(staging, { recursive: true, force: true });
fs.cpSync(runtime, staging, { recursive: true, verbatimSymlinks: true });
const resources = path.join(staging, 'Contents/Resources/app');
fs.mkdirSync(resources, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(resources, 'dist'), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(resources, 'package.json'));
fs.cpSync(path.join(root, 'resources'), path.join(resources, 'resources'), {recursive: true});
// Ship runtime dependencies only. Copying devDependencies embeds a second Electron
// application and creates unnecessary macOS bundle discovery/signature work.
const copied=new Set();
function copyDependency(name,from=root) {
  let cursor=from,source;
  while(true){const candidate=path.join(cursor,'node_modules',name);if(fs.existsSync(path.join(candidate,'package.json'))){source=candidate;break;}const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  if(!source)return; // Optional, non-host native packages may be absent.
  if(copied.has(source))return;copied.add(source);
  const relative=path.relative(path.join(root,'node_modules'),source);
  if(relative.startsWith('..'))throw Error('Dependency outside workspace: '+name);
  fs.cpSync(source,path.join(resources,'node_modules',relative),{recursive:true,verbatimSymlinks:true});
  const dependency=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
  for(const child of Object.keys({...dependency.dependencies,...dependency.optionalDependencies}))copyDependency(child,source);
}
for(const name of Object.keys(pkg.dependencies))copyDependency(name);
const plist = path.join(staging, 'Contents/Info.plist');
for (const [key, value] of Object.entries({ CFBundleDisplayName: '傻逼面试', CFBundleName: '傻逼面试',
  CFBundleIdentifier: pkg.build.appId, CFBundleShortVersionString: pkg.version, CFBundleVersion: pkg.version })) {
  execFileSync('plutil', ['-replace', key, '-string', value, plist]);
}
for (const [key, value] of Object.entries({NSMicrophoneUsageDescription: '用于持续收听面试问题并自动转写。', NSAudioCaptureUsageDescription: '用于转写会议播放的面试问题。', NSScreenCaptureUsageDescription: '用于选区截图识别编程题及捕获会议音频。'})) {
  execFileSync('plutil', ['-replace', key, '-string', value, plist]);
}
// Local ad-hoc signature; this is not Developer ID signing or notarization.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', staging], { stdio: 'inherit' });
try {
  const previous=publishSingleApp(staging,target);
  const manifest=path.join(root,'release/latest-build.json');
  fs.writeFileSync(manifest+'.tmp',JSON.stringify({buildId,path:target},null,2));
  fs.renameSync(manifest+'.tmp',manifest);
  if(previous)console.log('Previous application moved to Trash:',previous);
  console.log('Packaged application:',target);
} finally {
  fs.rmSync(staging,{recursive:true,force:true});
  if(fs.existsSync(release)&&!fs.readdirSync(release).length)fs.rmdirSync(release);
}
