import React, {useState} from 'react';
import {Plus, Pencil, Trash2, MessageSquare} from 'lucide-react';
import type {SessionRecord} from '../../../main/types';

interface Props {
  sessions: SessionRecord[];
  currentId?: string;
  onSelect: (session: SessionRecord) => Promise<void>;
  onCreate: (title: string) => Promise<void>;
  onRename: (session: SessionRecord, title: string) => Promise<void>;
  onDelete: (session: SessionRecord) => Promise<void>;
  collapsed: boolean;
  onExpand: () => void;
}

export function SessionList({sessions,currentId,onSelect,onCreate,onRename,onDelete,collapsed,onExpand}: Props) {
  const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<SessionRecord | 'new' | null>(null);
  const [title,setTitle]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const run=async(action:()=>Promise<void>)=>{
    if(busy)return;
    setBusy(true);setError('');
    try{await action();}catch(e:any){setError(e.message || '会话操作失败');}finally{setBusy(false);}
  };
  const edit=(session:SessionRecord|'new')=>{if(collapsed)onExpand();setEditing(session);setTitle(session==='new'?'':session.title);setError('');};
  return <section className="flex flex-col min-h-0 flex-1 border-t border-gray-800 p-2 gap-2" aria-label="面试会话管理">
    <button disabled={busy} onClick={()=>edit('new')} title="新建面试会话" className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600/20 text-emerald-300 p-2 text-xs disabled:opacity-50">
      <Plus size={16}/>{!collapsed&&'新建面试'}
    </button>
    {editing && <form className="space-y-2 text-xs" onSubmit={e=>{e.preventDefault();const name=title.trim();if(!name)return;void run(async()=>{if(editing==='new')await onCreate(name);else await onRename(editing,name);setEditing(null);});}}>
      <input autoFocus aria-label={editing==='new'?'新会话名称':'重命名会话'} placeholder="公司 / 岗位 / 第几轮" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} className="w-full min-w-0 rounded border border-gray-700 bg-gray-900 p-2"/>
      <div className="flex gap-2"><button disabled={busy||!title.trim()} className="text-emerald-300 disabled:opacity-50">保存</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>取消</button></div>
    </form>}
    {error&&<p role="alert" className="text-xs text-red-300 break-words">{error}</p>}
    {!collapsed&&<>
      <input aria-label="搜索面试会话" placeholder="搜索会话…" value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded bg-gray-900 border border-gray-800 p-2 text-xs"/>
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
        {sessions.filter(s=>s.title.toLowerCase().includes(query.trim().toLowerCase())).map(s=><div key={s.id} className={`group rounded-lg ${currentId===s.id?'bg-emerald-950/70 text-emerald-300':'text-gray-400 hover:bg-gray-900'}`}>
          <button disabled={busy} onClick={()=>void run(()=>onSelect(s))} title={s.title} aria-current={currentId===s.id?'page':undefined} className="w-full text-left p-2 text-xs flex items-center gap-2"><MessageSquare size={13} className="shrink-0"/><span className="truncate">{s.title}</span></button>
          <div className="flex justify-between items-center px-2 pb-1 text-[10px] text-gray-500"><span>{new Date(s.updatedAt).toLocaleDateString()}</span><div className="flex gap-2"><button disabled={busy} title={`重命名 ${s.title}`} onClick={()=>edit(s)}><Pencil size={12}/></button><button disabled={busy} title={`删除 ${s.title}`} onClick={()=>{if(confirm(`删除“${s.title}”？该会话的问答、字幕和记忆将永久删除，其他会话和API配置不受影响。`))void run(()=>onDelete(s));}}><Trash2 size={12}/></button></div></div>
        </div>)}
        {!sessions.length&&<p className="p-2 text-xs text-gray-500">新建一场面试开始使用</p>}
      </div>
    </>}
  </section>;
}
