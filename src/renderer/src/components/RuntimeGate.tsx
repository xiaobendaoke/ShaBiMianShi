import React,{useEffect,useState} from 'react';
import {BUILD_ID,runtimeMismatch,type RuntimeInfo} from '../../../shared/runtime';
export function RuntimeGate({children}:{children:React.ReactNode}) {
  const [runtime,setRuntime]=useState<RuntimeInfo|null>(null),[error,setError]=useState('');
  const loadRuntime=async()=>{
    const api=(window as any).api;
    if(!api?.getRuntimeInfo||!api?.getPreloadIdentity)throw Error('当前主进程或预加载仍是旧版本');
    const info=await Promise.race([api.getRuntimeInfo(),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('主进程握手超时')),8000))]);
    if(runtimeMismatch(info,api.getPreloadIdentity()))throw Error('主进程、预加载和界面版本不一致');
    return info;
  };
  useEffect(()=>{let live=true;void(async()=>{
    try {
      const info=await loadRuntime();
      if(live)setRuntime(info);
    }catch(e:any){if(live)setError(e.message||'无法确认运行版本');}
  })();return()=>{live=false;};},[]);
  const handleResetLockedVault=async()=>{
    if(!confirm('确认先备份原加密密钥文件，再重置为空密钥库吗？\n\n您的所有知识库、向量索引与面试历史记录均会完整保留，重置后只需在“模型与 API”中重新填写一次 API Key。'))return;
    try{
      await (window as any).api.resetLockedVault?.();
      const info=await loadRuntime();
      setRuntime(info);
    }catch(e:any){alert('重置密钥库失败：'+(e.message||String(e)));}
  };
  if(!runtime)return <div className="titlebar-drag h-screen bg-canvas text-label flex items-center justify-center p-8">
    <div className="max-w-md text-center space-y-3">
      {!error&&<div className="mx-auto h-5 w-5 rounded-full border-2 border-fill-strong border-t-accent animate-spin"/>}
      <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{error?'需要完整重启傻逼面试':'正在确认运行版本…'}</h1>
      {error&&<>
        <p className="text-[13px] leading-relaxed text-label-2">{error}。请完整退出正在运行的旧实例后再打开新包；仅刷新界面不能更新后台主进程。</p>
        <p className="text-[13px] leading-relaxed text-label-2">现有API Key、模型配置和会话不会被此检查删除。版本一致前，截图与监听不会启动。</p>
        <details className="text-[11px] text-label-3"><summary>构建信息</summary>{BUILD_ID}</details>
      </>}
    </div>
  </div>;
  return <>
    {runtime.keyHealth.state==='locked'?(
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-2xl rounded-xl bg-danger-soft backdrop-blur-xl text-danger px-4 py-2 text-[12px] shadow-pop flex items-center gap-3" role="alert">
        <span className="flex-1">{runtime.keyHealth.message}</span>
        <button type="button" onClick={()=>void handleResetLockedVault()} className="shrink-0 rounded-md bg-danger text-white px-2.5 py-1 text-[11px] font-medium hover:brightness-110">备份并重置密钥库</button>
      </div>
    ):null}
    {children}
    <div className="fixed bottom-0.5 right-1.5 text-[9px] text-label-3/60 pointer-events-none">{runtime.buildId}</div>
  </>;
}
