import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import electron from 'electron';
import type { ImageAttachment } from '../types';
export type ScreenCaptureResult = Omit<ImageAttachment, 'id'>;
export async function captureScreen(mode: 'interactive' | 'fullscreen' = 'interactive'): Promise<ScreenCaptureResult | null> {
  if (process.platform !== 'darwin') throw new Error('当前选区功能仅支持macOS');
  if (electron.systemPreferences.getMediaAccessStatus('screen') === 'denied') throw new Error('屏幕录制权限未授权，请到系统设置→隐私与安全性→屏幕与系统音频录制中允许本应用');
  const file = path.join(os.tmpdir(), `interviewdog_capture_${crypto.randomUUID()}.png`);
  try {
    let failure: Error | null = null;
    let stderr = '';
    await new Promise<void>(resolve => execFile('/usr/sbin/screencapture', mode === 'interactive' ? ['-i', '-s', '-x', file] : ['-m', '-x', file], {timeout: 120000}, (error, _out, err) => {failure = error; stderr = err; resolve();}));
    if (!fs.existsSync(file)) {
      const failed=failure as {killed?:boolean;signal?:string;code?:number|string}|null;
      if (mode === 'interactive' && (!stderr.trim() || /cancel/i.test(stderr)) && !failed?.killed && !failed?.signal && (failed?.code===undefined||failed.code===1)) return null;
      throw new Error(stderr.trim() || '截图失败或超时，请检查屏幕录制权限');
    }
    const bytes = fs.readFileSync(file);
    if (bytes.length < 24 || bytes.subarray(1,4).toString() !== 'PNG') throw new Error('截图格式无效，请重新选区');
    const image = electron.nativeImage.createFromBuffer(bytes);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (image.isEmpty() || width < 20 || height < 20) throw new Error('选区过小，请包含完整题目');
    if (bytes.length > 16 * 1024 * 1024 || width > 8192 || height > 8192) throw new Error('截图超出大小限制，请分成多张选区截图');
    const pixels = image.resize({width: 64, height: 64}).toBitmap();
    let min=255,max=0; for(let i=0;i<pixels.length;i+=4) {const light=(pixels[i]+pixels[i+1]+pixels[i+2])/3;min=Math.min(min,light);max=Math.max(max,light);}
    if(max-min<2) throw new Error('截图为空白，请重新选择包含题目的区域');
    return {base64: bytes.toString('base64'), mimeType: 'image/png', width, height};
  } finally { fs.rmSync(file, {force: true}); }
}
