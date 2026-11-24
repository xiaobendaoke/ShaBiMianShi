import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chunkDocument, estimateTokens } from '../src/main/chunker/chunker';
import { embeddingSpaceKey } from '../src/main/indexing/embeddingSpace';
import { AppDatabase } from '../src/main/db/database';
import type { ProviderProfile } from '../src/main/types';

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'interviewdog-production-'));
const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log('PASS:', name); };
const harness: any = { directory: path.join(directory, 'data'), handlers: new Map(), events: [], paths: [] };
(globalThis as any).__productionTest = harness;
let state: any;
let mode = 'normal';
let dimension = 3;
let chatSignal: AbortSignal | undefined;
let pendingRelease: (() => void) | undefined;
const requests: any[] = [];
async function waitFor(test: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!test()) { if (Date.now() > deadline) throw new Error('Timed out: ' + message); await new Promise(r => setTimeout(r, 2)); }
}
const call = (name: string, ...args: any[]) => {
  assert.ok(harness.handlers.has(name), name + ' must be registered');
  return harness.handlers.get(name)({}, ...args);
};

async function compileMain() {
  await build({ entryPoints: [path.join(project, 'src/main/index.ts')], bundle: true,
    platform: 'node', format: 'cjs', outfile: path.join(directory, 'main.cjs'), plugins: [{
      name: 'production-boundary-isolation', setup(b) {
        b.onResolve({ filter: /^(better-sqlite3|pdf-parse|mammoth)$/ }, a => ({ path: require.resolve(a.path), external: true }));
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
        b.onResolve({ filter: /windowManager$/ }, () => ({ path: 'windows', namespace: 'test' }));
        b.onResolve({ filter: /mockServer$/ }, () => ({ path: 'mock', namespace: 'test' }));
        b.onLoad({ filter: /.*/, namespace: 'test' }, a => ({ loader: 'js', contents:
          a.path === 'electron' ? `const h=globalThis.__productionTest; export default {app:{requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),getPath:()=>h.directory,getAppPath:()=>h.directory,setPath:()=>{},setName:()=>{},on:()=>{},quit:()=>{},getVersion:()=>"test"},session:{defaultSession:{setDisplayMediaRequestHandler:()=>{}}},ipcMain:{handle:(k,v)=>h.handlers.set(k,v),on:(k,v)=>h.handlers.set(k,v)},globalShortcut:{register:()=>true,unregisterAll:()=>{}},BrowserWindow:{getAllWindows:()=>[]},dialog:{showErrorBox:()=>{},showOpenDialog:async()=>({canceled:false,filePaths:h.paths})}};` :
          a.path === 'windows' ? `export class WindowManager{createMainWindow(){}getMainWindow(){return {}}broadcast(...args){globalThis.__productionTest.events.push(structuredClone(args))}toggleFloatingWindow(){}setOpacity(){}setContentProtection(){}}` :
          'export class MockAiServer{constructor(){}async start(){}async stop(){}}' }));
        b.onLoad({ filter: /src[\\/]main[\\/]index\.ts$/ }, a => {
          const source = fs.readFileSync(a.path, 'utf8');
          assert.ok(source.includes('  registerIpc();'));
          return { loader: 'ts', contents: source.replace('  registerIpc();',
            '  globalThis.__productionTest.state={db,keywordIndex,vectorIndex,ingestionQueue,audioSession};\n  registerIpc();') };
        });
      }
    }] });
}
async function boot(dataDirectory = harness.directory) {
  harness.directory = dataDirectory; fs.mkdirSync(dataDirectory, { recursive: true });
  harness.handlers.clear(); harness.events = [];
  const main = path.join(directory, 'main.cjs'); delete require.cache[require.resolve(main)];
  require(main);
  await waitFor(() => harness.handlers.has('chat:ask-question'), 'actual bootstrap');
  state = harness.state;
}
async function restart() { state.db.close(); await boot(); }
function saveProfile(profile: ProviderProfile) {
  call('api:save-profile', profile);
  call('api:set-key', { profileId: profile.id, key: 'fixture-only-not-a-real-key' });
}
async function importFile(name: string, text: string, library = 'default_lib') {
  const file = path.join(directory, name); fs.writeFileSync(file, text);
  harness.paths = [file]; await call('kb:import-files', library);
  await waitFor(() => !state.ingestionQueue.getStats().queued && !state.ingestionQueue.getStats().processing, 'document import');
  return file;
}
async function ask(id: string, question: string, libraries: string[] = []) {
  const session = call('chat:get-sessions')[0];
  const answer = await call('chat:ask-question', { sessionId: session.id, question, libraryIds: libraries, turnId: id });
  assert.equal(answer, id, 'IPC must ACK the original identity');
  return session.id;
}

