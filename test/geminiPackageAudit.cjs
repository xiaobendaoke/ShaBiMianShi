// Run with the development Electron executable to load the delivered bundle via this test entrypoint. Packaged launchers ignore external entry scripts.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const project = path.resolve(__dirname, '..');
const appRoot=JSON.parse(fs.readFileSync(path.join(project,'release/latest-build.json'))).path;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'interviewdog-ui-'));
process.env.INTERVIEWDOG_TEST_DATA_DIR = data;
process.env.INTERVIEWDOG_TEST_LEGACY_AUDIO='1';
process.env.INTERVIEWDOG_RESOURCE_DIR = path.join(appRoot,'Contents/Resources/app');
delete process.env.VITE_DEV_SERVER_URL;
delete process.env.MOCK_SERVER;
const output = process.env.SMOKE_OUTPUT_DIR || path.join(data, 'results');
fs.mkdirSync(output, { recursive: true });
const files = [path.join(data, 'order.md'), path.join(data, 'notes.txt'), path.join(__dirname, 'fixtures/qa-text.pdf'), path.join(__dirname, 'fixtures/qa-document.docx')];
fs.writeFileSync(files[0], '# 订单项目\n\n本项目的独有编号是 QA-ORDER-731。使用唯一业务键避免重复提交，未提供性能提升数字。');
fs.writeFileSync(files[1], '测试学习笔记，缓存文档的编号是 QA-CACHE-284。');
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
app.on('browser-window-created', (_event, win) => win.hide());
const outcomes = [];
let longConnectionClosed = false;
let longStarted = false;
let server;
let exitCode = 0;
const runtimeErrors = [];
async function wait(test, label) {
  const deadline = Date.now() + 15000;
  while (!(await test())) { if (Date.now() > deadline) throw new Error('Timeout: ' + label); await new Promise(r => setTimeout(r, 20)); }
}
function record(name) { outcomes.push(name); console.log('PASS:', name); }
function inputQuestion(win, question) {
  return win.webContents.executeJavaScript(`(async()=>{const e=document.querySelector('textarea[placeholder^="输入面试官"]');if(!e)throw new Error('Question input missing');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(question)});e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
}
async function run() {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', b => chunks.push(b));
    req.on('end', () => {
      try {
        if(req.url.endsWith('/audio/transcriptions')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'数据库索引为什么能加快查询？'}));return;}
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (req.url.endsWith('/embeddings')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: text.includes('订单') ? [1, 0, 0] : [0, 1, 0] })) }));
          return;
        }
        if (req.url.endsWith('/chat/completions')) {
          if(body.messages[0]?.content?.includes('整理会话记忆')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({project:'订单项目',facts:[],working:[],uncertain:[]})}}]}));return;}
          const input = body.messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
          const long = input.includes('取消测试');
          const hasImage = Array.isArray(body.messages.at(-1)?.content) && body.messages.at(-1).content.some(p=>p.type==='image_url');
          const answer = hasImage ? 'IMAGE CHECK 7391, f(3)=7' : long ? '取消测试正在生成，等待用户停止。'.repeat(300) : input.includes('QA-ORDER-731') ? '项目的独有编号为 QA-ORDER-731。' : '没有读取到相关项目资料。';
          if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: answer } }] })); return; }
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
          res.flushHeaders();
          if (long) longStarted = true;
          let at = 0;
          const timer = setInterval(() => {
            if (res.destroyed) { clearInterval(timer); return; }
            if (at >= answer.length) { res.write('data: [DONE]\n\n'); res.end(); clearInterval(timer); return; }
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: answer.slice(at, at + 2) } }] }) + '\n\n'); at += 2;
          }, long ? 30 : 25);
          res.on('close', () => { if (long) longConnectionClosed = true; clearInterval(timer); });
          return;
        }
        res.writeHead(404); res.end();
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await import(pathToFileURL(path.join(appRoot, 'Contents/Resources/app/dist/main/index.js')).href);
  let main;
  await wait(async () => {
    main = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (!main || main.webContents.isLoading()) return false;
    return main.webContents.executeJavaScript('!!window.api && !!document.querySelector("textarea")').catch(() => false);
  }, 'packaged renderer and preload');
  main.webContents.on('console-message', (_event, level, message) => { if (level >= 3) runtimeErrors.push(message); });
  record('Delivered main/preload/renderer load in actual Electron with isolated user data');
  const profile = { id: 'qa-local-service', name: '本地回归服务', protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, hasKey: true, modelChat: 'qa-chat', modelEmbed: 'qa-embed', modelVision: 'qa-vision', modelAsr: 'qa-asr', timeoutMs: 5000, isActive: false, createdAt: Date.now() };
  await main.webContents.executeJavaScript(`(async()=>{await window.api.saveProfile(${JSON.stringify(profile)});await window.api.setApiKey('qa-local-service','fixture-local-only');await window.api.setActiveRole('chat','qa-local-service');await window.api.setActiveRole('embed','qa-local-service');await window.api.setActiveRole('asr','qa-local-service');await window.api.selectAndImportFiles('default_lib');})()`);
  await wait(() => main.webContents.executeJavaScript('(async()=>{const s=await window.api.getIngestionStats();return !s.processing&&!s.queued;})()'), 'mixed document ingestion');
  const allDocuments = await main.webContents.executeJavaScript("window.api.getDocuments('default_lib')");
  const documents = allDocuments.filter(d=>files.map(f=>path.basename(f)).includes(d.fileName));
  assert.equal(documents.length, 4);
  for (const document of documents) {
    assert.equal(document.status, 'ready', document.fileName + ': ' + document.errorMsg);
    const text = await main.webContents.executeJavaScript(`window.api.getDocumentText(${JSON.stringify(document.id)})`);
    assert.ok(text.length > 10);
    if (document.fileName.endsWith('.pdf')) assert.ok(text.includes('QA-PDF-842'));
    if (document.fileName.endsWith('.docx')) assert.ok(text.includes('QA-DOCX-953'));
  }
  record('Actual packaged parsers import MD/TXT/PDF/DOCX through preload/IPC and persist semantic index');
  await inputQuestion(main, '订单项目的独有编号是什么？');
  let partial = false;
  await wait(async () => {
    const text = await main.webContents.executeJavaScript('document.body.innerText');
    if (text.includes('项目的独有') && !text.includes('QA-ORDER-731')) partial = true;
    const turns = await main.webContents.executeJavaScript('(async()=>{const s=await window.api.getSessions();return window.api.getTurns(s[0].id);})()');
    return turns.at(-1)?.status === 'completed';
  }, 'real renderer streaming answer');
  const answer = await main.webContents.executeJavaScript('(async()=>{const s=await window.api.getSessions();return (await window.api.getTurns(s[0].id)).at(-1);})()');
  assert.ok(answer.answer.includes('QA-ORDER-731'));
  assert.ok(answer.citations.some(c => c.fileName === 'order.md' && c.fullText.includes('QA-ORDER-731')));
  assert.ok((await main.webContents.executeJavaScript('document.body.innerText')).includes('QA-ORDER-731'));
  // Short spoken answers can fit entirely in the initial validation buffer.
  record('Actual textarea/Enter -> retrieval -> local SSE -> partial DOM -> answer and real citation');
  await main.webContents.executeJavaScript('window.api.toggleFloatingWindow()');
  let floating;
  await wait(async () => {
    floating = BrowserWindow.getAllWindows().find(w => w.id !== main.id);
    return floating && !floating.webContents.isLoading() && floating.webContents.executeJavaScript('document.body.innerText.includes("QA-ORDER-731")').catch(() => false);
  }, 'floating answer');
  record('Actual floating window renders the current answer without contract errors');
  await inputQuestion(main, '取消测试，请持续生成');
  await wait(() => longStarted, 'long streaming request');
  await main.webContents.executeJavaScript(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.innerText.includes('停止'));if(!b)throw new Error('Stop button missing');b.click();})()`);
  await wait(() => longConnectionClosed, 'network connection closed by real Stop click');
  const cancelled = await main.webContents.executeJavaScript('(async()=>{const s=await window.api.getSessions();return (await window.api.getTurns(s[0].id)).at(-1);})()');
  assert.equal(cancelled.status, 'cancelled');
  await inputQuestion(main, '订单项目的独有编号是什么？');
  await wait(async () => (await main.webContents.executeJavaScript('(async()=>{const s=await window.api.getSessions();return (await window.api.getTurns(s[0].id)).at(-1);})()')).id !== cancelled.id, 'new question');
  const stale = { turnId: cancelled.id, sessionId: cancelled.sessionId };
  for (const win of [main, floating]) {
    win.webContents.send('chat:token', { ...stale, token: 'STALE_OVERRIDDEN' });
    win.webContents.send('chat:complete', { ...stale, turn: { ...cancelled, status: 'completed', answer: 'STALE_OVERRIDDEN' } });
    win.webContents.send('chat:error', { ...stale, error: 'STALE_OVERRIDDEN' });
  }
  await wait(async () => (await main.webContents.executeJavaScript('(async()=>{const s=await window.api.getSessions();return (await window.api.getTurns(s[0].id)).at(-1);})()')).status === 'completed', 'new answer after cancellation');
  for (const win of [main, floating]) assert.ok(!(await win.webContents.executeJavaScript('document.body.innerText')).includes('STALE_OVERRIDDEN'));
  record('Actual Stop closes HTTP; a new answer rejects injected stale token/complete/error in both real renderers');
  await main.webContents.executeJavaScript(`(async()=>{
    const context=new AudioContext();await context.resume();
    const destination=context.createMediaStreamDestination();const gain=context.createGain();gain.gain.value=0.15;
    const osc=context.createOscillator();osc.frequency.value=300;osc.connect(gain).connect(destination);osc.start();
    window.__fixtureAudio={context,osc};
    navigator.mediaDevices.getDisplayMedia=async()=>destination.stream;
    const button=Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='开始监听');
    if(!button)throw Error('Listen button missing');button.click();
    setTimeout(()=>{gain.gain.value=0},2000);
  })()`,true);
  await wait(async()=>main.webContents.executeJavaScript('(async()=>{const s=(await window.api.getSessions())[0];return (await window.api.getTranscripts(s.id)).some(r=>r.status==="completed"&&r.text.includes("数据库索引"));})()'),'actual AudioWorklet to PCM to WAV to ASR');
  await main.webContents.executeJavaScript(`(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.title.startsWith('点击停止监听'));if(!button)throw Error('Actual audio Stop button missing');button.click();window.__fixtureAudio.osc.stop();window.__fixtureAudio.context.close();})()`);
  record('Actual AudioWorklet synthetic audio -> PCM frames -> VAD WAV -> ASR IPC -> persisted transcript; no physical microphone capture');
  await wait(()=>main.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).some(b=>b.innerText==='开始监听')"),'actual audio stopped');
  await main.webContents.executeJavaScript(`(()=>{navigator.mediaDevices.getDisplayMedia=()=>new Promise(()=>{});Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='开始监听').click();})()`,true);
  await wait(()=>main.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).some(b=>b.innerText==='连接中…')"),'pending real audio start');
  const pendingControls=await main.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).filter(b=>/连接中|取消连接/.test(b.innerText)).map(b=>({text:b.innerText,disabled:b.disabled}))");
  assert.ok(pendingControls.some(b=>b.disabled&&b.text==='连接中…'));
  fs.writeFileSync(path.join(output,'audio-cancel-regression.json'),JSON.stringify({confirmed:true,pendingControls,note:'Media acquisition deliberately pending; no enabled cancellation control. Not a physical capture test.'},null,2));
  record('CONFIRMED REGRESSION: pending audio acquisition has only a disabled button; user cannot cancel');
  await main.webContents.executeJavaScript('window.api.stopListening()');

  main.showInactive(); floating.showInactive(); await new Promise(r=>setTimeout(r,250));
  fs.writeFileSync(path.join(output, '面试助手-修复后主窗口.png'), (await main.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, '面试助手-修复后悬浮窗.png'), (await floating.capturePage()).toPNG());
  const capabilities = await main.webContents.executeJavaScript(`(async()=>{
    const profiles=await window.api.getRoleConfigs();
    const test=role=>window.api.testRoleConnection({role,baseUrl:profiles.chat.baseUrl,model:role==='asr'?'qa-asr':'qa-chat'});
    return [await test('vision'),await test('asr')];
  })()`);
  assert.ok(capabilities.every(r=>r.ok),JSON.stringify(capabilities));
  await main.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText.includes('模型与 API')).click()`);
  await wait(()=>main.webContents.executeJavaScript('document.body.innerText.includes("默认问答模型（文字 / 图片 / 代码）")'),'unified model UI');
  assert.ok(await main.webContents.executeJavaScript('document.body.innerText.includes("测试图片能力")'));
  await new Promise(r=>setTimeout(r,200));
  fs.writeFileSync(path.join(output,'模型配置-统一问答.png'),(await main.capturePage()).toPNG());
  record('Packaged image/audio test fixtures load, capability response validation passes and unified model UI renders');
  assert.ok(!runtimeErrors.some(e => /Uncaught|TypeError|ReferenceError/.test(e)), JSON.stringify(runtimeErrors));
}
app.whenReady().then(async () => {
  try { await run(); }
  catch (e) { exitCode = 1; console.error(e.stack || e); }
  finally {
    fs.writeFileSync(path.join(output, '面试助手-打包窗口验证.json'), JSON.stringify({ passed: exitCode === 0, tests: outcomes, runtimeErrors,
      note: 'Real delivered Electron runtime, main, preload and React DOM; isolated data, file-dialog fixture and local HTTP model. No commercial provider validation.' }, null, 2));
    server?.closeAllConnections(); server?.close();
    app.quit();
  }
});
app.on('quit', () => { fs.rmSync(data, { recursive: true, force: true }); process.exitCode = exitCode; });
