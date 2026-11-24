import electron from 'electron';
import type { BrowserWindow } from 'electron';
const { screen, app, nativeTheme } = electron;
const BrowserWindowConstructor = electron.BrowserWindow;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendToWindow } from './sendToWindow';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWindowIcon(): string | undefined {
  if (process.platform === 'darwin') return undefined;
  const baseDir = process.env.INTERVIEWDOG_RESOURCE_DIR || app?.getAppPath?.() || path.resolve(__dirname, '../..');
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidate = path.join(baseDir, 'resources', iconName);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private floatingWindow: BrowserWindow | null = null;
  private contentProtection: boolean = false;
  private isClickThrough: boolean = false;
  private floatingOpacity: number = 0.92;

  constructor() {}

  private loadContent(window: BrowserWindow, floating = false) {
    const url = process.env.VITE_DEV_SERVER_URL;
    let retries = 0;
    const load = () => {
      if (window.isDestroyed()) return;
      const operation = url ? window.loadURL(url + (floating ? '#/floating' : ''))
        : window.loadFile(path.join(__dirname, '../renderer/index.html'), floating ? {hash:'/floating'} : {});
      void operation.catch(() => {
        if (!window.isDestroyed() && retries++ === 0) setTimeout(load, 500);
      });
    };
    // A network-service restart during launch can leave the first navigation at
    // about:blank without rejecting loadFile. Retry once, never reload a live interview.
    const watchdog = setTimeout(() => {
      if (!window.isDestroyed() && !window.webContents.getURL().startsWith('file:') && !url && retries++ === 0) load();
    }, 10000);
    window.once('closed', () => clearTimeout(watchdog));
    load();
  }

  public createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus();
      return this.mainWindow;
    }

    // The UI is white-only; keep native controls and menus light as well.
    if (nativeTheme) nativeTheme.themeSource = 'light';

    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';
    const icon = resolveWindowIcon();

    this.mainWindow = new BrowserWindowConstructor({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: '傻逼面试 - 知识库与面试辅助',
      ...(icon ? { icon } : {}),
      ...(isMac
        ? {
            // Unified toolbar on macOS: traffic lights inset into the white sidebar.
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 18, y: 18 }
          }
        : isWin
          ? {
              // Unified immersive toolbar on Windows: native caption buttons sit in the 52px header.
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: {
                color: '#ffffff',
                symbolColor: '#1d1d1f',
                height: 52
              },
              autoHideMenuBar: true
            }
          : {
              autoHideMenuBar: true
            }),
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    if (this.contentProtection) {
      this.mainWindow.setContentProtection(true);
    }

    this.loadContent(this.mainWindow);

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  public createFloatingWindow(): BrowserWindow {
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      this.floatingWindow.focus();
      return this.floatingWindow;
    }

    const isMac = process.platform === 'darwin';
    const icon = resolveWindowIcon();
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

    this.floatingWindow = new BrowserWindowConstructor({
      width: 480,
      height: 380,
      minWidth: 340,
      minHeight: 220,
      x: Math.max(20, screenWidth - 500),
      y: 100,
      frame: false,
      transparent: true,
      resizable: true,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Windows DWM paints a rectangular border around transparent windows when hasShadow is true;
      // on Windows the card renders its own soft CSS drop-shadow instead.
      hasShadow: isMac,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    this.floatingWindow.setAlwaysOnTop?.(true, 'screen-saver');
    if (isMac) {
      this.floatingWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    }

    if (this.contentProtection) {
      this.floatingWindow.setContentProtection(true);
    }

    if (this.isClickThrough) {
      this.floatingWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    this.loadContent(this.floatingWindow, true);

    this.floatingWindow.on('closed', () => {
      this.floatingWindow = null;
    });

    return this.floatingWindow;
  }

  public toggleFloatingWindow(): boolean {
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      if (this.floatingWindow.isVisible()) {
        this.floatingWindow.hide();
        return false;
      } else {
        this.floatingWindow.show();
        return true;
      }
    } else {
      this.createFloatingWindow();
      return true;
    }
  }

  public setOpacity(opacity: number) {
    this.floatingOpacity = Math.max(0.2, Math.min(1.0, opacity));
    // Per-pixel CSS opacity in FloatingWindowView handles transparent DirectComposition/CoreAnimation
    // surfaces uniformly without squaring opacity or triggering layered-window artifacts on Windows.
  }

  public getOpacity(): number {
    return this.floatingOpacity;
  }

  public setClickThrough(enable: boolean) {
    this.isClickThrough = enable;
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      this.floatingWindow.setIgnoreMouseEvents(enable, { forward: true });
      this.broadcast('window:click-through-changed', enable);
    }
  }

  public toggleClickThrough(): boolean {
    this.setClickThrough(!this.isClickThrough);
    return this.isClickThrough;
  }

  public getIsClickThrough(): boolean {
    return this.isClickThrough;
  }

  public setContentProtection(enable: boolean) {
    this.contentProtection = enable;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setContentProtection(enable);
    }
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      this.floatingWindow.setContentProtection(enable);
    }
  }

  public getContentProtection(): boolean {
    return this.contentProtection;
  }

  public broadcast(channel: string, ...args: any[]) {
    sendToWindow(this.mainWindow, channel, ...args);
    sendToWindow(this.floatingWindow, channel, ...args);
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  public getFloatingWindow(): BrowserWindow | null {
    return this.floatingWindow;
  }
}
