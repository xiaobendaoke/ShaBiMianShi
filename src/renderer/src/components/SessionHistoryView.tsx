import React, { useState, useEffect } from 'react';
import { History, Trash2, MessageSquare, Calendar, ChevronRight } from 'lucide-react';
import { SessionRecord, TurnRecord } from '../../../main/types';

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

  return (
    <div className="flex-1 flex overflow-hidden bg-gray-900">
      {/* Left: Sessions List */}
      <div className="w-72 border-r border-gray-800 bg-gray-950/70 p-4 flex flex-col justify-between shrink-0">
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-gray-300">所有会话存档</span>
            <span className="text-[11px] text-gray-500">{sessions.length} 个记录</span>
          </div>

          <div className="space-y-1">
            {sessions.map(s => {
              const isSelected = selectedSessionId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`p-3 rounded-lg text-xs cursor-pointer transition-all border flex items-center justify-between group ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                      : 'bg-gray-900/60 border-gray-800/80 text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                  }`}
                >
                  <div className="space-y-1 truncate pr-2">
                    <div className="font-semibold truncate">{s.title}</div>
                    <div className="text-[10px] text-gray-500 flex items-center space-x-1">
                      <Calendar size={11} />
                      <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(s.id);
                    }}
                    className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除会话"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: Turns in this session */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">
              {sessions.find(s => s.id === selectedSessionId)?.title || '会话详情'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">历史问答轮次与引用快照存档</p>
          </div>

          {selectedSessionId && (
            <button
              onClick={() => {
                const s = sessions.find(item => item.id === selectedSessionId);
                if (s) onSelectSession(s);
              }}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-medium transition-colors flex items-center space-x-1"
            >
              <span>载入至当前面试辅导</span>
              <ChevronRight size={13} />
            </button>
          )}
        </div>

        {turns.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-xs text-gray-500 space-y-2 border border-dashed border-gray-800 rounded-xl">
            <MessageSquare size={24} className="text-gray-600" />
            <div>此会话暂无问答记录</div>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl">
            {turns.map((t, idx) => (
              <div key={t.id} className="p-4 bg-gray-950 border border-gray-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-emerald-400">#{idx + 1} 提问</span>
                  <span className="text-[10px] text-gray-500">{new Date(t.createdAt).toLocaleTimeString()}</span>
                </div>

                <div className="text-xs font-medium text-gray-100 bg-gray-900 p-2.5 rounded-lg border border-gray-800">
                  {t.question}
                </div>

                <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap select-text">
                  {t.answer}
                </div>

                {t.citations.length > 0 && (
                  <div className="pt-2 border-t border-gray-900 flex flex-wrap gap-2">
                    {t.citations.map(c => (
                      <span
                        key={c.id}
                        className="px-2 py-0.5 bg-gray-900 border border-gray-800 rounded text-[10px] text-emerald-400"
                        title={c.snippet}
                      >
                        [资料{c.citationIndex}] {c.fileName} {c.page ? `p.${c.page}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
