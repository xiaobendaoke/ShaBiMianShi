import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import electron from 'electron';
import type { ImageAttachment } from '../types';
export type ScreenCaptureResult = Omit<ImageAttachment, 'id'>;

function validateCapturedPng(bytes: Buffer): ScreenCaptureResult {
  if (bytes.length < 24 || bytes.subarray(1, 4).toString() !== 'PNG') throw new Error('截图格式无效，请重新选区');
  const image = electron.nativeImage.createFromBuffer(bytes);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (image.isEmpty() || width < 20 || height < 20) throw new Error('选区过小，请包含完整题目');
  if (bytes.length > 16 * 1024 * 1024 || width > 8192 || height > 8192) throw new Error('截图超出大小限制，请分成多张选区截图');
  const pixels = image.resize({ width: 64, height: 64 }).toBitmap();
  let min = 255, max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    min = Math.min(min, light);
    max = Math.max(max, light);
  }
  if (max - min < 2) throw new Error('截图为空白，请重新选择包含题目的区域');
  return { base64: bytes.toString('base64'), mimeType: 'image/png', width, height };
}

async function captureScreenDarwin(mode: 'interactive' | 'fullscreen'): Promise<ScreenCaptureResult | null> {
  if (electron.systemPreferences?.getMediaAccessStatus?.('screen') === 'denied') {
    throw new Error('屏幕录制权限未授权，请到系统设置→隐私与安全性→屏幕与系统音频录制中允许本应用');
  }
  const file = path.join(os.tmpdir(), `interviewdog_capture_${crypto.randomUUID()}.png`);
  try {
    let failure: Error | null = null;
    let stderr = '';
    await new Promise<void>(resolve =>
      execFile(
        '/usr/sbin/screencapture',
        mode === 'interactive' ? ['-i', '-s', '-x', file] : ['-m', '-x', file],
        { timeout: 120000 },
        (error, _out, err) => {
          failure = error;
          stderr = err;
          resolve();
        }
      )
    );
    if (!fs.existsSync(file)) {
      const failed = failure as { killed?: boolean; signal?: string; code?: number | string } | null;
      if (
        mode === 'interactive' &&
        (!stderr.trim() || /cancel/i.test(stderr)) &&
        !failed?.killed &&
        !failed?.signal &&
        (failed?.code === undefined || failed?.code === 1)
      ) {
        return null;
      }
      throw new Error(stderr.trim() || '截图失败或超时，请检查屏幕录制权限');
    }
    const bytes = fs.readFileSync(file);
    return validateCapturedPng(bytes);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  vw: number;
  vh: number;
}

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; cursor: crosshair; background: #000; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
  #bg { position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: fill; pointer-events: none; }
  #mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); pointer-events: none; }
  #box { position: fixed; display: none; border: 2px solid #0071e3; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.42); pointer-events: none; }
  #size { position: fixed; display: none; padding: 2px 6px; border-radius: 4px; background: rgba(29, 29, 31, 0.85); color: #fff; font-size: 11px; pointer-events: none; }
  #hint { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); padding: 6px 14px; border-radius: 999px; background: rgba(29, 29, 31, 0.82); color: #fff; font-size: 12px; letter-spacing: 0.01em; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
</style>
</head>
<body>
  <img id="bg" />
  <div id="mask"></div>
  <div id="box"></div>
  <div id="size"></div>
  <div id="hint">拖拽鼠标框选题目区域 · 松开完成 · 按 Esc 或右键取消</div>
</body>
</html>`;

function matchSourceForDisplay(
  display: electron.Display,
  displayIndex: number,
  sources: electron.DesktopCapturerSource[]
): electron.DesktopCapturerSource | undefined {
  const validSources = sources.filter(s => !s.thumbnail.isEmpty());
  if (!validSources.length) return undefined;

  const byDisplayId = validSources.find(s => s.display_id && String(s.display_id) === String(display.id));
  if (byDisplayId) return byDisplayId;

  if (sources[displayIndex] && !sources[displayIndex].thumbnail.isEmpty()) {
    return sources[displayIndex];
  }

  const byScreenIndex = validSources.find(s => s.id.startsWith(`screen:${displayIndex}:`));
  if (byScreenIndex) return byScreenIndex;

  return validSources[0];
}

async function selectRegionAcrossDisplays(
  targets: Array<{ display: electron.Display; image: electron.NativeImage; isCursorDisplay: boolean }>
): Promise<{ image: electron.NativeImage; rect: SelectionRect } | null> {
  const windows: electron.BrowserWindow[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  try {
    const selectionRaces: Array<Promise<{ image: electron.NativeImage; rect: SelectionRect } | null>> = [];

    for (const target of targets) {
      const { bounds } = target.display;
      const win = new electron.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        show: false,
        frame: false,
        transparent: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreen: false,
        enableLargerThanScreen: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: '#000000',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      windows.push(win);
      win.setBounds(bounds);
      win.setAlwaysOnTop(true, 'screen-saver');

      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(OVERLAY_HTML));
      const dataUrl = target.image.toDataURL();
      await win.webContents.executeJavaScript(
        ` (async () => {
            const bg = document.getElementById('bg');
            bg.src = ${JSON.stringify(dataUrl)};
            if (bg.decode) { try { await bg.decode(); } catch {} }
          })()`,
        true
      );
      win.setBounds(bounds);

      const userChoice = (win.webContents.executeJavaScript(
        `new Promise(resolve => {
          const mask = document.getElementById('mask');
          const box = document.getElementById('box');
          const size = document.getElementById('size');
          let startX = 0, startY = 0, dragging = false;
          const cancel = () => resolve(null);
          window.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });
          window.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); });
          window.addEventListener('mousedown', e => {
            if (e.button === 2) { cancel(); return; }
            if (e.button !== 0) return;
            window.focus();
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            mask.style.display = 'none';
            box.style.display = 'block';
            box.style.left = startX + 'px';
            box.style.top = startY + 'px';
            box.style.width = '0px';
            box.style.height = '0px';
          });
          window.addEventListener('mousemove', e => {
            if (!dragging) return;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const w = Math.abs(e.clientX - startX);
            const h = Math.abs(e.clientY - startY);
            box.style.left = x + 'px';
            box.style.top = y + 'px';
            box.style.width = w + 'px';
            box.style.height = h + 'px';
            size.style.display = 'block';
            size.style.left = Math.min(window.innerWidth - 80, x + w + 6) + 'px';
            size.style.top = Math.min(window.innerHeight - 24, y + h + 6) + 'px';
            size.textContent = Math.round(w) + ' × ' + Math.round(h);
          });
          window.addEventListener('mouseup', e => {
            if (!dragging || e.button !== 0) return;
            dragging = false;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const width = Math.abs(e.clientX - startX);
            const height = Math.abs(e.clientY - startY);
            if (width < 10 || height < 10) {
              box.style.display = 'none';
              size.style.display = 'none';
              mask.style.display = 'block';
              return;
            }
            resolve({ x, y, width, height, vw: window.innerWidth, vh: window.innerHeight });
          });
        })`,
        true
      ) as Promise<SelectionRect | null>).then(rect => (rect ? { image: target.image, rect } : null));

      const closed = new Promise<null>(resolve => win.once('closed', () => {
        if (!settled) resolve(null);
      }));

      selectionRaces.push(userChoice, closed);
    }

    // Show all pre-decoded display overlays together without fullscreen transition flicker.
    let focusWin: electron.BrowserWindow | undefined;
    windows.forEach((win, index) => {
      if (targets[index]?.isCursorDisplay) focusWin = win;
      win.showInactive();
    });
    (focusWin || windows[0])?.show();
    (focusWin || windows[0])?.focus();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('选区截图超时')), 120000);
    });

    const chosen = await Promise.race([...selectionRaces, timeoutPromise]);
    settled = true;
    return chosen;
  } finally {
    settled = true;
    clearTimeout(timer);
    for (const win of windows) {
      if (!win.isDestroyed()) win.destroy();
    }
  }
}

async function captureScreenDesktop(mode: 'interactive' | 'fullscreen'): Promise<ScreenCaptureResult | null> {
  const cursor = electron.screen.getCursorScreenPoint?.() || { x: 0, y: 0 };
  const primary = electron.screen.getPrimaryDisplay();
  const displays = electron.screen.getAllDisplays?.()?.length ? electron.screen.getAllDisplays() : [primary];
  const cursorDisplay = electron.screen.getDisplayNearestPoint?.(cursor) || primary;

  let maxPhysicalWidth = 1;
  let maxPhysicalHeight = 1;
  for (const d of displays) {
    const sf = d.scaleFactor || 1;
    maxPhysicalWidth = Math.max(maxPhysicalWidth, Math.round(d.bounds.width * sf));
    maxPhysicalHeight = Math.max(maxPhysicalHeight, Math.round(d.bounds.height * sf));
  }

  let captureTimer: ReturnType<typeof setTimeout> | undefined;
  const sources = await Promise.race([
    electron.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxPhysicalWidth, height: maxPhysicalHeight }
    }),
    new Promise<never>((_, reject) => {
      captureTimer = setTimeout(() => reject(new Error('获取屏幕画面超时，请检查显示驱动状态')), 15000);
    })
  ]).finally(() => clearTimeout(captureTimer));

  if (!sources.length || sources.every(s => s.thumbnail.isEmpty())) {
    throw new Error('无法获取屏幕画面，请确认当前未处于锁屏或受保护安全桌面');
  }

  if (mode === 'fullscreen') {
    const idx = Math.max(0, displays.findIndex(d => d.id === cursorDisplay.id));
    const matched = matchSourceForDisplay(cursorDisplay, idx, sources);
    if (!matched || matched.thumbnail.isEmpty()) {
      throw new Error('无法获取当前显示器画面');
    }
    return validateCapturedPng(matched.thumbnail.toPNG());
  }

  const targets = displays
    .map((display, idx) => {
      const source = matchSourceForDisplay(display, idx, sources);
      return source ? { display, image: source.thumbnail, isCursorDisplay: display.id === cursorDisplay.id } : null;
    })
    .filter((item): item is { display: electron.Display; image: electron.NativeImage; isCursorDisplay: boolean } => item !== null);

  if (!targets.length) {
    throw new Error('无法获取显示器画面');
  }

  const chosen = await selectRegionAcrossDisplays(targets);
  if (!chosen) return null;

  const { image: fullImage, rect } = chosen;
  const imgSize = fullImage.getSize();
  const scaleX = imgSize.width / Math.max(1, rect.vw);
  const scaleY = imgSize.height / Math.max(1, rect.vh);
  const cropX = Math.max(0, Math.min(imgSize.width - 1, Math.round(rect.x * scaleX)));
  const cropY = Math.max(0, Math.min(imgSize.height - 1, Math.round(rect.y * scaleY)));
  const cropW = Math.max(1, Math.min(imgSize.width - cropX, Math.round(rect.width * scaleX)));
  const cropH = Math.max(1, Math.min(imgSize.height - cropY, Math.round(rect.height * scaleY)));

  const cropped = fullImage.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
  return validateCapturedPng(cropped.toPNG());
}

export async function captureScreen(mode: 'interactive' | 'fullscreen' = 'interactive'): Promise<ScreenCaptureResult | null> {
  if (process.platform === 'darwin') {
    return captureScreenDarwin(mode);
  }
  return captureScreenDesktop(mode);
}
