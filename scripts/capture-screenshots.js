import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const screenshotDir = path.join(rootDir, 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(rootDir, 'dist/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(rootDir, 'dist/renderer/index.html'));
  await new Promise(r => setTimeout(r, 1500));

  // 1. Capture main copilot view
  const img1 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(screenshotDir, 'copilot-main.png'), img1.toPNG());
  console.log('Saved screenshot: screenshots/copilot-main.png');

  // 2. Capture floating window
  const floatWin = new BrowserWindow({
    width: 480,
    height: 380,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(rootDir, 'dist/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await floatWin.loadFile(path.join(rootDir, 'dist/renderer/index.html'), { hash: '/floating' });
  await new Promise(r => setTimeout(r, 1200));
  const img2 = await floatWin.webContents.capturePage();
  fs.writeFileSync(path.join(screenshotDir, 'floating-window.png'), img2.toPNG());
  console.log('Saved screenshot: screenshots/floating-window.png');

  app.quit();
});
