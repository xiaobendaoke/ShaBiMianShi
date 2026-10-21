import assert from 'node:assert/strict';
import {readChatResponse, responseText, unwrapResponse} from '../src/main/services/modelResponse';
import {ProviderService} from '../src/main/services/providerService';
import {CaptureCoordinator} from '../src/main/services/captureCoordinator';
import {AudioSessionService} from '../src/main/services/audioSession';
import {SpeechSegmenter, encodeWav} from '../src/shared/audio';
import {answerPolicy, mergeTranscript, isQuestion, isFiller} from '../src/shared/interview';
import type {ProviderProfile, TranscriptRecord} from '../src/main/types';
let tests = 0;
async function test(name: string, run: () => unknown) {await run();tests++;console.log(`PASS ${name}`);}
const sleep = (ms=0) => new Promise(r=>setTimeout(r,ms));
const speech = () => Float32Array.from({length:1600},(_,i)=>Math.sin(i*0.1)*0.3);
const silence = () => new Float32Array(1600);
const stream = (events: unknown[], wrapped=false) => {
  const text = events.map(e => `data: ${JSON.stringify(wrapped ? {success:true,data:e}: e)}\r\n\r\n`).join('')+'data: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}),{headers:{'content-type':'text/event-stream'}});
};
await test('中转JSON / 字符串data / 业务失败 / 空正文 / 截断',()=>{
  assert.equal(responseText({success:true,data:JSON.stringify({choices:[{message:{content:'可直接说的答案'}}]})}),'可直接说的答案');
  assert.throws(()=>unwrapResponse({success:false,message:'额度不足'}),/额度/);
  assert.throws(()=>responseText({choices:[{message:{content:''}}]}),/空正文/);
  assert.throws(()=>responseText({choices:[{finish_reason:'length',message:{content:'半段代码'}}]}),/不完整/);
});
await test('SSE跨字节、CRLF、data包装、完整正文及截断',async()=>{
  let tokens=''; const answer=await readChatResponse(stream([{choices:[{delta:{content:'你好'}}]},{choices:[{delta:{content:'世界'},finish_reason:'stop'}]}],true),t=>tokens+=t);
  assert.equal(answer,'你好世界');assert.equal(tokens,answer);
  await assert.rejects(()=>readChatResponse(stream([{choices:[{delta:{content:'int main('},finish_reason:'length'}]}]),()=>{}),/截断/);
  await assert.rejects(()=>readChatResponse(stream([{choices:[{delta:{reasoning_content:'thinking'}}]}]),()=>{}),/空正文/);
});
await test('图片一次请求、普通题短答、四轮历史不二次裁剪',async()=>{
  const saved = globalThis.fetch; let calls=0, body:any;
  globalThis.fetch=async(_url,init)=>{calls++;body=JSON.parse(String(init?.body));return new Response(JSON.stringify({success:true,data:{choices:[{message:{content:'思路：遍历。\n```c\nint f(void){return 7;}\n```'},finish_reason:'stop'}]}}),{headers:{'content-type':'application/json'}});};
  try {
    const service=new ProviderService({getKey:()=> 'test'} as any);
    const profile={id:'p',modelChat:'deepseek-v4.1-flash',baseUrl:'https://invalid.test/v1',timeoutMs:2000} as ProviderProfile;
    let answer='',error:Error|undefined;
    const history=Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:String(i)}));
    await service.streamChat(profile,'截图解题',[],'docs_and_general',history,{onToken:()=>{},onComplete:s=>answer=s,onError:e=>error=e},'concise',undefined,{images:[{id:'i',mimeType:'image/png',base64:'abc'}],language:'C17'});
    assert.equal(error,undefined);assert.ok(answer.includes('```c'));assert.equal(calls,1);assert.equal(body.messages.length,10);assert.equal(body.messages.at(-1).content[1].type,'image_url');assert.equal(body.thinking.type,'disabled');assert.equal(body.max_tokens,8192);
  } finally {globalThis.fetch=saved;}
});
await test('文字截断重试重置草稿、预算增加；图片截断不重复请求',async()=>{
  const original=globalThis.fetch;let calls=0,resets=0,output='';
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:calls===1?'未完成':'一句完整回答。'},finish_reason:calls===1?'length':'stop'}]}),{headers:{'content-type':'application/json'}});};
  const service=new ProviderService({getKey:()=> 'test'} as any), profile={id:'p',modelChat:'text',baseUrl:'https://invalid.test',timeoutMs:2000} as ProviderProfile;
  try{
    let error:Error|undefined;
    await service.streamChat(profile,'什么是索引',[],'docs_and_general',[],{onReset:()=>{resets++;output='';},onToken:t=>output+=t,onComplete:()=>{},onError:e=>error=e});
    assert.equal(error,undefined);assert.equal(calls,2);assert.equal(resets,1);assert.equal(output,'一句完整回答。');
    calls=0;error=undefined;
    await service.streamChat(profile,'看图',[],'docs_and_general',[],{onReset:()=>resets++,onToken:()=>{},onComplete:()=>{},onError:e=>error=e},'standard',undefined,{images:[{id:'i',mimeType:'image/png',base64:'abc'}]});
    assert.equal(calls,1);assert.ok(error?.message.includes('预算耗尽'));
  }finally{globalThis.fetch=original;}
});
await test('候选人口吻、题型预算、代码独立预算、去重与应答词过滤',()=>{
  assert.equal(answerPolicy('什么是索引','standard').maxTokens,512);
  assert.ok(answerPolicy('你的项目做了什么','standard').project);
  assert.equal(answerPolicy('请解题','concise',{images:[{id:'x',base64:'x',mimeType:'image/png'}]}).maxTokens,8192);
  assert.ok(!answerPolicy('什么是事务','standard').prompt.includes('STAR'));
  assert.equal(mergeTranscript('数据库索引为什么','索引为什么能加快查询'),'数据库索引为什么能加快查询');
  assert.equal(isQuestion('嗯，好的，谢谢。'),false);
});
await test('PCM独立WAV头、600ms静音、6秒切段和30分钟音频模拟',()=>{
  const output:{samples:Float32Array;ended:boolean}[]=[];
  const vad=new SpeechSegmenter((samples,ended)=>output.push({samples,ended}),()=>{});
  for(let i=0;i<3;i++)vad.push(silence());
  for(let i=0;i<65;i++)vad.push(speech());
  for(let i=0;i<6;i++)vad.push(silence());
  assert.equal(output[0].ended,false);assert.equal(output.at(-1)?.ended,true);
  const wav=encodeWav(output[0].samples),view=new DataView(wav);
  assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint32(40,true),wav.byteLength-44);
  let segments=0;
  const long=new SpeechSegmenter(()=>segments++,()=>{});
  for(let i=0;i<18000;i++)long.push(i%50<35?speech():silence());
  assert.ok(segments>=350); assert.equal(long.speaking,false);
});
await test('截图成功/取消/异常均恢复原窗口，隐藏窗口不误显示，防止重入',async()=>{
  for(const outcome of ['success','cancel','error']){
    const log:string[]=[];
    const w=(name:string,visible:boolean,focused=false)=>({isDestroyed:()=>false,isVisible:()=>visible,isFocused:()=>focused,hide:()=>{visible=false;log.push(name+' hide');},showInactive:()=>{visible=true;log.push(name+' show');},focus:()=>log.push(name+' focus')});
    const c=new CaptureCoordinator(()=>[w('main',true,true),w('float',true),w('hidden',false)],()=>{});
    const result=c.run(async()=>{assert.deepEqual(log,['main hide','float hide']);if(outcome==='error')throw Error('failed');return outcome==='cancel'?null:'image';});
    await assert.rejects(()=>c.run(async()=>null),/正在选区/);
    if(outcome==='error')await assert.rejects(()=>result,/failed/);else assert.equal(await result,outcome==='cancel'?null:'image');
    assert.equal(c.busy,false);assert.deepEqual(log.slice(-3),['main show','float show','main focus']);
  }
});
await test('ASR最多两个并发、乱序恢复、失败不自动补发、切会话迟到不串写',async()=>{
  const resolvers:((s:string)=>void)[]=[], submitted:string[]=[], saved:TranscriptRecord[]=[];
  let active=0,peak=0;
  const service=new AudioSessionService((_wav,_signal)=>new Promise<string>(r=>{active++;peak=Math.max(peak,active);resolvers.push(s=>{active--;r(s);});}),()=>{},r=>saved.push({...r}),(_s,q)=>submitted.push(q),()=>false);
  const id=service.start('s1',1,'system');
  const push=()=>{for(let i=0;i<12;i++)service.frame(1,id,'system',speech());for(let i=0;i<6;i++)service.frame(1,id,'system',silence());};
  push();push();push();await sleep();assert.equal(resolvers.length,2);assert.equal(peak,2);
  resolvers[1]('索引为什么能加快查询');await sleep();assert.equal(submitted.length,0);assert.equal(resolvers.length,3);
  resolvers[0]('请简单介绍数据库索引为什么');resolvers[2]('以及它的代价是什么');await sleep();
  (service as any).capture.lastVoice=0;(service as any).flush();
  assert.equal(submitted.length,1);assert.ok(submitted[0].indexOf('请简单')<submitted[0].indexOf('以及'));
  push();await sleep();const before=saved.length;service.start('s2',1,'microphone');resolvers.at(-1)!('旧会话迟到结果');await sleep();assert.ok(!saved.slice(before).some(r=>r.text.includes('迟到')));service.stop();
});
await test('ASR失败会暂停自动提交，重试仅更新字幕',async()=>{
  let fail=true,submitted=0;const rows:TranscriptRecord[]=[];
  const service=new AudioSessionService(async()=>{if(fail)throw Error('offline');return '数据库索引为什么能加快查询';},()=>{},r=>rows.push({...r}),()=>submitted++,()=>false);
  const id=service.start('s',1,'microphone');for(let i=0;i<10;i++)service.frame(1,id,'microphone',speech());for(let i=0;i<6;i++)service.frame(1,id,'microphone',silence());await sleep();
  const failed=rows.find(r=>r.status==='error')!;assert.ok(failed);assert.equal((service as any).capture.auto,false);
  fail=false;await service.retry(1,failed.id);(service as any).capture.lastVoice=0;(service as any).flush();assert.equal(submitted,0);assert.equal(rows.at(-1)?.status,'completed');service.stop();
  let resolve: ((text:string)=>void)|undefined;
  const manual = new AudioSessionService(()=>new Promise<string>(r=>resolve=r),()=>{},()=>{},()=>submitted++,()=>false);
  const manualId=manual.start('manual',1,'system',false);
  manual.immediate(1);assert.equal((manual as any).capture.force,false,'Empty immediate must not arm future automatic sends');
  for(let i=0;i<10;i++)manual.frame(1,manualId,'system',speech());
  manual.immediate(1);await sleep();resolve!('数据库索引为什么能加快查询');await sleep();(manual as any).flush();
  assert.equal(submitted,1,'Manual immediate works even with auto disabled after pending ASR returns');manual.stop();

});
await test('自动听题过滤应答词、短题自动提交、显示手动模式和ASR耗时',async()=>{
  for(const text of ['嗯。Oh.，嗯。','好的，谢谢','Yeah',''])assert.ok(isFiller(text));
  assert.ok(!isFiller('嗯，数据库索引有什么代价'));assert.ok(isQuestion('什么是锁'));
  const submitted:{q:string;timing:any}[]=[],states:any[]=[],saved:TranscriptRecord[]=[];
  const answers=['嗯。Oh.','什么是锁'];
  const service=new AudioSessionService(async()=>answers.shift()!,(_c,p)=>states.push(p),r=>saved.push({...r}),(_s,q,timing)=>submitted.push({q,timing}),()=>false);
  const id=service.start('short',1,'system');
  const push=()=>{for(let i=0;i<4;i++)service.frame(1,id,'system',speech());for(let i=0;i<6;i++)service.frame(1,id,'system',silence());};
  push();await sleep();assert.ok(saved.at(-1)?.ignored);assert.equal(submitted.length,0);
  push();await sleep();(service as any).capture.lastVoice=0;(service as any).flush();
  assert.equal(submitted.length,1);assert.equal(submitted[0].q,'什么是锁');assert.ok(submitted[0].timing.voiceEndedAt>0);assert.ok(saved.at(-1)?.audioMs);assert.ok(saved.at(-1)?.completedAt);assert.ok(saved.at(-1)!.queuedMs!>=0);
  service.control(1,{auto:false});assert.ok(states.at(-1).phase.includes('手动模式'));service.stop();
});
await test('短噪声不会上传或卡住说话状态；4秒预先转写仍保留重叠',()=>{
  const chunks:any[]= [];let ended=0;
  const segmenter=new SpeechSegmenter((pcm,last)=>chunks.push({pcm,last}),()=>{},0.012,{maxChunkMs:4000,minSpeechMs:200,onEnd:()=>ended++});
  segmenter.push(speech());for(let i=0;i<6;i++)segmenter.push(silence());
  assert.equal(chunks.length,0);assert.equal(ended,1);assert.equal(segmenter.speaking,false);
  for(let i=0;i<45;i++)segmenter.push(speech());for(let i=0;i<6;i++)segmenter.push(silence());
  assert.equal(chunks[0].last,false);assert.equal(chunks[0].pcm.length,64000);assert.equal(chunks.at(-1).last,true);
});
console.log(`${tests} workflow groups passed (30min accelerated PCM simulation; not a live microphone test).`);
