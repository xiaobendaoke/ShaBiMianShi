import React, {useState} from 'react';
import {SquarePen, Pencil, Trash2, Search} from 'lucide-react';
import type {SessionRecord} from '../../../main/types';
import {button, cx, field} from './ui';

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

const dayLabel = (time: number) => {
  const date = new Date(time), today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000);
  return days === 0 ? date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : days === 1 ? '昨天' : date.toLocaleDateString();
};

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
  const visible=sessions.filter(s=>s.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="flex flex-col min-h-0 flex-1 px-2.5 pt-4 gap-2" aria-label="面试会话管理">
    <button disabled={busy} onClick={()=>edit('new')} title="新建面试会话"
      className={cx('flex items-center h-8 rounded-lg text-[13px] font-medium text-accent-text hover:bg-accent-soft transition-colors disabled:opacity-40', collapsed ? 'justify-center' : 'gap-2.5 px-2.5')}>
      <SquarePen size={16} strokeWidth={1.75}/>{!collapsed&&'新建面试'}
    </button>
    {editing && <form className="space-y-2 rounded-xl bg-elevated p-2.5 shadow-card animate-fade-up" onSubmit={e=>{e.preventDefault();const name=title.trim();if(!name)return;void run(async()=>{if(editing==='new')await onCreate(name);else await onRename(editing,name);setEditing(null);});}}>
      <div className="text-[11px] font-medium text-label-2 px-0.5">{editing==='new'?'新面试名称':'重命名'}</div>
      <input autoFocus aria-label={editing==='new'?'新会话名称':'重命名会话'} placeholder="公司 / 岗位 / 第几轮" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setEditing(null);}} className={field}/>
      <div className="flex justify-end gap-1.5"><button type="button" disabled={busy} onClick={()=>setEditing(null)} className={cx(button.plain,'h-7 text-[12px]')}>取消</button><button disabled={busy||!title.trim()} className={cx(button.primary,'h-7 px-3 text-[12px]')}>保存</button></div>
    </form>}
    {error&&<p role="alert" className="px-1 text-[12px] text-danger break-words">{error}</p>}
    {!collapsed&&<>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-label-3 pointer-events-none"/>
        <input aria-label="搜索面试会话" placeholder="搜索会话" value={query} onChange={e=>setQuery(e.target.value)} className={cx(field,'h-7 pl-7 text-[12px] bg-fill')}/>
      </div>
      <div className="px-2.5 pt-1 text-[11px] font-semibold text-label-3">最近</div>
      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1 pb-2 space-y-px">
        {visible.map(s=>{
          const active=currentId===s.id;
          return <div key={s.id} className={cx('group relative rounded-lg transition-colors', active?'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.04)]':'hover:bg-fill')}>
            <button disabled={busy} onClick={()=>void run(()=>onSelect(s))} title={s.title} aria-current={active?'page':undefined} className="w-full text-left pl-2.5 pr-14 py-1.5">
              <div className={cx('truncate text-[13px]', active?'text-label font-medium':'text-label')}>{s.title}</div>
              <div className="text-[11px] text-label-3">{dayLabel(s.updatedAt)}</div>
            </button>
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button disabled={busy} title={`重命名 ${s.title}`} onClick={()=>edit(s)} className={cx(button.icon,'h-6 w-6')}><Pencil size={12}/></button>
              <button disabled={busy} title={`删除 ${s.title}`} onClick={()=>{if(confirm(`删除“${s.title}”？该会话的问答、字幕和记忆将永久删除，其他会话和API配置不受影响。`))void run(()=>onDelete(s));}} className={cx(button.icon,'h-6 w-6 hover:text-danger')}><Trash2 size={12}/></button>
            </div>
          </div>;
        })}
        {!sessions.length&&<p className="px-2.5 py-2 text-[12px] text-label-3">新建一场面试开始使用</p>}
        {!!sessions.length&&!visible.length&&<p className="px-2.5 py-2 text-[12px] text-label-3">没有匹配的会话</p>}
      </div>
    </>}
  </section>;
}
