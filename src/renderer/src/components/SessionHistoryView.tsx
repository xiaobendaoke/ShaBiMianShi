import React, { useState, useEffect } from 'react';
import { Trash2, MessageSquare, ArrowRight } from 'lucide-react';
import { SessionRecord, TurnRecord } from '../../../main/types';
import { AnswerContent } from './AnswerContent';
import { Badge, EmptyState, PageHeader, Toolbar, button, cx } from './ui';

interface SessionHistoryViewProps {
  currentSession: SessionRecord | null;
  onSelectSession: (s: SessionRecord) => void;
  onRefreshSessions: () => void;
}

export const SessionHistoryView: React.FC<SessionHistoryViewProps> = ({
  currentSession,
  onSelectSession,
  onRefreshSessions
}) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const loadSessions = async () => {
    const list: SessionRecord[] = await (window as any).api.getSessions();
    setSessions(list);
    setSelectedSessionId(previous=>list.some(s=>s.id===previous)?previous:list[0]?.id||null);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    let active=true;
    setTurns([]);
    if (selectedSessionId) {
      (window as any).api.getTurns(selectedSessionId).then((t: TurnRecord[]) => {
        if(active)setTurns(t);
      });
    }
    return ()=>{active=false;};
  }, [selectedSessionId]);

  const handleDeleteSession = async (id: string) => {
    if (confirm('确认删除此会话记录？')) {
      await (window as any).api.deleteSession(id);
      await loadSessions();
      onRefreshSessions();
    }
  };

  const selected = sessions.find(s => s.id === selectedSessionId);

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden aurora">
      {/* Sessions */}
      <aside className="w-[264px] shrink-0 border-r border-separator flex flex-col min-h-0 glass">
        <Toolbar className="justify-between">
          <span className="text-[13px] font-semibold text-label">所有会话存档</span>
          <span className="text-[11px] text-label-3">{sessions.length} 个记录</span>
        </Toolbar>
        <div className="flex-1 overflow-y-auto p-2 space-y-px">
          {sessions.map(s => {
            const isSelected = selectedSessionId === s.id;
            return (
              <div key={s.id} className={cx('group relative rounded-lg transition-colors', isSelected ? 'bg-accent-soft' : 'hover:bg-fill')}>
                <button onClick={() => setSelectedSessionId(s.id)} className="w-full text-left pl-3 pr-9 py-2">
                  <div className={cx('truncate text-[13px] text-label', isSelected && 'font-medium')}>{s.title}</div>
                  <div className="mt-0.5 text-[11px] text-label-3 flex items-center gap-1.5">
                    <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                    {currentSession?.id === s.id && <span className="text-accent-text">· 当前</span>}
                  </div>
                </button>
                <button onClick={() => handleDeleteSession(s.id)} className={cx(button.icon, 'absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger')} title="删除会话">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Turns in this session */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Toolbar />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[780px] mx-auto px-10 pt-9 pb-14">
            <PageHeader title={selected?.title || '会话详情'} subtitle={`历史问答轮次与引用快照存档${turns.length ? ` · 共 ${turns.length} 题` : ''}`}>
              {selected && (
                <button onClick={() => onSelectSession(selected)} className={button.primary}>
                  <span>载入至当前面试辅导</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </PageHeader>

            {turns.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-separator">
                <EmptyState icon={<MessageSquare size={30} strokeWidth={1.25} />} title="此会话暂无问答记录" />
              </div>
            ) : (
              <div className="space-y-10">
                {turns.map((t, idx) => (
                  <article key={t.id} className="space-y-3">
                    <div className="flex items-center gap-2 text-[12px] text-label-3">
                      <span className="font-medium text-accent-text">#{idx + 1} 提问</span>
                      <span className="tabular-nums">{new Date(t.createdAt).toLocaleTimeString()}</span>
                      {t.status !== 'completed' && <Badge tone={t.status === 'error' ? 'danger' : 'neutral'}>{t.status === 'error' ? '生成失败' : t.status === 'cancelled' ? '已取消' : t.status}</Badge>}
                    </div>
                    <h2 className="text-[18px] leading-snug font-semibold text-label select-text">{t.question}</h2>
                    {t.answer ? <div className="select-text"><AnswerContent text={t.answer} /></div> : <p className="text-[13px] text-label-3">无回答内容</p>}
                    {t.citations.length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1.5">
                        {t.citations.map(c => (
                          <span key={c.id} title={c.snippet}><Badge tone="accent">资料{c.citationIndex} · {c.fileName} {c.page ? `p.${c.page}` : ''}</Badge></span>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
