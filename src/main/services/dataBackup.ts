import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
export async function backupUserData(directory:string,buildId:string) {
  const database=path.join(directory,'app_data.db'),vault=path.join(directory,'vault.enc');
  if(!fs.existsSync(database)&&!fs.existsSync(vault))return null;
  const destination=path.join(directory,'repair-backups',buildId.replace(/[^a-zA-Z0-9_-]/g,'_'));
  if(fs.existsSync(path.join(destination,'manifest.json')))return destination;
  fs.mkdirSync(destination,{recursive:true,mode:0o700});fs.chmodSync(destination,0o700);
  const manifest:Record<string,string>={};
  if(fs.existsSync(database)) {
    const db=new Database(database,{readonly:true,fileMustExist:true});
    try {await db.backup(path.join(destination,'app_data.db'));}finally{db.close();}
    fs.chmodSync(path.join(destination,'app_data.db'),0o600);
    manifest.databaseSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(destination,'app_data.db'))).digest('hex');
  }
  if(fs.existsSync(vault)){const data=fs.readFileSync(vault);fs.writeFileSync(path.join(destination,'vault.enc'),data,{mode:0o600});manifest.vaultSha256=crypto.createHash('sha256').update(data).digest('hex');}
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({buildId,...manifest,createdAt:Date.now()},null,2),{mode:0o600});
  return destination;
}
