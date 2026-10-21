import React,{useEffect,useState} from 'react';
import type {SessionMemory} from '../../../main/types';
export function MemoryPanel({sessionId}:{sessionId?:string}) {
  const [memory,setMemory]=useState<SessionMemory|null>(null),[project,setProject]=useState(''),[fact,setFact]=useState(''),[error,setError]=useState('');
  const api=(window as any).api;
  useEffect(()=>{let live=true;setMemory(null);setError('');if(sessionId)void api.getMemory(sessionId).then((m:SessionMemory)=>{if(live){setMemory(m);setProject(m.currentProject);}}).catch((e:any)=>{if(live)setError(e.message);});
    const off=api.onMemoryChanged((m:SessionMemory)=>{if(live&&m.sessionId===sessionId){setMemory(m);setProject(m.currentProject);}});return()=>{live=false;off();};},[sessionId]);
  const update=async(removeId?:string)=>{if(!memory)return;try{const next=await api.updateMemory(sessionId,{expectedRevision:memory.revision,currentProject:project,text:fact,removeId});setMemory(next);setFact('');setError('');}catch(e:any){setError(e.message);}};
  return <details className="text-xs text-gray-400"><summary>会话记忆 · {memory?.entries.length||0}项</summary>
    <label>当前项目<input className="w-full p-1 my-1 bg-gray-800" value={project} onChange={e=>setProject(e.target.value)} placeholder="项目名称；不同项目分别记录"/></label>
    <textarea className="w-full p-1 bg-gray-800" value={fact} onChange={e=>setFact(e.target.value)} placeholder="补充或纠正事实，例如：音频延迟降低的是30%，不是40%。"/>
    <div className="flex gap-2"><button onClick={()=>void update()}>保存项目 / 确认事实</button><button onClick={()=>{if(memory)void api.resetMemory(sessionId,memory.revision).then(setMemory).catch((e:any)=>setError(e.message));}}>重置本场记忆</button></div>
    <div className="max-h-48 overflow-auto">{memory?.entries.map(e=><div key={e.id} className="border-b border-gray-800 py-1"><span className={e.confirmed?'text-emerald-400':'text-amber-300'}>{e.confirmed?'来源事实':'未确认'} · {e.project}</span><p>{e.text}</p><span>{e.source.type} · {e.source.id.slice(0,50)}</span><button className="ml-2" onClick={()=>void update(e.id)}>移除</button></div>)}</div>
    {error&&<p className="text-red-300">{error}</p>}
  </details>;
}
