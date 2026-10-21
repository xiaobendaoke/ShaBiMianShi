// Opt-in smoke test: runs under Electron; reads existing encrypted keys, never saves them.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), cp=require('node:child_process');
const {buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
const output=process.env.INTERVIEWDOG_LIVE_REPORT;
if(!output) throw new Error('Set INTERVIEWDOG_LIVE_REPORT to an absolute output path before running this opt-in test');
app.setName('面试狗-独立版');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'interviewdog-live-'));
app.setPath('userData',temporary);
app.whenReady().then(async()=>{
 const results=[];
 try{
  const directory=process.env.INTERVIEWDOG_LIVE_DATA || path.join(os.homedir(),'Library/Application Support/面试狗-独立版');
  const rows=JSON.parse(cp.execFileSync('python3',['-c',"import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute('SELECT * FROM provider_profiles')]))",path.join(directory,'app_data.db')],{encoding:'utf8'}));
  const raw=fs.readFileSync(path.join(directory,'vault.enc'));
  if(raw.subarray(0,3).toString()!=='SS:') throw Error('This live harness expects the existing safeStorage vault');
  const keys=JSON.parse(safeStorage.decryptString(raw.subarray(3)));
  buildSync({entryPoints:[path.join(root,'src/main/services/providerService.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(temporary,'provider.cjs')});
  const {ProviderService}=require(path.join(temporary,'provider.cjs'));
  const service=new ProviderService({getKey:id=>keys[id]});
  const mapped=role=>{const row=rows.find(r=>r.id==='role_profile_'+role);if(!row)throw Error('Missing existing '+role+' role');return {id:row.id,name:role,baseUrl:row.base_url,modelChat:row.model_chat,modelVision:row.model_vision,modelAsr:row.model_asr,timeoutMs:60000};};
  const profile=mapped('chat'),asr=mapped('asr');
  const questions=[
   '什么是数据库索引？','什么是事务？','什么是主键？','什么是外键？','什么是死锁？','什么是进程？','什么是线程？','什么是缓存？','什么是幂等性？','什么是乐观锁？',
   '什么是悲观锁？','什么是HTTP？','什么是TCP？','什么是DNS？','什么是HTTPS？','什么是反向代理？','什么是负载均衡？','什么是消息队列？','什么是限流？','什么是熔断？',
   '什么是时间复杂度？','什么是哈希表？','什么是二叉树？','什么是栈？','什么是队列？','什么是递归？','什么是指针？','什么是内存泄漏？','什么是数组？','什么是结构体？',
   'TCP和UDP有什么区别？','进程和线程有什么区别？','索引为什么能加快查询？','Redis为什么快？','如何处理缓存穿透？','乐观锁和悲观锁的区别？','栈和堆有什么区别？','HTTP和HTTPS区别是什么？','数组和链表有什么区别？','如何避免死锁？',
   '你在项目里负责什么？','你们为什么选择唯一业务键？','你的项目解决了什么问题？','你负责的订单防重是怎么做的？','你们如何应对重复请求？','项目里你使用了什么数据库？','你个人负责哪些模块？','项目有没有性能提升数字？','你们项目采用了什么方案？','项目里你的主要工作是什么？'
  ];
  const jobs=(process.env.INTERVIEWDOG_ONLY_ASR?[]:questions).map((question,index)=>async()=>{
    const start=Date.now();let first,answer='',partial='',error;
    await service.streamChat(profile,question,index>=40?[{citationIndex:1,fileName:'测试项目事实',sectionPath:'职责',text:'这是测试夹具，不是真实个人履历。候选人负责订单接口，使用MySQL唯一业务键防止重复提交，未提供性能数字。'}]:[],'experience_first',[],{onReset:()=>{partial='';first=undefined;},onToken:t=>{first??=Date.now()-start;partial+=t;},onComplete:t=>answer=t,onError:e=>error=e.message},'standard');
    results.push({type:'text',question,answer,partial,error,firstMs:first,totalMs:Date.now()-start,length:answer.length,budgetPass:!error&&answer.length<=(index<30?80:index<40?160:240),personalNumbers:index>=40?/\d/.test(answer):undefined});
  });
  for(let i=0;i<(process.env.INTERVIEWDOG_SKIP_ASR ? 0 : 5);i++)jobs.push(async()=>{const start=Date.now();try{const text=await service.transcribeAudio(asr,fs.readFileSync(path.join(root,'resources/probes/asr.wav')),'audio/wav');results.push({type:'asr',ms:Date.now()-start,text,pass:/索引/.test(text)&&/查询/.test(text)});}catch(e){results.push({type:'asr',error:e.message});}});
  const fixtures=process.env.INTERVIEWDOG_LIVE_IMAGES;
  if(fixtures){for(const file of fs.readdirSync(fixtures).filter(f=>f.endsWith('.png')))jobs.push(async()=>{
   const start=Date.now();let first,answer='',partial='',error;
   await service.streamChat(profile,'请直接解答截图题目，遵循图中函数签名。',[],'docs_and_general',[],{onToken:()=>{first??=Date.now()-start;},onComplete:s=>answer=s,onError:e=>error=e.message},'standard',undefined,{images:[{id:file,mimeType:'image/png',base64:fs.readFileSync(path.join(fixtures,file)).toString('base64')}],language:'C17'});
   const blocks=[...answer.matchAll(/```(?:c|C|cpp)?\s*\n([\s\S]*?)```/g)].map(m=>m[1]);
   const compile=blocks.length?cp.spawnSync('/usr/bin/clang',['-std=c17','-fsyntax-only','-xc','-'],{input:blocks.join('\n'),encoding:'utf8',timeout:5000}):null;
   results.push({type:'image',file,answer,error,firstMs:first,totalMs:Date.now()-start,cSyntaxPass:compile?.status===0,compileError:compile?.stderr?.slice(0,500)});
  });}
  let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<jobs.length){const job=jobs[next++];await job();}}));
  const distribution=(rows,key)=>{const a=rows.map(r=>r[key]).filter(x=>typeof x==='number').sort((a,b)=>a-b);return {n:a.length,p50:a[Math.max(0,Math.ceil(a.length*.5)-1)],p95:a[Math.max(0,Math.ceil(a.length*.95)-1)]};};
  const report={date:new Date().toISOString(),results,metrics:{asr:distribution(results.filter(r=>r.type==='asr'),'ms'),textFirst:distribution(results.filter(r=>r.type==='text'),'firstMs'),textTotal:distribution(results.filter(r=>r.type==='text'),'totalMs'),imageFirst:distribution(results.filter(r=>r.type==='image'),'firstMs')},limitations:['Synthetic spoken fixture and rendered code-question images; not live microphone/system capture or multi-monitor selection. Length checks are not semantic grading. C checks are syntax only.']};
  fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:output,metrics:report.metrics,textPass:results.filter(r=>r.type==='text'&&r.budgetPass).length,textCount:results.filter(r=>r.type==='text').length,imageSyntaxPass:results.filter(r=>r.type==='image'&&r.cSyntaxPass).length,errors:results.filter(r=>r.error).map(r=>({type:r.type,error:r.error}))}));
 }catch(e){console.log(JSON.stringify({error:e.message}));process.exitCode=1;}
 finally{app.quit();}
});
