import assert from 'node:assert/strict';
import { sendToWindow } from '../src/main/windows/sendToWindow';

const received: unknown[][] = [];
const live = { isDestroyed: () => false, webContents: {
  isDestroyed: () => false, send: (...args: unknown[]) => received.push(args)
} };
const destroyedContents = { isDestroyed: () => false, webContents: {
  isDestroyed: () => true, send: () => { throw Error('must not send'); }
} };
sendToWindow(null, 'audio:state');
sendToWindow({ isDestroyed: () => true } as any, 'audio:state');
sendToWindow(destroyedContents as any, 'audio:state');
const race = { isDestroyed: () => false, webContents: {
  isDestroyed: () => false, send: () => { throw new TypeError('Object has been destroyed'); }
} };
// A closing recipient must not interrupt delivery to the surviving window.
for (const window of [destroyedContents, race, live]) {
  sendToWindow(window as any, 'audio:state', { running: false });
}
assert.deepEqual(received, [['audio:state', { running: false }]]);
assert.throws(() => sendToWindow({ ...live, webContents: {
  isDestroyed: () => false, send: () => { throw Error('unrelated failure'); }
} } as any, 'audio:state'), /unrelated failure/);
console.log('PASS window destruction, send race, surviving recipient and unrelated errors');
