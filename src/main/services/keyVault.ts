import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
interface SecureStorage {isEncryptionAvailable(): boolean; encryptString(text: string): Buffer; decryptString(data: Buffer): string;}
export class KeyVault {
  private vaultPath: string;
  private masterKey: Buffer;
  private cache = new Map<string,string>();
  private state: 'ready'|'missing'|'locked' = 'missing';
  private format: 'system'|'aes' = 'aes';
  private digest: string | null = null;
  constructor(appDataDir: string, private injectedStorage?: SecureStorage) {
    this.vaultPath=path.join(appDataDir,'vault.enc');
    this.masterKey=crypto.pbkdf2Sync(`${os.hostname()}_${os.userInfo().username}_interviewdog_standalone`,Buffer.from('f9a8d7e6c5b4a3928172635443210abc','hex'),100000,32,'sha256');
    this.load();
  }
  private storage(): SecureStorage | undefined {
    if(this.injectedStorage) return this.injectedStorage;
    try {return (typeof require === 'function' ? require('electron') : createRequire(import.meta.url)('electron')).safeStorage;} catch {return undefined;}
  }
  private hash(data: Buffer) {return crypto.createHash('sha256').update(data).digest('hex');}
  private load() {
    if(!fs.existsSync(this.vaultPath)) return;
    try {
      const raw=fs.readFileSync(this.vaultPath);this.digest=this.hash(raw);
      let text: string;
      if(raw.subarray(0,3).toString()==='SS:') {
        this.format='system';const storage=this.storage();
        if(!storage?.isEncryptionAvailable()) throw Error('system storage unavailable');
        text=storage.decryptString(raw.subarray(3));
      } else {
        this.format='aes';if(raw.length<28) throw Error('invalid vault');
        const cipher=crypto.createDecipheriv('aes-256-gcm',this.masterKey,raw.subarray(0,12));cipher.setAuthTag(raw.subarray(12,28));
        text=Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8');
      }
      const data=JSON.parse(text);
      if(!data||typeof data!=='object'||Array.isArray(data)||Object.values(data).some(v=>typeof v!=='string')) throw Error('invalid key map');
      this.cache=new Map(Object.entries(data));this.state='ready';
    } catch {this.state='locked';this.cache.clear();}
  }
  getHealth() {return {state:this.state, message:this.state==='locked'?'无法解密已有密钥，已禁止覆盖。请使用原应用身份解锁系统钥匙串后完整重启。':undefined};}
  private assertWritable() {if(this.state==='locked') throw Error(this.getHealth().message);}
  private save(next: Map<string,string>) {
    this.assertWritable();
    const current=fs.existsSync(this.vaultPath)?this.hash(fs.readFileSync(this.vaultPath)):null;
    if(current!==this.digest) throw Error('密钥文件已被其他进程修改，未覆盖，请完整重启后再保存');
    const text=JSON.stringify(Object.fromEntries(next));const storage=this.storage();let data:Buffer;
    if(this.format==='system'||(this.state==='missing'&&storage?.isEncryptionAvailable())) {
      if(!storage?.isEncryptionAvailable()) throw Error('系统加密存储不可用，未改写原密钥文件');
      data=Buffer.concat([Buffer.from('SS:'),storage.encryptString(text)]);
    } else {
      const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.masterKey,iv);
      const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);data=Buffer.concat([iv,cipher.getAuthTag(),body]);
    }
    fs.mkdirSync(path.dirname(this.vaultPath),{recursive:true});const temp=`${this.vaultPath}.${crypto.randomUUID()}.tmp`;
    try {const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,this.vaultPath);}
    finally {fs.rmSync(temp,{force:true});}
    this.digest=this.hash(data);this.cache=next;this.state='ready';this.format=data.subarray(0,3).toString()==='SS:'?'system':'aes';
  }
  setKey(providerId:string,apiKey:string) {this.assertWritable();if(!apiKey?.trim())return;const next=new Map(this.cache);next.set(providerId,apiKey.trim());this.save(next);}
  getKey(providerId:string):string|null {if(this.state==='locked')throw Error(this.getHealth().message);return this.cache.get(providerId)||null;}
  hasKey(providerId:string) {return this.state!=='locked'&&!!this.cache.get(providerId)?.trim();}
  deleteKey(providerId:string) {this.assertWritable();if(!this.cache.has(providerId))return;const next=new Map(this.cache);next.delete(providerId);this.save(next);}
}
