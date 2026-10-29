const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');

function hooks() {
  const h = { slots: [], cursor: 0, effects: [], callbacks: {}, exposed: null };
  h.useState = initial => {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [h.slots[i], value => { h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value; }];
  };
  h.useRef = initial => {
    const i = h.cursor++;
    return h.slots[i] ?? (h.slots[i] = { current: initial });
  };
  h.useEffect = (effect, deps) => {
    const i = h.cursor++;
    const old = h.slots[i];
    if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
      h.effects.push(() => { old?.cleanup?.(); h.slots[i] = { deps, cleanup: effect() }; });
    }
  };
  h.flush = () => { for (const run of h.effects.splice(0)) run(); };
  return h;
}

async function compileComponent(project, directory, name) {
  const sourcePath = path.join(project, 'src/renderer/src/components', name + '.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const iconImport = source.match(/import\s*\{([^}]+)\}\s*from 'lucide-react'/);
  const names = iconImport[1].split(',').map(x => x.trim()).filter(Boolean);
  const output = path.join(directory, name + '.cjs');
  await esbuild.build({ entryPoints: [sourcePath], bundle: true, platform: 'node', format: 'cjs',
    jsx: 'automatic', outfile: output, plugins: [{ name: 'actual-component-test', setup(b) {
      b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, a => ({ path: a.path, namespace: 'test' }));
      b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, a => ({ loader: 'js', contents:
        a.path === 'react' ? 'const h=globalThis.__componentTest;export const useState=h.useState,useRef=h.useRef,useEffect=h.useEffect;export default {};' :
        a.path === 'react/jsx-runtime' ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' :
        'export const ' + names.map(n => `${n}=${JSON.stringify(n)}`).join(',') + ';' }));
      b.onLoad({ filter: /(?:CopilotView|FloatingWindowView)\.tsx$/ }, () => {
        const exposure = name === 'CopilotView' ? '{handleSend,handleStop,select:selectHistoryTurn,resumeFollowing,navigation:navigation.current}' : '{handleTogglePin}';
        const modified = source.replace('  return (\n    <div', `  globalThis.__componentTest.exposed=${exposure};\n  return (\n    <div`);
        assert.notEqual(modified, source, 'Test exposure anchor must exist');
        return { contents: modified, loader: 'tsx' };
      });
    } }] });
  return require(output)[name];
}

