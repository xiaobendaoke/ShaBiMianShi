import React,{useEffect,useState} from 'react';
import {BUILD_ID,runtimeMismatch,type RuntimeInfo} from '../../../shared/runtime';
export function RuntimeGate({children}:{children:React.ReactNode}) {
  const [runtime,setRuntime]=useState<RuntimeInfo|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;void(async()=>{
    try {
      const api=(window as any).api;
      if(!api?.getRuntimeInfo||!api?.getPreloadIdentity)throw Error('当前主进程或预加载仍是旧版本');
      const info=await Promise.race([api.getRuntimeInfo(),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('主进程握手超时')),8000))]);
      if(runtimeMismatch(info,api.getPreloadIdentity()))throw Error('主进程、预加载和界面版本不一致');
      if(live)setRuntime(info);
    }catch(e:any){if(live)setError(e.message||'无法确认运行版本');}
  })();return()=>{live=false;};},[]);
  if(!runtime)return <div className="titlebar-drag h-screen bg-canvas text-label flex items-center justify-center p-8">
    <div className="max-w-md text-center space-y-3">
      {!error&&<div className="mx-auto h-5 w-5 rounded-full border-2 border-fill-strong border-t-accent animate-spin"/>}
      <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{error?'需要完整重启傻逼面试':'正在确认运行版本…'}</h1>
      {error&&<>
        <p className="text-[13px] leading-relaxed text-label-2">{error}。请从应用菜单退出旧实例，再打开新包；仅关闭窗口或刷新界面不能更新主进程。</p>
        <p className="text-[13px] leading-relaxed text-label-2">现有API Key、模型配置和会话不会被此检查删除。版本一致前，截图与监听不会启动。</p>
        <details className="text-[11px] text-label-3"><summary>构建信息</summary>{BUILD_ID}</details>
      </>}
    </div>
  </div>;
  return <>{runtime.keyHealth.state==='locked'?<div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-xl rounded-xl bg-danger-soft backdrop-blur-xl text-danger px-4 py-2 text-[12px] shadow-pop" role="alert">{runtime.keyHealth.message}</div>:null}{children}<div className="fixed bottom-0.5 right-1.5 text-[9px] text-label-3/60 pointer-events-none">{runtime.buildId}</div></>;
}
