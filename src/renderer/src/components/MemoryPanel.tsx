import React,{useEffect,useState} from 'react';
import type {SessionMemory} from '../../../main/types';
import {button, cx, field, textArea} from './ui';
export function MemoryPanel({sessionId}:{sessionId?:string}) {
  const [memory,setMemory]=useState<SessionMemory|null>(null),[project,setProject]=useState(''),[fact,setFact]=useState(''),[error,setError]=useState('');
  const api=(window as any).api;
  useEffect(()=>{let live=true;setMemory(null);setError('');if(sessionId)void api.getMemory(sessionId).then((m:SessionMemory)=>{if(live){setMemory(m);setProject(m.currentProject);}}).catch((e:any)=>{if(live)setError(e.message);});
    const off=api.onMemoryChanged((m:SessionMemory)=>{if(live&&m.sessionId===sessionId){setMemory(m);setProject(m.currentProject);}});return()=>{live=false;off();};},[sessionId]);
  const update=async(removeId?:string)=>{if(!memory)return;try{const next=await api.updateMemory(sessionId,{expectedRevision:memory.revision,currentProject:project,text:fact,removeId});setMemory(next);setFact('');setError('');}catch(e:any){setError(e.message);}};
  return <div className="space-y-2 text-[12px] text-label-2">
    <div className="flex items-center justify-between px-0.5"><span className="font-medium text-label">会话记忆</span><span className="text-label-3">{memory?.entries.length||0}项</span></div>
    <label className="block space-y-1"><span className="px-0.5">当前项目</span><input className={cx(field,'h-7 text-[12px]')} value={project} onChange={e=>setProject(e.target.value)} placeholder="项目名称；不同项目分别记录"/></label>
    <textarea className={cx(textArea,'text-[12px]')} rows={2} value={fact} onChange={e=>setFact(e.target.value)} placeholder="补充或纠正事实，例如：音频延迟降低的是30%，不是40%。"/>
    <div className="flex gap-1.5"><button className={cx(button.secondary,'h-7 px-2.5 text-[12px]')} onClick={()=>void update()}>保存项目 / 确认事实</button><button className={cx(button.plain,'h-7 px-2 text-[12px]')} onClick={()=>{if(memory)void api.resetMemory(sessionId,memory.revision).then(setMemory).catch((e:any)=>setError(e.message));}}>重置本场记忆</button></div>
    {!!memory?.entries.length&&<div className="max-h-48 overflow-auto rounded-lg bg-surface divide-y divide-separator">{memory.entries.map(e=><div key={e.id} className="px-2.5 py-2 space-y-0.5">
      <div className="flex items-center justify-between gap-2"><span className={e.confirmed?'text-success':'text-warning'}>{e.confirmed?'来源事实':'未确认'} · {e.project}</span><button className="text-label-3 hover:text-danger" onClick={()=>void update(e.id)}>移除</button></div>
      <p className="text-label select-text">{e.text}</p>
      <span className="text-[11px] text-label-3">{e.source.type} · {e.source.id.slice(0,50)}</span>
    </div>)}</div>}
    {error&&<p className="text-danger">{error}</p>}
  </div>;
}