exports.runComponentContracts = async (project, directory) => {
  const results = [];
  let h = global.__componentTest = hooks();
  let cancelled;
  global.alert = message => { throw new Error('Unexpected alert: ' + message); };
  global.window = { api: {
    selectSession: async () => {}, getActiveTurn: async () => null, getTurns: async () => [],
    onChatStreamStart: cb => (h.callbacks.start = cb, () => {}),
    onChatStreamToken: cb => (h.callbacks.token = cb, () => {}),
    onChatStreamComplete: cb => (h.callbacks.complete = cb, () => {}),
    onChatStreamError: cb => (h.callbacks.error = cb, () => {}),
    askQuestion: async (...args) => args[3], cancelGeneration: async (...args) => { cancelled = args; }
  } };
  const Copilot = await compileComponent(project, directory, 'CopilotView');
  let props = { currentSession: { id: 's1', libraryIds: [] }, libraries: [] };
  const render = () => { h.cursor = 0; Copilot(props); h.flush(); };
  render(); await new Promise(r => setTimeout(r, 0)); render();
  await h.exposed.handleSend('A'); render();
  const a = { ...h.slots[2] };
  h.callbacks.token({ turnId: a.id, sessionId: 's1', token: 'A-token' });
  assert.equal(h.slots[2].answer, 'A-token');
  h.exposed.handleStop(); render();
  assert.equal(cancelled[0], a.id);
  await h.exposed.handleSend('B'); render();
  const b = { ...h.slots[2] };
  for (const kind of ['token', 'complete', 'error']) {
    const message = { turnId: a.id, sessionId: 's1', token: 'LATE', turn: { ...a, answer: 'OLD', status: 'completed' }, error: 'late error' };
    h.callbacks[kind](message);
    assert.equal(h.slots[2].id, b.id);
    assert.equal(h.slots[2].question, 'B');
    assert.equal(h.slots[2].answer, '');
    assert.equal(h.slots[3], true, 'Old events must not end B generation');
  }
  h.callbacks.token({ turnId: b.id, sessionId: 's1', token: 'B-token' });
  assert.equal(h.slots[2].answer, 'B-token');
  h.exposed.select(a); render();
  h.callbacks.token({ turnId: b.id, sessionId: 's1', token: '-more' });
  assert.equal(h.slots[2].id, a.id, 'Reading history must not change displayed selection');
  assert.equal(h.slots[1].find(t => t.id === b.id).answer, 'B-token-more');
  h.callbacks.complete({ turnId: b.id, sessionId: 's1', turn: { ...b, answer: 'B-final', status: 'completed' } });
  assert.equal(h.slots[2].id, a.id);
  assert.equal(h.slots[3], false);
  results.push('Actual CopilotView: stale A token/complete/error cannot modify B; history selection is independent');

  // 停留：选中历史题后，新题开始/推进/结束都不得抢走选中
  const c = { id: 'c', sessionId: 's1', question: 'C', answer: '', status: 'streaming', citations: [], createdAt: Date.now() + 100 };
  const d = { ...c, id: 'd', question: 'D', createdAt: c.createdAt + 1 };
  for (const turn of [c, d]) {
    h.callbacks.start({ sessionId: 's1', turnId: turn.id, turn }); render();
    h.callbacks.token({ sessionId: 's1', turnId: turn.id, token: 'new answer' });
    h.callbacks.complete({ sessionId: 's1', turnId: turn.id, turn: { ...turn, answer: 'final', status: 'completed' } });
    assert.equal(h.slots[2].id, a.id, 'New starts/tokens/completions must preserve history selection');
  }
  render();
  assert.equal(h.exposed.navigation.unread(h.slots[1]), 2);
  h.exposed.resumeFollowing(); render();
  assert.equal(h.slots[2].id, d.id);
  assert.equal(h.slots[2].answer, 'final');
  const e = { ...d, id: 'e', createdAt: d.createdAt + 1 };
  h.callbacks.start({ sessionId: 's1', turnId: e.id, turn: e }); render();
  assert.equal(h.slots[2].id, e.id, 'Return latest restores automatic following');
  results.push('Actual CopilotView: multiple new questions preserve history; return latest resumes following');

  props = { currentSession: { id: 's2', libraryIds: [] }, libraries: [] };
  render(); await new Promise(r => setTimeout(r, 0)); render();
  h.callbacks.complete({ turnId: b.id, sessionId: 's1', turn: { ...b, answer: 'CROSS-SESSION' } });
  assert.equal(h.slots[2], null);
  results.push('Actual CopilotView: session switching rejects foreign completion');

  h = global.__componentTest = hooks();
  global.window = { api: {
    getActiveTurn: async () => null,
    onChatSessionSelected: cb => (h.callbacks.session = cb, () => {}),
    onChatStreamStart: cb => (h.callbacks.start = cb, () => {}),
    onChatStreamToken: cb => (h.callbacks.token = cb, () => {}),
    onChatStreamComplete: cb => (h.callbacks.complete = cb, () => {}),
    onChatStreamError: cb => (h.callbacks.error = cb, () => {})
  } };
  const Floating = await compileComponent(project, directory, 'FloatingWindowView');
  const floatRender = () => { h.cursor = 0; Floating(); h.flush(); };
  floatRender();
  h.callbacks.start({ turnId: 'fa', sessionId: 's1', question: 'FA', createdAt: 1 });
  h.callbacks.start({ turnId: 'fb', sessionId: 's1', question: 'FB', createdAt: 2 });
  h.callbacks.token({ turnId: 'fa', sessionId: 's1', token: 'OLD' });
  h.callbacks.complete({ turnId: 'fa', sessionId: 's1', turn: { ...a, id: 'fa', answer: 'OLD' } });
  h.callbacks.error({ turnId: 'fa', sessionId: 's1', error: 'OLD' });
  assert.equal(h.slots[0].id, 'fb');
  assert.equal(h.slots[0].answer, '');
  h.callbacks.token({ turnId: 'fb', sessionId: 's1', token: 'NEW' });
  floatRender(); h.exposed.handleTogglePin(); floatRender();
  const pinned = h.slots[1];
  h.callbacks.session({sessionId:'s2',turn:null});
  h.callbacks.start({ turnId: 'fc', sessionId: 's2', question: 'FC', createdAt: 3 });
  h.callbacks.token({ turnId: 'fc', sessionId: 's2', token: 'LATEST' });
  assert.equal(h.slots[1], pinned, 'Pin must preserve displayed snapshot');
  floatRender(); h.exposed.handleTogglePin(); floatRender();
  assert.equal(h.slots[0].id, 'fc');
  assert.equal(h.slots[0].answer, 'LATEST');
  h.callbacks.complete({ turnId: 'fc', sessionId: 's2', turn: { id: 'fc', sessionId: 's2', question: 'FC', answer: 'DONE', status: 'completed', citations: [] } });
  floatRender();
  assert.equal(h.slots[0].answer, 'DONE');
  results.push('Actual FloatingWindowView: scoped events, completed rendering, pin/unpin retain latest answer');
  return results;
};
