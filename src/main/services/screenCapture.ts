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

async function selectRegionOnDisplay(display: electron.Display, dataUrl: string): Promise<SelectionRect | null> {
  const { x, y, width, height } = display.bounds;
  const win = new electron.BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  const html = `<!DOCTYPE html>
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

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.show();
    win.focus();

    const selectionPromise = win.webContents.executeJavaScript(
      `new Promise(resolve => {
        const bg = document.getElementById('bg');
        bg.src = ${JSON.stringify(dataUrl)};
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
    ) as Promise<SelectionRect | null>;

    const closedPromise = new Promise<null>(resolve => win.once('closed', () => resolve(null)));
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('选区截图超时')), 120000);
    });

    return await Promise.race([selectionPromise, closedPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

async function captureScreenDesktop(mode: 'interactive' | 'fullscreen'): Promise<ScreenCaptureResult | null> {
  const cursor = electron.screen.getCursorScreenPoint?.() || { x: 0, y: 0 };
  const display = electron.screen.getDisplayNearestPoint?.(cursor) || electron.screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor || 1;
  const physicalWidth = Math.max(1, Math.round(display.bounds.width * scaleFactor));
  const physicalHeight = Math.max(1, Math.round(display.bounds.height * scaleFactor));

  const sources = await electron.desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: physicalWidth, height: physicalHeight }
  });
  const source = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法获取屏幕画面，请检查显示设置或屏幕录制权限');
  }

  const fullImage = source.thumbnail;
  if (mode === 'fullscreen') {
    return validateCapturedPng(fullImage.toPNG());
  }

  const rect = await selectRegionOnDisplay(display, fullImage.toDataURL());
  if (!rect) return null;

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
