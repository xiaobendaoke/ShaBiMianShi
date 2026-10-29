import type { BrowserWindow } from 'electron';

// WebContents can be destroyed before its BrowserWindow emits "closed".
export function sendToWindow(window: BrowserWindow | null, channel: string, ...args: any[]) {
  if (!window || window.isDestroyed()) return;
  const contents = window.webContents;
  if (contents.isDestroyed()) return;
  try {
    contents.send(channel, ...args);
  } catch (error) {
    // Destruction can also happen between the check and the native send call.
    if (window.isDestroyed() || contents.isDestroyed()) return;
    if (error instanceof Error && error.message === 'Object has been destroyed') return;
    throw error;
  }
}
