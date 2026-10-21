import React from 'react';
import { ShieldCheck, ShieldAlert, Sliders, Command, FileCheck2 } from 'lucide-react';
import { AnsweringStrategy, SessionRecord } from '../../../main/types';

interface SettingsViewProps {
  currentSession: SessionRecord | null;
  contentProtected: boolean;
  onToggleProtection: () => void;
  onUpdateSession: (updated: Partial<SessionRecord>) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentSession,
  contentProtected,
  onToggleProtection,
  onUpdateSession
}) => {
  const strategies: { id: AnsweringStrategy; title: string; desc: string }[] = [
    {
      id: 'docs_and_general',
      title: '资料 ＋ 通用知识 (默认推荐)',
      desc: '以候选人资料和技术文档为主。当资料未详细展开底层原理时，补充行业通用标准技术方案，并明确区分两者的来源。'
    },
    {
      id: 'experience_first',
      title: '个人经历优先',
      desc: '关于候选人经历、项目分工、性能优化与商业成果严格以简历与项目文档为准。严禁无中生有编造公司背景、职级与数字。'
    },
    {
      id: 'docs_only',
      title: '仅依据资料 (零幻觉)',
      desc: '严格依据所选知识库文档作答。若参考文档未提供相关信息，直接明确声明“资料中未包含此项”，严禁自由发挥或推测。'
    }
  ];

  const styles = [
    { id: 'standard', name: '标准模式', desc: '结构清晰，分条论述要点与方案' },
    { id: 'concise', name: '精简速记', desc: '提取核心关键词与架构短句，便于快速作答' },
    { id: 'detailed', name: '深度详述', desc: '包含完整技术背景、源码解析与边缘故障应对' },
    { id: 'algorithm', name: '算法题解', desc: '时空复杂度分析、思路伪代码与边界条件' },
    { id: 'system_design', name: '系统设计', desc: '容量估算、高可用选型、分库分表与降级方案' }
  ] as const;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-900 p-8 space-y-8">
      <div className="max-w-3xl space-y-6">
        <div>
          <h2 className="text-base font-semibold text-gray-100">面试辅导策略与应用配置</h2>
          <p className="text-xs text-gray-400 mt-1">
            配置知识库引用约束、防录屏隐私保护机制与快捷键设置
          </p>
        </div>

        {/* 1. Answering Strategy */}
        <div className="space-y-3">
          <label className="text-xs font-semibold text-gray-300 flex items-center space-x-2">
            <FileCheck2 size={16} className="text-emerald-400" />
            <span>AI 回答与知识库约束策略</span>
          </label>

          <div className="space-y-2">
            {strategies.map(s => {
              const isSelected = currentSession?.strategy === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => onUpdateSession({ strategy: s.id })}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-700/80 text-emerald-300'
                      : 'bg-gray-950 border-gray-800 text-gray-300 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-xs">{s.title}</span>
                    {isSelected && (
                      <span className="text-[10px] bg-emerald-900/60 text-emerald-400 px-2 py-0.5 rounded font-medium">
                        当前生效
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Prompt Style */}
        <div className="space-y-3 pt-4 border-t border-gray-800">
          <label className="text-xs font-semibold text-gray-300 flex items-center space-x-2">
            <Sliders size={16} className="text-emerald-400" />
            <span>回答风格与提示词预设</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            {styles.map(st => {
              const isSelected = currentSession?.promptStyle === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => onUpdateSession({ promptStyle: st.id })}
                  className={`text-left p-3 rounded-lg border text-xs transition-all ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-700 text-emerald-300'
                      : 'bg-gray-950 border-gray-800 text-gray-300 hover:border-gray-700'
                  }`}
                >
                  <div className="font-semibold mb-0.5">{st.name}</div>
                  <div className="text-[11px] text-gray-500 leading-normal">{st.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Privacy & Content Protection */}
        <div className="space-y-3 pt-4 border-t border-gray-800">
          <label className="text-xs font-semibold text-gray-300 flex items-center space-x-2">
            {contentProtected ? (
              <ShieldCheck size={16} className="text-emerald-400" />
            ) : (
              <ShieldAlert size={16} className="text-amber-400" />
            )}
            <span>macOS 窗口防窥与录屏保护</span>
          </label>

          <div className="p-4 bg-gray-950 border border-gray-800 rounded-xl flex items-center justify-between">
            <div className="space-y-1 pr-6">
              <div className="text-xs font-medium text-gray-200">
                开启 setContentProtection 保护
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                利用 macOS 原生 Window 属性阻止腾讯会议、钉钉、Zoom 等主流会议软件在屏幕共享时捕捉助手窗口。
              </p>
            </div>

            <button
              onClick={onToggleProtection}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                contentProtected
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
              }`}
            >
              {contentProtected ? '保护已启用' : '点击启用保护'}
            </button>
          </div>
        </div>

        {/* 4. Shortcuts */}
        <div className="space-y-3 pt-4 border-t border-gray-800">
          <label className="text-xs font-semibold text-gray-300 flex items-center space-x-2">
            <Command size={16} className="text-emerald-400" />
            <span>全局热键说明</span>
          </label>

          <div className="bg-gray-950 p-4 border border-gray-800 rounded-xl space-y-2 text-xs text-gray-400">
            <div className="flex items-center justify-between">
              <span>呼出 / 隐藏独立悬浮窗</span>
              <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700 text-gray-200 font-mono text-[11px]">
                Cmd + Shift + Space
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>切换悬浮窗鼠标穿透模式</span>
              <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700 text-gray-200 font-mono text-[11px]">
                Cmd + Shift + P
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>全屏截屏识题并作答</span>
              <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700 text-gray-200 font-mono text-[11px]">
                Cmd + Shift + S
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>选区截屏识题并作答</span>
              <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700 text-gray-200 font-mono text-[11px]">
                Cmd + Alt + X
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>快速发送当前问题</span>
              <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700 text-gray-200 font-mono text-[11px]">
                Enter
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
