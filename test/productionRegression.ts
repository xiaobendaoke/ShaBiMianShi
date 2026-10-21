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
        b.onLoad({ filter: /src\/main\/index\.ts$/ }, a => {
          const source = fs.readFileSync(a.path, 'utf8');
          assert.ok(source.includes('  registerIpc();'));
          return { loader: 'ts', contents: source.replace('  registerIpc();',
            '  globalThis.__productionTest.state={db,keywordIndex,vectorIndex,ingestionQueue};\n  registerIpc();') };
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
  globalThis.fetch = (async (url: any, options: any) => {
    const body = JSON.parse(options.body);
    if(body.messages?.[0]?.content?.includes('整理会话记忆'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({project:'',facts:[],working:[],uncertain:[]})}}]}),{headers:{'content-type':'application/json'}});
    const embedding = String(url).endsWith('/embeddings');
    requests.push({ url: String(url), body });
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
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