async function main() {
  await compileMain();
  const originalFetch = globalThis.fetch;
  const asrQueue: string[] = [];
  const completionInputs: any[] = [];
  const routerRequests: {body: any; signal: AbortSignal}[] = [];
  let routerMode: 'fast' | 'deep' | 'malformed' | 'stall' | 'hold' = 'fast';
  let releaseRouter: (() => void) | undefined;
  let completionOverride: ((q: string, docs: any[], combinedRouting: boolean) => any) | undefined;
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).endsWith('/audio/transcriptions')) {
      return new Response(JSON.stringify({ text: asrQueue.shift() || '默认测试语音' }), { headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    if(body.messages?.[0]?.content?.includes('整理会话记忆'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({project:'',facts:[],working:[],uncertain:[]})}}]}),{headers:{'content-type':'application/json'}});
    if (body.messages?.[0]?.content?.includes('难度路由器')) {
      routerRequests.push({body, signal: options.signal});
      const routed = (mode: string) => Response.json({choices:[{message:{content:JSON.stringify({mode})}}]});
      if (routerMode === 'hold') {
        return new Promise((resolve, reject) => {
          releaseRouter = () => resolve(routed('deep'));
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true});
        });
      }
      if (routerMode === 'stall') {
        return new Response(new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"choices":'));
            options.signal.addEventListener('abort', () => stream.error(options.signal.reason), {once:true});
          }
        }));
      }
      return routed(routerMode);
    }
    if(body.messages?.[0]?.content?.includes('语音纠错与上下文指代补全器')){
      const [context, currentQuestion] = body.messages[1].content.split('\n当前问题：\n');
      const source = context.match(/^来源：(audio|typed)/)?.[1];
      const documents = JSON.parse(context.match(/^文档目录：(.*)$/m)?.[1] ?? '[]');
      const combinedRouting = body.messages[0].content.includes('"thinkingMode"');
      completionInputs.push({context, currentQuestion, source, combinedRouting});
      const payload = completionOverride
        ? completionOverride(currentQuestion, documents, combinedRouting)
        : {intent:'project_or_resume',rewrittenQuestion:currentQuestion.replace('多肽', '多态'),searchQuery:'订单 幂等 唯一业务编号',targetDocIds:documents.filter((d:any)=>d.fileName==='order.md').map((d:any)=>d.id),thinkingMode:combinedRouting ? routerMode : undefined};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload)},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
    }
    const embedding = String(url).endsWith('/embeddings');
    requests.push({ url: String(url), body, authorization: options.headers.Authorization });
    const response = () => embedding
      ? new Response(JSON.stringify({ data: body.input.map((_: unknown, i: number) => ({ index: i, embedding: Array.from({ length: dimension }, (_, j) => j === i % dimension ? 1 : 0) })) }))
      : new Response('data: '+JSON.stringify({choices:[{delta:{content:body.messages[0].content.includes('只提取')?'测试答案[资料1]，无效编号[资料999]':'我会先给出核心结论，再按追问补充。'}}]})+'\n\ndata: [DONE]\n\n', {headers:{'content-type':'text/event-stream'}});
    if ((mode === 'pauseChat' && !embedding) || (mode === 'pauseEmbed' && embedding)) {
      chatSignal = options.signal;
      return await new Promise((resolve, reject) => {
        pendingRelease = () => resolve(response());
        if (options.signal.aborted) reject(options.signal.reason);
        else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    if (mode === 'invalidEmbed' && embedding) return new Response(JSON.stringify({ data: [] }));
    if (mode === 'stallEmbedBody' && embedding) {
      chatSignal = options.signal;
      return new Response(new ReadableStream({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"data":'));
          options.signal.addEventListener('abort', () => stream.error(options.signal.reason), {once:true});
        }
      }));
    }
    return response();
  }) as any;
  try {
    await boot();
    const originalSession=call('chat:get-sessions')[0];
    const makeSession=(id:string,title:string)=>({...originalSession,id,title,projectFacts:'',jobDescription:'',summary:'',createdAt:Date.now(),updatedAt:Date.now()});
    call('chat:save-session',makeSession('company-a','公司A · 一面'));
    call('chat:save-session',makeSession('company-b','公司B · 技术面'));
    state.db.saveTurn({id:'company-a-turn',sessionId:'company-a',role:'assistant',question:'A的问题',answer:'A的回答',status:'completed',citations:[],createdAt:1});
    state.db.saveTranscript({id:'company-a-transcript',sessionId:'company-a',captureId:'a',source:'system',sequence:0,status:'completed',text:'A字幕',createdAt:1});
    state.db.getMemory('company-a');
    call('chat:select-session','company-b');
    assert.deepEqual(call('chat:get-turns','company-b'),[]);
    assert.equal(call('memory:get','company-b').entries.length,0);
    assert.equal(call('chat:get-selected-session'),'company-b');
    await restart();
    assert.equal(call('chat:get-selected-session'),'company-b');
    call('chat:save-session',{...call('chat:get-sessions').find((s:any)=>s.id==='company-a'),title:'公司A · 二面'});
    assert.equal(call('chat:get-turns','company-a')[0].answer,'A的回答');
    call('chat:delete-session','company-a');
    assert.equal(call('chat:get-selected-session'),'company-b');
    assert.equal(call('chat:get-turns','company-a').length,0);
    assert.equal(call('audio:history','company-a').length,0);
    call('chat:delete-session','company-b');
    assert.equal(call('chat:get-selected-session'),originalSession.id);
    assert.ok(call('chat:get-sessions').some((s:any)=>s.id===originalSession.id));
    pass('Session create/rename/select/restart/delete preserves isolated history and active-session fallback');
    await waitFor(() => !state.ingestionQueue.getStats().queued && !state.ingestionQueue.getStats().processing, 'preset bootstrap ingestion');
    for (const d of state.db.getDocuments()) call('kb:delete-document', d.id);
    const profile: ProviderProfile = { id: 'service-A', name: 'A', protocol: 'openai',
      baseUrl: 'https://fixture-a.invalid/v1', hasKey: true, modelChat: 'chat', modelEmbed: 'same-name',
      modelVision: 'vision', modelAsr: 'asr', timeoutMs: 1000, isActive: false, createdAt: 1 };
    saveProfile(profile);
    call('api:set-active-role', { role: 'chat', profileId: profile.id });
    call('api:set-active-role', { role: 'embed', profileId: profile.id });
    const file = await importFile('order.md', '# 订单项目\n\n' + '订单幂等测试方案涉及唯一业务编号。'.repeat(60));
    const oldIds = state.db.getAllChunks().map((c: any) => c.id);
    assert.ok(oldIds.length > 1);
    assert.equal(state.vectorIndex.size, oldIds.length);
    assert.ok(state.db.getAllEmbeddings().every((e: any) => e.spaceKey === embeddingSpaceKey(profile)));
    await restart();
    await importFile('cache.md', '# 缓存项目\n\n缓存项目采用独有测试编号 CACHE-842');
    const restoredIds = new Set(state.vectorIndex.search([1, 0, 0], ['default_lib'], 100).map((r: any) => r.chunkId));
    assert.ok(oldIds.every((id: string) => restoredIds.has(id)));
    pass('Actual import IPC + bootstrap: persisted same-space vectors survive restart and append');

    await call('chat:ask-question',{sessionId:call('chat:get-sessions')[0].id,question:'订单项目幂等方案',libraryIds:['default_lib'],turnId:'citation-test',options:{action:'extract'}});
    await waitFor(() => state.db.getTurns(call('chat:get-sessions')[0].id).some((t: any) => t.id === 'citation-test' && t.status === 'completed'), 'citation answer');
    const answer = state.db.getTurns(call('chat:get-sessions')[0].id).find((t: any) => t.id === 'citation-test');
    assert.deepEqual(answer.hallucinatedNumbers, [999]);
    assert.ok(answer.citationWarning.includes('[资料999]'));
    assert.ok(answer.citations[0].fullText.length > 300);
    pass('Actual chat handler: real citation, complete snapshot and invalid-reference warning survive DB roundtrip');

    mode = 'pauseChat'; pendingRelease = undefined;
    const cancelledSession = await ask('cancel-A', '等待生成');
    await waitFor(() => !!pendingRelease, 'paused chat fetch');
    call('chat:cancel', { turnId: 'cancel-A', sessionId: cancelledSession });
    assert.equal(chatSignal!.aborted, true);
    assert.equal(state.db.getTurns(cancelledSession).find((t: any) => t.id === 'cancel-A').status, 'cancelled');
    mode = 'normal'; await ask('new-B', '新问题');
    await waitFor(() => state.db.getTurns(cancelledSession).some((t: any) => t.id === 'new-B' && t.status === 'completed'), 'B completion');
    pendingRelease!(); await new Promise(r => setTimeout(r, 0));
    assert.ok(!harness.events.some(([name, data]: any[]) => name === 'chat:complete' && data.turnId === 'cancel-A'));
    pass('Actual cancel IPC: aborts network, saves cancelled, suppresses old completion after B');

    mode = 'pauseEmbed'; pendingRelease = undefined;
    const countChatBefore = requests.filter(r => r.url.endsWith('/chat/completions')).length;
    await ask('cancel-retrieval', '订单项目', ['default_lib']);
    await waitFor(() => !!pendingRelease, 'paused embedding fetch');
    call('chat:cancel', { turnId: 'cancel-retrieval', sessionId: cancelledSession });
    assert.equal(chatSignal!.aborted, true); pendingRelease!();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(requests.filter(r => r.url.endsWith('/chat/completions')).length, countChatBefore);
    mode = 'normal';
    pass('Actual retrieval cancellation: early ACK, no downstream LLM request');

    mode = 'pauseChat'; pendingRelease = undefined;
    await ask('queue-first', '第一道题');
    await waitFor(() => !!pendingRelease, 'queue first running');
    mode = 'normal';
    await ask('queue-second', '第二道题');
    assert.equal(state.db.getTurns(cancelledSession).find((t: any)=>t.id==='queue-second').status,'queued');
    call('chat:cancel', {turnId:'queue-first',sessionId:cancelledSession});
    await waitFor(()=>state.db.getTurns(cancelledSession).some((t: any)=>t.id==='queue-second'&&t.status==='completed'),'queued second completion');
    pass('Actual queue: new questions wait without loss; cancel current immediately advances next');

    // A retained legacy independent-image preference must not route screenshots
    // away from the single multimodal model or erase the old configuration.
    state.db.setSetting('vision_shared', 'false');
    const legacyVisionId = state.db.getActiveProviderId('vision');
    call('interview:set-sharing', false);
    assert.equal(call('interview:get-sharing'), true);
    const imageRequests=()=>requests.filter(r=>r.body.messages?.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url')));
    const beforeImage=imageRequests().length;
    await call('chat:ask-question', {sessionId: cancelledSession, question:'截图代码题', turnId:'one-image', options:{images:[{id:'fixture',base64:'aGVsbG8=',mimeType:'image/png'}],language:'C17'}});
    await waitFor(()=>state.db.getTurns(cancelledSession).some((t:any)=>t.id==='one-image'&&t.status==='completed'),'one multimodal response');
    assert.equal(imageRequests().length,beforeImage+1);
    const imageRequest=imageRequests().at(-1)!;
    assert.equal(imageRequest.body.model,profile.modelChat);
    assert.equal(state.db.getActiveProviderId('vision'), legacyVisionId);
    assert.equal(state.db.getSetting('vision_shared'), 'false');
    assert.equal(imageRequest.body.messages.at(-1).content[1].type,'image_url');
    assert.equal(state.db.getTurns(cancelledSession).find((t:any)=>t.id==='one-image').options.images[0].id,'fixture');
    await call('chat:clear-attachments', cancelledSession);
    assert.equal(state.db.getTurns(cancelledSession).find((t:any)=>t.id==='one-image').options.images.length,0);
    state.db.saveTranscript({id:'transcript',sessionId:cancelledSession,captureId:'capture',source:'system',sequence:0,status:'completed',text:'字幕往返',createdAt:Date.now()});
    assert.equal(call('audio:history',cancelledSession)[0].text,'字幕往返');
    pass('Actual unified model: one image request, attachment persistence/cleanup and transcript DB roundtrip');

    // E2E: full-coverage RAG without "项目/你的" gate + live audio split-sentence auto-merge supersede in place
    call('api:set-active-role', { role: 'asr', profileId: profile.id });
    const mergeSession = makeSession('merge-e2e', '实时语音合并重答测试');
    mergeSession.libraryIds = ['default_lib'];
    call('chat:save-session', mergeSession);
    call('chat:select-session', mergeSession.id);
    // 1) Question without old 10-word regex still retrieves citations from default_lib
    await call('chat:ask-question', { sessionId: mergeSession.id, question: '唯一业务编号防重细节', libraryIds: ['default_lib'], turnId: 'rag-open-1' });
    await waitFor(() => state.db.getTurns(mergeSession.id).some((t: any) => t.id === 'rag-open-1' && t.status === 'completed'), 'open rag completion');
    assert.ok(state.db.getTurns(mergeSession.id).find((t: any) => t.id === 'rag-open-1').citations.length > 0, 'Questions without 项目/你的 must still retrieve KB citations');
    // 2) Audio fast auto-submit paused mid-stream, then superseded in-place by trailing half-sentence
    asrQueue.push('那这个 circle light 方案，', '在高并发下怎么保证幂等？');
    const capId = harness.handlers.get('audio:start')({ sender: { id: 77 } }, { sessionId: mergeSession.id, mode: 'system', auto: true });
    const speechFrame = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i * 0.1) * 0.3);
    const silenceFrame = new Float32Array(1600);
    mode = 'pauseChat'; pendingRelease = undefined;
    for (let i = 0; i < 5; i++) state.audioSession.frame(77, capId, 'system', speechFrame);
    for (let i = 0; i < 6; i++) state.audioSession.frame(77, capId, 'system', silenceFrame);
    await waitFor(() => state.audioSession.capture?.pendingText?.includes('circle light'), 'first half-sentence transcribed');
    state.audioSession.capture.lastVoice = Date.now() - 700;
    state.audioSession.flush();
    await waitFor(() => !!pendingRelease, 'first half-sentence streaming started');
    const turnsAfterFirst = state.db.getTurns(mergeSession.id).filter((t: any) => t.id !== 'rag-open-1');
    assert.equal(turnsAfterFirst.length, 1);
    const fastTurnId = turnsAfterFirst[0].id;
    assert.ok(turnsAfterFirst[0].question.includes('SQLite'), 'ASR homophone circle light pre-corrected to SQLite');
    const errorEventsBefore = harness.events.filter(([name]: any[]) => name === 'chat:error').length;
    // Trailing half-sentence arrives -> silently aborts first stream and re-runs SAME turnId with merged question!
    mode = 'normal';
    for (let i = 0; i < 5; i++) state.audioSession.frame(77, capId, 'system', speechFrame);
    for (let i = 0; i < 6; i++) state.audioSession.frame(77, capId, 'system', silenceFrame);
    await waitFor(() => state.audioSession.capture?.pendingText?.includes('怎么保证幂等'), 'second half-sentence transcribed');
    state.audioSession.capture.lastVoice = Date.now() - 700;
    state.audioSession.flush();
    await waitFor(() => state.db.getTurns(mergeSession.id).some((t: any) => t.id === fastTurnId && t.status === 'completed'), 'merged turn completed');
    state.audioSession.stop(77);
    const turnsAfterMerge = state.db.getTurns(mergeSession.id).filter((t: any) => t.id !== 'rag-open-1');
    assert.equal(turnsAfterMerge.length, 1, 'Trailing half-sentence must update existing turn in place, not create duplicate turn');
    assert.equal(turnsAfterMerge[0].id, fastTurnId);
    assert.equal(turnsAfterMerge[0].question, '那这个 SQLite 方案，在高并发下怎么保证幂等？');
    assert.ok(turnsAfterMerge[0].citations.length > 0, 'Merged audio question completed contextual query completion + RAG citations');
    assert.equal(harness.events.filter(([name]: any[]) => name === 'chat:error').length, errorEventsBefore, 'Silent supersede must not emit cancelled error');
    call('chat:delete-session', mergeSession.id);
    pass('Actual E2E audio fast-submit + trailing half-sentence silent supersede + homophone & LLM completion RAG');

    const audioTest = makeSession('audio-boundaries', '语音边界');
    call('chat:save-session', audioTest);
    const owner = 91;
    const audioId = harness.handlers.get('audio:start')({sender:{id:owner}}, {sessionId:audioTest.id,mode:'system',auto:true});
    const speak = async (question: string) => {
      asrQueue.push(question);
      for (let i = 0; i < 5; i++) state.audioSession.frame(owner, audioId, 'system', speechFrame);
      for (let i = 0; i < 6; i++) state.audioSession.frame(owner, audioId, 'system', silenceFrame);
      await waitFor(() => state.audioSession.capture?.pendingText === question, 'voice boundary transcription');
      state.audioSession.capture.lastVoice = Date.now() - 700;
      state.audioSession.flush();
    };
    await speak('线程和进程有什么区别？');
    await waitFor(() => state.db.getTurns(audioTest.id)[0]?.status === 'completed', 'first complete voice answer');
    await speak('死锁的四个必要条件是什么？');
    await waitFor(() => state.db.getTurns(audioTest.id)[1]?.status === 'completed', 'second complete voice answer');
    assert.deepEqual(state.db.getTurns(audioTest.id).map((t: any) => t.question),
      ['线程和进程有什么区别？', '死锁的四个必要条件是什么？']);
    mode = 'pauseChat'; pendingRelease = undefined;
    await speak('那你们的网络模块，');
    await waitFor(() => !!pendingRelease, 'incomplete voice question starts');
    const cancelled = state.db.getTurns(audioTest.id).at(-1);
    call('chat:cancel', {sessionId:audioTest.id, turnId:cancelled.id});
    assert.equal(state.audioSession.capture.lastAutoSubmit, undefined);
    mode = 'normal';
    await speak('它是怎么限流的？');
    await waitFor(() => state.db.getTurns(audioTest.id)[3]?.status === 'completed', 'voice continuation after explicit cancellation');
    const audioTurns = state.db.getTurns(audioTest.id);
    assert.equal(audioTurns[2].id, cancelled.id);
    assert.equal(audioTurns[2].status, 'cancelled');
    assert.equal(audioTurns[3].question, '它是怎么限流的？');
    state.audioSession.stop(owner);
    call('chat:delete-session', audioTest.id);
    pass('Voice question boundaries preserve separate questions and cancellation; incomplete fragments can still merge');

    const privateChunk = state.db.getChunk(oldIds[0]);
    const privateFact = '唯一业务编号';
    assert.ok(privateChunk.text.includes(privateFact));
    const privateSession = {...makeSession('knowledge-boundaries', '知识库边界'), strategy:'docs_only', libraryIds:['default_lib']};
    call('chat:save-session', privateSession);
    const memory = state.db.getMemory(privateSession.id);
    state.db.updateMemory({...memory, currentProject:'order', entries:[
      {id:'private-fact',project:'order',kind:'fact',text:privateFact,source:{type:'document',id:privateChunk.id,quote:privateFact},confirmed:true,updatedAt:Date.now()},
      {id:'private-summary',project:'order',kind:'working',text:'SECRET_SUMMARY_42',source:{type:'assistant',id:'generated-summary',documentIds:[privateChunk.documentId]},confirmed:false,updatedAt:Date.now()}
    ]}, memory.revision);
    state.db.saveTurn({id:'scoped-answer',sessionId:privateSession.id,role:'assistant',status:'completed',question:'历史项目题',
      answer:'SECRET_DRAFT_37',answerPolicyVersion:2,retrieval:{documentIds:[],contextDocumentIds:[privateChunk.documentId]},citations:[],createdAt:1});
    state.db.saveTurn({id:'legacy-answer',sessionId:privateSession.id,role:'assistant',status:'completed',question:'旧题',
      answer:'UNSCOPED_LEGACY_DRAFT_27',answerPolicyVersion:2,citations:[],createdAt:2});
    const alternativeLibrary = {id:'different-library',name:'其他资料库',description:'',docCount:0,createdAt:1,updatedAt:1};
    call('kb:save-library', alternativeLibrary);
    await importFile('storage-schedule.md', '# 排班项目\n\n值班编号 SCHEDULE-352。', alternativeLibrary.id);
    const contextQuestion = '能详细讲讲这个测试吗？';
    for (const [index, libraries] of [[], [alternativeLibrary.id], ['default_lib']].entries()) {
      call('chat:save-session', {...privateSession, libraryIds:libraries});
      const id = 'scope-check-' + index;
      const before = requests.length;
      const completionsBefore = completionInputs.length;
      await call('chat:ask-question',{sessionId:privateSession.id,question:contextQuestion,turnId:id});
      await waitFor(() => state.db.getTurns(privateSession.id).find((t: any) => t.id === id)?.status === 'completed', 'scoped history answer');
      const request = requests.slice(before).find(r => r.body.messages?.at(-1)?.content === contextQuestion);
      const prompt = JSON.stringify(request.body.messages);
      const completion = JSON.stringify(completionInputs.slice(completionsBefore));
      for (const marker of [privateFact, 'SECRET_SUMMARY_42', 'SECRET_DRAFT_37']) {
        assert.equal(prompt.includes(marker), index === 2, marker);
      }
      if (index < 2) assert.ok(!completion.includes('SECRET_DRAFT_37') && !completion.includes('order.md'));
      assert.ok(!prompt.includes('UNSCOPED_LEGACY_DRAFT_27') && !completion.includes('UNSCOPED_LEGACY_DRAFT_27'));
    }
    assert.ok(state.db.getMemory(privateSession.id).entries.some((e: any) => e.id === 'private-fact'));
    pass('Knowledge scope filters document memory, generated notes and older drafts for chat and query completion');

    const typed = '请介绍药物研发里的多肽';
    await call('chat:ask-question',{sessionId:privateSession.id,question:typed,turnId:'typed-uncorrected'});
    await waitFor(() => state.db.getTurns(privateSession.id).find((t: any) => t.id === 'typed-uncorrected')?.status === 'completed', 'literal typed question');
    assert.equal(completionInputs.at(-1).source, 'typed');
    assert.equal(completionInputs.at(-1).currentQuestion, typed);
    assert.ok(requests.some(r => r.body.input?.[0]?.startsWith(typed)));
    assert.ok(requests.some(r => r.body.messages?.at(-1)?.content === typed));
    pass('Typed text stays literal even when contextual completion returns a homophone replacement');

    const manualProject = '用户手动确认的项目';
    call('chat:save-session', {...privateSession, libraryIds:[]});
    call('memory:update', privateSession.id, {expectedRevision:state.db.getMemory(privateSession.id).revision,currentProject:manualProject});
    await call('chat:ask-question',{sessionId:privateSession.id,question:'它是怎么部署的？',turnId:'manual-project'});
    await waitFor(() => state.db.getTurns(privateSession.id).find((t: any) => t.id === 'manual-project')?.status === 'completed', 'manual project remains available');
    assert.ok(JSON.stringify(requests.at(-1).body.messages).includes(manualProject));
    assert.ok(!JSON.stringify(requests.at(-1).body.messages).includes(privateFact));
    call('chat:delete-session', privateSession.id);

    // v1.0.1 (a11040) full E2E audit fixes: identity resume recall, zero-evidence guard, 99ms draft scrubbing, dual-project recall, general-tech isolation
    const auditLib = {id:'audit-a11040', name:'复测审计库', description:'', docCount:0, createdAt:Date.now(), updatedAt:Date.now()};
    call('kb:save-library', auditLib);
    await importFile('测试候选人 _ 嵌入式与端侧推理.txt', '测试候选人，主要方向为嵌入式软件与端侧AI部署，负责Linux驱动与NPU部署。', auditLib.id);
    await importFile('青松视觉项目.md', '# 青松视觉项目\n\n项目编号 GREEN-742。单帧推理最终耗时 17ms，线程排队和预处理都没有计入。', auditLib.id);
    await importFile('赤竹日志项目.md', '# 赤竹日志项目\n\n项目编号 RED-319。负责边缘网关掉电保护环形日志。', auditLib.id);
    const auditDocsList = call('kb:get-documents', auditLib.id);
    const resumeDocId = auditDocsList.find((d: any) => d.fileName.includes('测试候选人')).id;
    const greenDocId = auditDocsList.find((d: any) => d.fileName.includes('青松视觉')).id;
    const auditSession = {...makeSession('audit-session', '事实可靠性回归'), strategy:'docs_and_general' as const, libraryIds:[auditLib.id]};
    call('chat:save-session', auditSession);

    // 1) Voice "你是谁？你是谁？你是谁？" misclassified by LLM as chatter still overrides to resume retrieval
    completionOverride = (_q, _docs, combined) => ({intent:'chatter', rewrittenQuestion:'你是谁？', searchQuery:'你是谁？', targetDocIds:[], thinkingMode:combined ? 'fast' : undefined});
    await call('chat:ask-question', {sessionId:auditSession.id, question:'你是谁？你是谁？你是谁？', libraryIds:[auditLib.id], turnId:'audit-id-voice', options:{audioTiming:{voiceEndedAt:Date.now()-500, submittedAt:Date.now()}}});
    await waitFor(() => state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-id-voice')?.status === 'completed', 'audit voice identity');
    assert.ok(state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-id-voice').citations.some((c: any) => c.documentId === resumeDocId), 'Voice identity question must retrieve resume despite chatter LLM output');

    // 2) Dual-project question retrieves BOTH 青松视觉项目.md and 赤竹日志项目.md
    completionOverride = undefined;
    await call('chat:ask-question', {sessionId:auditSession.id, question:'比较青松视觉项目和赤竹日志项目的用途，各自的项目编号是什么？', libraryIds:[auditLib.id], turnId:'audit-both-typed'});
    await waitFor(() => state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-both-typed')?.status === 'completed', 'audit dual project');
    const bothCites = state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-both-typed').citations;
    assert.ok(bothCites.some((c: any) => c.fullText.includes('GREEN-742')) && bothCites.some((c: any) => c.fullText.includes('RED-319')), 'Both named projects must be retrieved');

    // 3) Follow-up with prior false 99ms draft neither mis-locks to resume on "推理" nor leaks unverified 99ms into prompt
    state.db.saveTurn({id:'audit-poison-draft', sessionId:auditSession.id, role:'assistant', status:'completed',
      question:'介绍一下青松视觉项目', answer:'青松视觉项目最后单帧推理耗时是**99ms**。', answerPolicyVersion:2,
      retrieval:{documentIds:[greenDocId], contextDocumentIds:[greenDocId], name:'青松视觉项目', reason:'本题项目标识匹配', anchor:'青松视觉项目', omitted:[], items:[]},
      citations:[], createdAt:Date.now()});
    completionOverride = (_q, _docs, combined) => ({intent:'project_or_resume', rewrittenQuestion:'青松视觉项目最后单帧推理用了多少毫秒？', searchQuery:'青松视觉项目 单帧推理 毫秒', targetDocIds:[resumeDocId], thinkingMode:combined ? 'fast' : undefined});
    const beforeFollowReq = requests.length;
    await call('chat:ask-question', {sessionId:auditSession.id, question:'这项目最后单帧推理用了多少毫秒？', libraryIds:[auditLib.id], turnId:'audit-follow-17ms', options:{audioTiming:{voiceEndedAt:Date.now()-500, submittedAt:Date.now()}}});
    await waitFor(() => state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-follow-17ms')?.status === 'completed', 'audit 17ms follow-up');
    const followTurn = state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-follow-17ms');
    assert.ok(followTurn.citations.some((c: any) => c.documentId === greenDocId && c.fullText.includes('17ms')), 'Follow-up must hit 青松视觉项目.md (17ms), not resume');
    const followChatReq = requests.slice(beforeFollowReq).find(r => r.body.stream === true)!;
    const followSysPrompt = JSON.stringify(followChatReq.body.messages);
    assert.ok(followSysPrompt.includes('17ms') && !followSysPrompt.includes('99ms'), 'Unverified 99ms draft must be scrubbed while authoritative 17ms is present');

    // 4) General tech question in docs_and_general skips personal project pollution
    completionOverride = (_q, _docs, combined) => ({intent:'general_tech', rewrittenQuestion:'什么叫协程，和线程有什么区别？', searchQuery:'协程 线程 区别', targetDocIds:[], thinkingMode:combined ? 'fast' : undefined});
    await call('chat:ask-question', {sessionId:auditSession.id, question:'什么叫携程，和线程有什么区别？', libraryIds:[auditLib.id], turnId:'audit-general-tech', options:{audioTiming:{voiceEndedAt:Date.now()-500, submittedAt:Date.now()}}});
    await waitFor(() => state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-general-tech')?.status === 'completed', 'audit general tech');
    assert.equal(state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-general-tech').citations.length, 0, 'General tech must not pull unrelated project chunks');

    // 5) Zero-evidence docs_only identity query injects strict anti-hallucination directive
    completionOverride = (_q, _docs, combined) => ({intent:'project_or_resume', rewrittenQuestion:'我是什么职业？我的工作方向是什么？', searchQuery:'职业 工作方向 简历', targetDocIds:[], thinkingMode:combined ? 'fast' : undefined});
    call('chat:save-session', {...auditSession, strategy:'docs_only', libraryIds:[]});
    const beforeNoDocReq = requests.length;
    await call('chat:ask-question', {sessionId:auditSession.id, question:'我是什么职业？我的工作方向是什么？', libraryIds:[], turnId:'audit-no-doc', options:{audioTiming:{voiceEndedAt:Date.now()-500, submittedAt:Date.now()}}});
    await waitFor(() => state.db.getTurns(auditSession.id).find((t: any) => t.id === 'audit-no-doc')?.status === 'completed', 'audit zero-evidence');
    const noDocChatReq = requests.slice(beforeNoDocReq).find(r => r.body.stream === true)!;
    assert.match(JSON.stringify(noDocChatReq.body.messages), /0 条命中.*严禁猜测或编造任何职位方向/);

    completionOverride = undefined;
    call('chat:delete-session', auditSession.id);
    for (const d of auditDocsList) call('kb:delete-document', d.id);
    call('kb:delete-library', auditLib.id);
    pass('Actual E2E v1.0.1 audit fixes: identity resume recall, dual-project recall, 99ms scrubbing, general-tech isolation and zero-evidence guard');

    mode = 'stallEmbedBody'; chatSignal = undefined;
    const stalledSession = await ask('stall-embed-body', '订单项目幂等方案', ['default_lib']);
    await waitFor(() => state.db.getTurns(stalledSession).find((t: any) => t.id === 'stall-embed-body')?.status === 'completed', 'keyword fallback after embedding body timeout');
    const fallback = state.db.getTurns(stalledSession).find((t: any) => t.id === 'stall-embed-body');
    assert.equal(chatSignal?.aborted, true);
    assert.ok(fallback.citations.some((c: any) => c.fileName === 'order.md'));
    mode = 'normal';
    pass('Stalled embedding response body times out and the actual chat flow falls back to keywords');

    const newOrigin = 'https://fixture-new-provider.invalid/v1';
    const beforeOriginTest = requests.length;
    const rejectedTest = await call('api:test-role',{role:'chat',baseUrl:newOrigin,model:profile.modelChat});
    assert.equal(rejectedTest.ok, false);
    assert.equal(requests.length, beforeOriginTest);
    assert.throws(() => call('api:save-role-config',{role:'chat',baseUrl:newOrigin,model:profile.modelChat}), /新服务的 API Key/);
    assert.equal(call('api:get-role-configs').chat.baseUrl, profile.baseUrl);
    assert.equal((await call('api:test-role',{role:'chat',baseUrl:profile.baseUrl+'/same-origin',model:profile.modelChat})).ok,true);
    assert.equal(requests.at(-1).authorization, 'Bearer fixture-only-not-a-real-key');
    assert.equal((await call('api:test-role',{role:'chat',baseUrl:newOrigin,model:profile.modelChat,key:'new-origin-test-key'})).ok,true);
    assert.equal(requests.at(-1).authorization, 'Bearer new-origin-test-key');
    assert.equal(requests.at(-1).url, newOrigin+'/chat/completions');
    const edited = call('api:save-role-config',{role:'chat',baseUrl:newOrigin,model:profile.modelChat,key:'new-origin-test-key'});
    assert.equal(edited.chat.hasKey, true);
    assert.notEqual(edited.chat.profileId, profile.id);
    assert.equal((await call('api:test-provider',{profileId:edited.chat.profileId,role:'chat'})).ok, true);
    assert.equal(requests.at(-1).authorization, 'Bearer new-origin-test-key');
    call('api:set-active-role',{role:'chat',profileId:profile.id});
    // An answer waiting on embeddings captured the old chat endpoint.
    mode = 'pauseEmbed'; pendingRelease = undefined;
    const staleSession = await ask('stale-endpoint', '订单项目', ['default_lib']);
    await waitFor(() => !!pendingRelease, 'old endpoint snapshot waiting on retrieval');
    call('api:save-profile',{...profile,baseUrl:newOrigin});
    assert.equal(call('api:get-role-configs').chat.hasKey, false);
    call('api:set-key',{profileId:profile.id,key:'replacement-key'});
    const requestsBeforeResume = requests.length;
    mode = 'normal'; pendingRelease!();
    await waitFor(() => state.db.getTurns(staleSession).find((t: any) => t.id === 'stale-endpoint')?.status === 'error', 'stale profile rejected before fetch');
    assert.equal(requests.length, requestsBeforeResume);
    saveProfile(profile);
    pass('Saved keys stay on their original origin when testing, saving and resuming in-flight answers');

    mode = 'pauseEmbed'; pendingRelease = undefined;
    const deletion = importFile('delete-while-indexing.txt', '刪除測試 DELETE-COPY-426。');
    await waitFor(() => !!pendingRelease, 'document embedding in flight before deletion');
    const deleting = state.db.getDocuments().find((d: any) => d.fileName === 'delete-while-indexing.txt');
    const original = harness.paths[0];
    const copied = deleting.storagePath;
    assert.ok(fs.existsSync(copied));
    call('kb:delete-document', deleting.id);
    assert.ok(!fs.existsSync(copied));
    assert.ok(fs.existsSync(original));
    pendingRelease!(); await deletion;
    assert.equal(state.db.getDocument(deleting.id), null);
    assert.equal(state.db.getEmbeddingsByDocument(deleting.id).length, 0);
    assert.equal(state.keywordIndex.search('DELETE-COPY-426').length, 0);
    call('kb:delete-document', deleting.id);
    mode = 'normal';
    pass('Deleting a document clears its managed copy and indexes and stays deleted when in-flight indexing completes');

    const thinkingProfile = {...profile, id:'thinking-provider', modelChat:'deepseek-flash'};
    saveProfile(thinkingProfile);
    call('api:set-active-role',{role:'chat',profileId:thinkingProfile.id});
    const thinkingSession = {...makeSession('thinking-router','自动思考测试'), libraryIds:[]};
    call('chat:save-session',thinkingSession);
    const findTurn = (id: string) => state.db.getTurns(thinkingSession.id).find((turn: any) => turn.id === id);
    const sendThinking = (id: string, question: string, options = {}, libraryIds: string[] = []) =>
      call('chat:ask-question',{sessionId:thinkingSession.id,turnId:id,question,options,libraryIds});
    const awaitThinking = async (id: string, expectedMode: string, source: string) => {
      await waitFor(() => findTurn(id)?.status === 'completed', id);
      const timings = findTurn(id).timings;
      assert.deepEqual(timings.thinking,{mode:expectedMode,source});
      const answerRequest = requests.findLast(r => r.body.stream === true);
      assert.equal(answerRequest.body.thinking.type, expectedMode === 'deep' ? 'enabled' : 'disabled');
      const effort = expectedMode === 'deep' ? (source === 'manual' ? 'high' : 'low') : undefined;
      assert.equal(answerRequest.body.reasoning_effort, effort);
      assert.equal(timings.reasoningEffort, effort);
      assert.equal(answerRequest.body.messages.filter((message: any) => message.role === 'system').length, 1);
      assert.ok(timings.firstContentMs >= timings.responseMs);
      assert.ok(Number.isFinite(timings.firstTokenMs));
      return answerRequest.body;
    };
    routerMode = 'fast';
    const beforeFast = routerRequests.length;
    sendThinking('route-fast','TCP 和 UDP 有什么区别？');
    const quick = await awaitThinking('route-fast','fast','model');
    assert.equal(routerRequests.length,beforeFast+1);
    assert.equal(routerRequests.at(-1)!.body.thinking.type,'disabled');
    assert.equal(routerRequests.at(-1)!.body.stream,false);
    assert.ok(Number.isFinite(findTurn('route-fast').timings.routingMs));

    routerMode = 'deep';
    sendThinking('route-deep','如何定位某段代码偶发死锁并兼顾吞吐量？');
    const deep = await awaitThinking('route-deep','deep','model');
    assert.ok(deep.max_tokens > quick.max_tokens);
    assert.match(routerRequests.at(-1)!.body.messages.at(-1).content,/TCP 和 UDP/);

    const beforeAudio = routerRequests.length;
    const beforeCompletion = completionInputs.length;
    sendThinking('route-audio','那刚才这个怎么验证？',{audioTiming:{voiceEndedAt:Date.now()-700,submittedAt:Date.now()}});
    await awaitThinking('route-audio','deep','completion');
    assert.equal(routerRequests.length,beforeAudio);
    assert.equal(completionInputs.length,beforeCompletion+1);
    assert.equal(completionInputs.at(-1).combinedRouting,true);
    assert.ok(Number.isFinite(findTurn('route-audio').timings.completionMs));
    pass('DeepSeek automatic thinking uses model classification and reuses the existing voice completion request');

    call('chat:save-session',{...thinkingSession,thinkingMode:'fast'});
    assert.equal(call('chat:get-sessions').find((s: any)=>s.id===thinkingSession.id).thinkingMode,'fast');
    sendThinking('route-manual-fast','这是一道需要多步设计的架构题');
    await awaitThinking('route-manual-fast','fast','manual');
    sendThinking('route-manual-deep','重新回答原题',{thinkingMode:'deep'});
    await awaitThinking('route-manual-deep','deep','manual');
    sendThinking('route-manual-audio','语音里的技术问题',{audioTiming:{voiceEndedAt:Date.now()-700,submittedAt:Date.now()}});
    await awaitThinking('route-manual-audio','fast','manual');
    assert.equal(completionInputs.at(-1).combinedRouting,false);
    assert.equal(routerRequests.length,beforeAudio);
    call('chat:save-session',{...thinkingSession,thinkingMode:'auto'});

    const images = [{id:'router-image', mimeType:'image/png', base64:'aGVsbG8='}];
    const beforeExtraction = requests.length;
    sendThinking('route-extract','提取试题',{action:'extract',images});
    await awaitThinking('route-extract','fast','action');
    sendThinking('route-image-only','解答截图中的题目',{images,imageOnly:true});
    await awaitThinking('route-image-only','deep','action');
    assert.equal(requests.slice(beforeExtraction).filter(r => r.body.messages?.at(-1)?.content?.[1]?.type === 'image_url').length,2);
    assert.equal(routerRequests.length,beforeAudio);
    pass('Manual thinking preferences apply across input paths; screenshot solving and extraction each send the image once');

    routerMode = 'malformed';
    sendThinking('route-invalid','网关返回未知的分类结果');
    await awaitThinking('route-invalid','fast','fallback');
    routerMode = 'stall';
    sendThinking('route-timeout','分类服务发出响应头但不结束正文');
    await awaitThinking('route-timeout','fast','fallback');
    assert.ok(routerRequests.at(-1)!.signal.aborted);
    assert.ok(findTurn('route-timeout').timings.routingMs >= 1000 && findTurn('route-timeout').timings.routingMs < 3000);
    const beforeCancelRoute = routerRequests.length;
    const beforeCancelAnswer = requests.length;
    sendThinking('route-cancel','等待分类时取消');
    await waitFor(()=>routerRequests.length===beforeCancelRoute+1,'router request before cancel');
    call('chat:cancel',{sessionId:thinkingSession.id,turnId:'route-cancel'});
    assert.equal(routerRequests.at(-1)!.signal.aborted,true);
    await new Promise(r=>setTimeout(r,15));
    assert.equal(findTurn('route-cancel').status,'cancelled');
    assert.equal(requests.length,beforeCancelAnswer);
    pass('The 1.5 second classification deadline falls back to fast, and cancel aborts routing without sending an answer');

    routerMode = 'hold'; releaseRouter = undefined;
    mode = 'pauseEmbed'; pendingRelease = undefined;
    sendThinking('route-parallel','订单项目如何权衡幂等方案',{},['default_lib']);
    await waitFor(()=>!!releaseRouter && !!pendingRelease,'classification and embedding both start before either completes');
    mode = 'normal'; pendingRelease!(); releaseRouter!();
    await awaitThinking('route-parallel','deep','model');
    call('chat:delete-session',thinkingSession.id);
    call('api:set-active-role',{role:'chat',profileId:profile.id});
    pass('Standalone classification and knowledge-base lookup overlap before answer generation');

    const bProfile = { ...profile, id: 'service-B', name: 'B', baseUrl: 'https://fixture-b.invalid/v1', createdAt: 2 };
    saveProfile(bProfile); call('api:set-active-role', { role: 'embed', profileId: bProfile.id });
    await restart();
    assert.equal(state.vectorIndex.size, 0, 'Same model name must not load another provider space');
    const countEmbedBefore = requests.filter(r => r.url.endsWith('/embeddings')).length;
    const noVector = await call('kb:test-retrieval', { query: 'NOT_A_DOCUMENT_KEYWORD', libraryIds: ['default_lib'] });
    assert.ok(noVector.items.every((r: any) => !r.vectorRank));
    assert.equal(requests.filter(r => r.url.endsWith('/embeddings')).length, countEmbedBefore);
    assert.ok(call('kb:get-documents', 'default_lib').every((d: any) => d.status === 'keyword_only'));
    await importFile('network.md', '# 网络\n\n网络独有编号 NETWORK-953');
    await restart();
    assert.equal(state.vectorIndex.getProfile().spaceKey, embeddingSpaceKey(bProfile));
    assert.equal(state.vectorIndex.size, 1);
    pass('Actual config/boot/query: identical model names on different providers remain isolated; missing space explicitly keyword-only');

    const changedModel = { ...bProfile, modelEmbed: 'different-model' };
    saveProfile(changedModel); await restart();
    assert.equal(state.vectorIndex.size, 0, 'No fallback to a different model');
    const changedAddress = { ...changedModel, baseUrl: 'https://fixture-new.invalid/custom/v1' };
    saveProfile(changedAddress);
    assert.equal(state.vectorIndex.size, 0);
    pass('Actual profile edits: model and endpoint changes invalidate live and restored semantic scope');

    saveProfile(profile); call('api:set-active-role', { role: 'embed', profileId: profile.id });
    assert.ok(state.vectorIndex.size > 1);
    dimension = 4;
    await call('kb:rebuild-embeddings', state.db.getDocuments().find((d: any) => d.fileName === 'cache.md').id);
    await restart();
    assert.equal(state.vectorIndex.getProfile().dimensions, 4);
    assert.equal(state.vectorIndex.size, 1);
    const documents = call('kb:get-documents', 'default_lib');
    assert.equal(documents.find((d: any) => d.fileName === 'order.md').status, 'keyword_only');
    pass('Actual partial rebuild: dimensions do not mix; untouched documents show need to rebuild');
    mode = 'invalidEmbed';
    const preserved = state.vectorIndex.size;
    await assert.rejects(() => call('kb:rebuild-embeddings'), /数量|维度|不合法/);
    assert.equal(state.vectorIndex.size, preserved);
    mode = 'normal'; dimension = 3;
    pass('Malformed embedding response cannot replace existing live index');

    mode = 'pauseEmbed'; pendingRelease = undefined;
    const lateImport = importFile('late-config.md', '# 延迟任务\n\n此文档在切换配置时仍在生成向量。');
    await waitFor(() => !!pendingRelease, 'in-flight document embedding');
    saveProfile(bProfile);
    call('api:set-active-role', { role: 'embed', profileId: bProfile.id });
    const preservedB = state.vectorIndex.size;
    assert.ok(preservedB > 0);
    pendingRelease!(); await lateImport;
    const lateDoc = state.db.getDocuments().find((d: any) => d.fileName === 'late-config.md');
    assert.equal(state.db.getEmbeddingsByDocument(lateDoc.id).length, 0);
    assert.equal(state.vectorIndex.size, preservedB);
    assert.equal(state.vectorIndex.getProfile().spaceKey, embeddingSpaceKey(bProfile));
    mode = 'normal'; dimension = 3;
    call('api:set-active-role', { role: 'embed', profileId: profile.id });
    pass('In-flight import cannot overwrite the newly selected provider index');

    call('kb:delete-library', 'default_lib');
    call('kb:save-library', { id: 'replacement', name: '新库', description: '', docCount: 0, createdAt: 2, updatedAt: 2 });
    harness.paths = [file]; await call('kb:import-files', 'replacement');
    await waitFor(() => !state.ingestionQueue.getStats().queued && !state.ingestionQueue.getStats().processing, 'orphan relink');
    assert.equal(call('kb:get-documents', 'replacement').length, 1);
    assert.ok((await call('kb:test-retrieval', { query: '订单', libraryIds: ['replacement'] })).items.length > 0);
    assert.equal(state.keywordIndex.search('订单', ['default_lib']).length, 0);
    await restart();
    assert.ok((await call('kb:test-retrieval', { query: '订单', libraryIds: ['replacement'] })).items.length > 0);
    assert.equal(state.keywordIndex.search('订单', ['default_lib']).length, 0);
    pass('Actual delete/import/restart: orphaned duplicate file is searchable again without reviving deleted library');

    for (const maxTokens of [1, 2, 32, 600]) {
      for (const text of ['中'.repeat(5000), 'A'.repeat(5000), '中文 English 😀\nconst x = 1;\n'.repeat(120), '|项目|数值|\n|甲|乙|\n'.repeat(200)]) {
        const chunks = chunkDocument('budget', 1, 'lib', { text, sections: [{ title: '文档', level: 1, content: text }], pageCount: null, needsOcr: false }, { maxTokens, overlapTokens: 80 });
        assert.ok(chunks.length > 0);
        for (const chunk of chunks) {
          assert.ok(chunk.tokenEstimate <= maxTokens);
          assert.equal(chunk.tokenEstimate, estimateTokens(chunk.text));
          assert.equal(text.slice(chunk.sourceStart, chunk.sourceEnd), chunk.text);
          assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk.text), 'No broken surrogate pairs');
        }
      }
    }
    pass('Actual chunker: Chinese/English/code/table/emoji budgets and offsets hold at 1/2/32/600');

    const { runComponentContracts } = require('./componentContracts.cjs');
    for (const name of await runComponentContracts(project, directory)) pass(name);
    // A legacy row has no trusted space identity and must stay keyword-only.
    state.db.close();
    const legacyDirectory = path.join(directory, 'legacy'); fs.mkdirSync(legacyDirectory);
    const OldSqlite = require('better-sqlite3');
    const oldDb = new OldSqlite(path.join(legacyDirectory, 'app_data.db'));
    oldDb.exec('CREATE TABLE embeddings (chunk_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, dimensions INTEGER NOT NULL, vector_blob BLOB NOT NULL, created_at INTEGER NOT NULL)');
    oldDb.close();
    const legacy = new AppDatabase(path.join(legacyDirectory, 'app_data.db'));
    legacy.saveLibrary({ id: 'legacy', name: 'legacy', description: '', docCount: 0, createdAt: 1, updatedAt: 1 });
    legacy.saveProfile(profile); legacy.setActiveProviderId('embed', profile.id);
    legacy.saveDocument({ id: 'legacy-doc', fileName: 'old.txt', fileType: 'txt', fileSize: 4, fileHash: 'old', pageCount: null, status: 'ready', errorMsg: null, needsOcr: false, storagePath: '', libraryIds: ['legacy'], createdAt: 1, updatedAt: 1 });
    legacy.saveChunks([{ id: 'legacy-chunk', documentId: 'legacy-doc', documentVersion: 1, libraryId: 'legacy', sectionPath: '正文', pageStart: null, pageEnd: null, ordinal: 1, sourceStart: 0, sourceEnd: 2, text: '旧资料', contentHash: 'old', tokenEstimate: 3, createdAt: 1 }]);
    legacy.saveEmbeddings([{ chunkId: 'legacy-chunk', profileId: profile.id, model: profile.modelEmbed, dimensions: 3, vector: [1, 0, 0] }]);
    legacy.close(); await boot(legacyDirectory);
    assert.equal(state.vectorIndex.size, 0);
    assert.equal(call('kb:get-documents', 'legacy')[0].status, 'keyword_only');
    assert.ok(state.keywordIndex.search('旧资料', ['legacy']).length);
    pass('Legacy vectors without a trustworthy space key are preserved but never guessed into current semantic index');
  } finally {
    globalThis.fetch = originalFetch;
    state?.db?.close();
    const report = { date: new Date().toISOString(), passed: results.length, tests: results,
      limitations: ['HTTP/OS boundaries are test doubles; component hooks are simulated, not DOM; real suppliers and signing not verified'] };
    const reportPath = process.env.PRODUCTION_TEST_REPORT;
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
