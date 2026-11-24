import assert from 'node:assert/strict';
import {readChatResponse, responseText, unwrapResponse} from '../src/main/services/modelResponse';
import {ProviderService} from '../src/main/services/providerService';
import {CaptureCoordinator} from '../src/main/services/captureCoordinator';
import {AudioSessionService} from '../src/main/services/audioSession';
import {SpeechSegmenter, encodeWav} from '../src/shared/audio';
import {answerPolicy, mergeTranscript, isQuestion, isFiller, shouldMergeContinuation, isNoCodeImageRequest} from '../src/shared/interview';
import {preCorrectAsrText} from '../src/main/services/queryCompletion';
import {explicitThinkingDecision} from '../src/main/services/thinkingRoute';
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
await test('回答正文超时忽略角色、心跳、思考与空白片段；有正文时分阶段计时', async () => {
  const original = globalThis.fetch;
  const service = new ProviderService({getKey: () => 'fixture'} as any);
  const profile = {id:'fixture', modelChat:'deepseek-flash', baseUrl:'https://fixture.invalid/v1', timeoutMs:30000} as ProviderProfile;
  const encodeEvent = (data: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
  let aborted = false;
  let body: any;
  let finish = false;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': ping\n\n'));
        for (const delta of [{role:'assistant'}, {reasoning_content:'内部思考'}, {content:' '}]) {
          controller.enqueue(encodeEvent({choices:[{delta}]}));
        }
        if (finish) {
          controller.enqueue(encodeEvent({choices:[{delta:{content:'正常的完整回答。'},finish_reason:'stop'}]}));
          controller.close();
          return;
        }
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          controller.error(init.signal!.reason);
        }, {once:true});
      }
    }), {headers:{'content-type':'text/event-stream'}});
  };
  try {
    const phases: string[] = [];
    let error: Error | undefined;
    const callbacks = {
      onResponse: () => phases.push('headers'),
      onFirstContent: () => phases.push('content'),
      onToken: () => phases.push('visible'),
      onComplete: () => phases.push('complete'),
      onError: (value: Error) => { error = value; }
    };
    const startedAt = Date.now();
    await service.streamChat(profile, '什么是索引', [], 'docs_and_general', [], callbacks);
    assert.ok(aborted);
    assert.match(error!.message, /4 秒内未返回回答正文/);
    assert.ok(Date.now() - startedAt < 8000);
    assert.deepEqual(phases, ['headers']);
    assert.equal(body.reasoning_effort, undefined);

    finish = true;
    phases.length = 0;
    error = undefined;
    const history = [{role:'system',content:'保留会话范围'}, {role:'user',content:'上一题'}, {role:'assistant',content:'上一答'}];
    await service.streamChat(profile, '如何设计索引', [], 'docs_and_general', history, callbacks, 'standard', undefined, {deepThinking:true, reasoningEffort:'low'});
    assert.equal(error, undefined);
    assert.deepEqual(phases, ['headers', 'content', 'visible', 'complete']);
    assert.equal(body.reasoning_effort, 'low');
    assert.match(body.messages[0].content, /保留会话范围/);
    assert.deepEqual(body.messages.slice(1, -1), history.slice(1));
  } finally {globalThis.fetch = original;}
});
await test('能力测试核验向量正文、图片识别码和独立计算结果', async () => {
  const original = globalThis.fetch;
  const service = new ProviderService({getKey: () => 'fixture'} as any);
  const profile = {id:'fixture',baseUrl:'https://fixture.invalid/v1',modelEmbed:'embed',modelVision:'vision'} as ProviderProfile;
  let response: object;
  globalThis.fetch = async () => Response.json(response);
  try {
    for (const data of [[], [{embedding:[]}], [{embedding:['1', 0]}], [{embedding:[1, 0]}, {embedding:[0, 1]}]]) {
      response = {data};
      assert.equal((await service.testConnection(profile, undefined, 'embed')).success, false);
    }
    response = {data: [{embedding:[1, 0]}]};
    assert.equal((await service.testConnection(profile, undefined, 'embed')).success, true);

    for (const [content, expected] of [
      ['IMAGE CHECK 7391', false], ['IMAGE CHECK 7391, f(3)=82', false],
      ['IMAGE CHECK 7391, f(3)=72', false], ['IMAGE CHECK 7391, f(3)=7.1', false],
      ['IMAGE CHECK 7391, f(3)=7/2', false], ['IMAGE CHECK 1234, f(3)=7', false],
      ['IMAGE CHECK 7391, f(3)=7', true], ['IMAGE CHECK 7391，f（3）＝7.0。', true]
    ] as const) {
      response = {choices: [{message: {content}}]};
      assert.equal((await service.testConnection(profile, undefined, 'vision')).success, expected, content);
    }
  } finally {
    globalThis.fetch = original;
  }
});
await test('向量正文等不到结束时会超时，取消可以中断退避等待', async () => {
  const original = globalThis.fetch;
  const service = new ProviderService({getKey: () => 'fixture'} as any);
  const profile = {id:'fixture',baseUrl:'https://fixture.invalid/v1',modelEmbed:'embed',timeoutMs:25} as ProviderProfile;
  let requests = 0;
  const cancel = new AbortController();
  let notifyTimeout!: () => void;
  const responseTimedOut = new Promise<void>(resolve => {notifyTimeout = resolve;});
  globalThis.fetch = async (_url, {signal} = {}) => {
    requests++;
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"data":'));
        signal?.addEventListener('abort', () => {
          stream.error(signal.reason);
          notifyTimeout();
        }, {once:true});
      }
    }));
  };
  const guard = setTimeout(() => cancel.abort(), 500);
  try {
    const pending = assert.rejects(service.generateEmbeddings(profile, ['fixture'], undefined, cancel.signal), /已取消/);
    await Promise.race([responseTimedOut, sleep(400).then(() => {throw new Error('响应正文超时未生效');})]);
    await sleep();
    cancel.abort();
    await pending;
    assert.equal(requests, 1);
  } finally {
    clearTimeout(guard);
    cancel.abort();
    globalThis.fetch = original;
  }
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
  const calcImgQ = '请解答图片里 f(3) 的值，给出计算过程和最后结果。不要编写新的程序。';
  assert.equal(isNoCodeImageRequest(calcImgQ), true);
  const calcPolicy = answerPolicy(calcImgQ, 'standard', {images:[{id:'x',base64:'x',mimeType:'image/png'}]});
  assert.equal(calcPolicy.coding, false, 'Value-only screenshot calculation must not activate C17 coding template');
  assert.match(calcPolicy.prompt, /严禁输出任何代码块/);
  assert.deepEqual(explicitThinkingDecision('auto', {images:[{id:'x',base64:'x',mimeType:'image/png'}]}, calcImgQ), {mode:'fast', source:'action'});
  assert.ok(!answerPolicy('什么是事务','standard').prompt.includes('STAR'));
  assert.equal(mergeTranscript('数据库索引为什么','索引为什么能加快查询'),'数据库索引为什么能加快查询');
  assert.equal(mergeTranscript('Can you tell me','Tell me about your project?'),'Can you tell me about your project?');
  assert.equal(mergeTranscript('Hello.','What is your role?'),'Hello. What is your role?');
  assert.equal(isQuestion('嗯，好的，谢谢。'),false);

  // Role alignment & narrative reframing policy tests
  const salesPolicy = answerPolicy('介绍一下你自己，讲讲你做过的销售软件项目', 'standard', {
    targetRole: '销售',
    jobDescription: '负责企业级SaaS软件客户开发与签单回款'
  });
  assert.equal(salesPolicy.coding, false);
  assert.equal(salesPolicy.project, true);
  assert.match(salesPolicy.prompt, /【本场目标岗位：销售】/);
  assert.match(salesPolicy.prompt, /重心迁移/);
  assert.match(salesPolicy.prompt, /严禁为了迎合「销售」编造未做过的工作/);

  // Non-coding targetRole screenshot should NOT force C17 code template unless question asks for code
  const salesImgPolicy = answerPolicy('请结合本场目标岗位（销售）解答截图中的题目', 'standard', {
    images: [{id: 'img1', base64: 'x', mimeType: 'image/png'}],
    targetRole: '销售'
  });
  assert.equal(salesImgPolicy.coding, false, 'Sales role screenshot must not force C17 coding mode');
  assert.match(salesImgPolicy.prompt, /销售/);

  const techImgPolicy = answerPolicy('请解答截图中的题目', 'standard', {
    images: [{id: 'img2', base64: 'x', mimeType: 'image/png'}],
    targetRole: '后端开发'
  });
  assert.equal(techImgPolicy.coding, true, 'Tech role screenshot keeps full coding mode');
});
await test('无证据防编造系统护栏与首字5字符快速上屏', async () => {
  const saved = globalThis.fetch;
  const bodies: any[] = [];
  const tokenAtChunk: number[] = [];
  let chunkIdx = 0;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const chunks = ['目前', '资料', '中没有', '记录具体职业方向。'];
    return new Response(new ReadableStream({
      start(c) {
        for (const piece of chunks) {
          chunkIdx++;
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:piece}}]})}\n\n`));
        }
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`));
        c.close();
      }
    }), {headers:{'content-type':'text/event-stream'}});
  };
  try {
    const svc = new ProviderService({getKey: () => 'k'} as any);
    const prof = {id:'p', modelChat:'deepseek-flash', baseUrl:'https://fixture.invalid/v1', timeoutMs:2000} as ProviderProfile;
    await svc.streamChat(prof, '我是什么职业？我的工作方向是什么？', [], 'docs_only', [{role:'system',content:'用户填写的项目事实：未提供'}], {
      onToken: () => tokenAtChunk.push(chunkIdx),
      onComplete: () => {},
      onError: e => { throw e; }
    });
    assert.match(bodies[0].messages[0].content, /0 条命中/);
    assert.match(bodies[0].messages[0].content, /严禁猜测或编造任何职位方向/);
    assert.ok(tokenAtChunk.length >= 2, 'First token should flush well before waiting for 16 chars');
  } finally {
    globalThis.fetch = saved;
  }
});
await test('ASR自动语种识别不锁死zh且保留中英文术语提示词', async () => {
  const saved = globalThis.fetch;
  let capturedForm: FormData | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedForm = init?.body as FormData;
    return new Response(JSON.stringify({text: 'Can you introduce yourself?'}), {headers: {'content-type': 'application/json'}});
  };
  try {
    const svc = new ProviderService({getKey: () => 'k'} as any);
    const prof = {id: 'p', modelAsr: 'whisper-1', baseUrl: 'https://fixture.invalid/v1', timeoutMs: 2000} as ProviderProfile;
    const text = await svc.transcribeAudio(prof, Buffer.from('RIFF'), 'audio/wav', undefined, '嵌入式软件');
    assert.equal(text, 'Can you introduce yourself?');
    assert.equal(capturedForm?.get('language'), null, 'ASR must not hard-lock language=zh so English questions transcribe cleanly');
    assert.match(String(capturedForm?.get('prompt') || ''), /Chinese & English/);
  } finally {
    globalThis.fetch = saved;
  }
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
await test('外语幻觉过滤、领域同音词纠偏、检索前LLM上下文补全与650ms抢答后续半句原地合并重答',async()=>{
  for(const noise of ['हाँ','सही बात है।','ओके','うん','はい'])assert.ok(isFiller(noise),`Foreign noise ${noise} should be ignored`);
  assert.equal(preCorrectAsrText('你们用 circle light 和 We sell two 不输在单次，高通二九五样品研试多少'), '你们用 SQLite 和 V4L2 部署在端侧，高通8295音频延时多少');
  assert.equal(preCorrectAsrText('C++血汗说怎么实现多肽'), 'C++虚函数怎么实现多态');
  assert.equal(preCorrectAsrText('你在深南实习时用 C加加 和 J J N I 调 Cotlin，对比金伟达做口自我介绍'), '你在深蓝实习时用 C++ 和 JNI 调 Kotlin，对比英伟达做个自我介绍');
  assert.equal(preCorrectAsrText('你是谁？你是谁？你是谁？'), '你是谁？');
  assert.ok(isFiller('感谢同学您的自我介绍哈，那我们这边就先请高老师提问。'));
  assert.ok(shouldMergeContinuation('嗯，具体到你这个场景里面，它是。', '什么东西的比例？', 900));
  assert.ok(shouldMergeContinuation('你也知道，你面试这个岗位是大模型相关的一个岗位，但是。', '你这个里边大模型相关内容并不多。', 1200));
  assert.ok(shouldMergeContinuation('就是用C++的多态的特性去实现一个数据的求和。', '针对int类型、float类型以及double类型。', 2200));

  const savedFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({intent:'project_or_resume',rewrittenQuestion:'RK3588全链路语音项目的端到端首字延迟是怎么优化到320ms的？',searchQuery:'RK3588 语音 全链路 首字延迟 TTFT 320ms 优化',targetDocIds:['daudio']})},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
  try{
    const svc=new ProviderService({getKey:()=>'k'} as any);
    const comp=await svc.completeQuery({id:'p',modelChat:'deepseek-flash',baseUrl:'https://fixture.invalid/v1',timeoutMs:2000} as ProviderProfile,{
      question:'那它的首字延迟是怎么压下来的？',
      activeProject:'RK3588全链路集成',
      documents:[{id:'daudio',fileName:'RK3588全链路集成.md',kind:'md'},{id:'resume',fileName:'简历.pdf',kind:'pdf'}],
      recentTurns:[{question:'介绍一下RK3588语音项目',answerSummary:'实现了端侧全双工语音交互，TTFT约320ms。'}]
    });
    assert.equal(comp.intent,'project_or_resume');
    assert.deepEqual(comp.targetDocIds,['daudio']);
    assert.ok(comp.searchQuery.includes('320ms'));
  }finally{globalThis.fetch=savedFetch;}

  assert.ok(shouldMergeContinuation('那你们这个RK3588的语音项目，','它的首字延迟是怎么压到320毫秒的？',1400));
  assert.ok(!shouldMergeContinuation('你们的帧率是多少？','好的，那下一个问题，讲一下C++虚函数表',1500));
  assert.ok(!shouldMergeContinuation('线程和进程有什么区别？','死锁的四个必要条件是什么？',900));
  assert.ok(!shouldMergeContinuation('介绍一下你的项目','那死锁怎么避免',900));
  assert.ok(!shouldMergeContinuation('你们这个项目','下一个问题是死锁',900));

  const calls:{q:string;replaceTurnId?:string}[]=[];
  const transcripts=['那你们这个RK3588的语音项目','它的首字延迟是怎么压到320毫秒的？','讲一下C++多态原理'];
  const audio=new AudioSessionService(async()=>transcripts.shift()!,()=>{},()=>{},(_s,q,_t,continuation)=>{
    calls.push({q: continuation?.mergedQuestion ?? q, replaceTurnId: continuation?.turnId});
    return continuation?.turnId ?? 'turn_fast_1';
  },()=>false);
  const cid=audio.start('s_merge',1,'system');
  const pushUtterance=()=>{for(let i=0;i<5;i++)audio.frame(1,cid,'system',speech());for(let i=0;i<6;i++)audio.frame(1,cid,'system',silence());};

  // First half-sentence auto-submits fast at >=650ms pause
  pushUtterance();await sleep();
  (audio as any).capture.lastVoice=Date.now()-700;(audio as any).flush();
  assert.equal(calls.length,1);
  assert.equal(calls[0].q,'那你们这个RK3588的语音项目');
  assert.equal(calls[0].replaceTurnId,undefined);

  // Trailing half-sentence arrives ~1s later while candidate hasn't started speaking -> auto-merges into turn_fast_1!
  pushUtterance();await sleep();
  (audio as any).capture.lastVoice=Date.now()-700;(audio as any).flush();
  assert.equal(calls.length,2);
  assert.equal(calls[1].replaceTurnId,'turn_fast_1');
  assert.equal(calls[1].q,'那你们这个RK3588的语音项目，它的首字延迟是怎么压到320毫秒的？');

  // Once candidate toggles selfSpeaking, subsequent speech starts a fresh turn instead of merging
  audio.control(1,{selfSpeaking:true});audio.control(1,{selfSpeaking:false});
  pushUtterance();await sleep();
  (audio as any).capture.lastVoice=Date.now()-700;(audio as any).flush();
  assert.equal(calls.length,3);
  assert.equal(calls[2].replaceTurnId,undefined);
  assert.equal(calls[2].q,'讲一下C++多态原理');
  audio.stop();
});
console.log(`${tests} workflow groups passed (30min accelerated PCM simulation; not a live microphone test).`);
