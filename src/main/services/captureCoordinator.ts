interface WindowLike { isDestroyed(): boolean; isVisible(): boolean; isFocused(): boolean; hide(): void; showInactive(): void; focus(): void; }
export class CaptureCoordinator {
  busy = false;
  constructor(private windows: () => WindowLike[], private changed: (busy: boolean) => void, private diagnostic: (stage:string)=>void = ()=>{}) {}
  async run<T>(capture: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('正在选区，请完成或取消当前截图');
    this.busy = true;
    const snapshots = this.windows().filter(w => !w.isDestroyed()).map(window => ({window, visible: window.isVisible(), focused: window.isFocused()}));
    try {
      this.changed(true); this.diagnostic('hiding');
      for (const s of snapshots) if (s.visible) s.window.hide();
      const deadline=Date.now()+2000;
      while(snapshots.some(s=>s.visible&&!s.window.isDestroyed()&&s.window.isVisible())) {
        if(Date.now()>deadline)throw Error('应用窗口未能隐藏，未启动选区，请完整重启后重试');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      this.diagnostic('hidden');
      await new Promise(resolve => setTimeout(resolve, 150));
      this.diagnostic('selecting');
      return await capture();
    } finally {
      this.diagnostic('restoring');
      try {
        for (const s of snapshots) {
          try {if (s.visible && !s.window.isDestroyed()) s.window.showInactive();} catch { /* Restore remaining windows even if one was closed concurrently. */ }
        }
        const focused = snapshots.find(s => s.visible && s.focused && !s.window.isDestroyed());
        try { focused?.window.focus(); } catch {}
      } finally { this.busy = false; this.changed(false); this.diagnostic('restored'); }
    }
  }
}
