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
  if(!runtime)return <div className="h-screen bg-gray-950 text-gray-200 flex items-center justify-center p-8"><div className="max-w-xl space-y-4"><h1 className="text-xl">{error?'需要完整重启傻逼面试':'正在确认运行版本…'}</h1>{error&&<><p>{error}。请从应用菜单退出旧实例，再打开新包；仅关闭窗口或刷新界面不能更新主进程。</p><p>现有API Key、模型配置和会话不会被此检查删除。版本一致前，截图与监听不会启动。</p><details className="text-xs text-gray-500"><summary>构建信息</summary>{BUILD_ID}</details></>}</div></div>;
  return <>{runtime.keyHealth.state==='locked'?<div className="bg-red-950 text-red-200 p-3 text-sm" role="alert">{runtime.keyHealth.message}</div>:null}{children}<div className="fixed bottom-0 right-1 text-[9px] text-gray-600 pointer-events-none">{runtime.buildId}</div></>;
}
