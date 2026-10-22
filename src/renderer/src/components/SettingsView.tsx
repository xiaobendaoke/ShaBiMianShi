import React from 'react';
import { Check } from 'lucide-react';
import { AnsweringStrategy, SessionRecord } from '../../../main/types';
import { Group, Kbd, PageHeader, Row, Switch, Toolbar, cx } from './ui';

interface SettingsViewProps {
  currentSession: SessionRecord | null;
  contentProtected: boolean;
  onToggleProtection: () => void;
  onUpdateSession: (updated: Partial<SessionRecord>) => void;
}

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

const shortcuts: Array<[string, string[]]> = [
  ['呼出 / 隐藏独立悬浮窗', ['⌘', '⇧', 'Space']],
  ['切换悬浮窗鼠标穿透模式', ['⌘', '⇧', 'P']],
  ['全屏截屏识题并作答', ['⌘', '⇧', 'S']],
  ['选区截屏识题并作答', ['⌘', '⌥', 'X']],
  ['开始 / 暂停 / 继续监听', ['⌘', '⇧', 'G']],
  ['立即回答语音问题', ['⌘', '⇧', '↩']],
  ['切换本人回答状态', ['⌘', '⇧', 'M']],
  ['上一题 / 下一题', ['⌘', '⌥', '← / →']],
  ['答案滚动', ['⌘', '↑ / ↓']],
  ['快速发送当前问题', ['Enter']]
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentSession,
  contentProtected,
  onToggleProtection,
  onUpdateSession
}) => {
  return (
    <div className="flex-1 min-w-0 flex flex-col aurora">
      <Toolbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-10 pt-9 pb-14 space-y-8">
          <PageHeader
            title="面试辅导策略与应用配置"
            subtitle={<>配置知识库引用约束、防录屏隐私保护机制与快捷键设置。{currentSession ? <>策略与风格作用于当前会话「{currentSession.title}」。</> : '请先新建一场面试。'}</>}
          />

          <Group title="AI 回答与知识库约束策略">
            {strategies.map(s => {
              const isSelected = currentSession?.strategy === s.id;
              return (
                <button key={s.id} role="radio" aria-checked={isSelected} disabled={!currentSession} onClick={() => onUpdateSession({ strategy: s.id })}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-fill transition-colors disabled:opacity-50">
                  <span className={cx('mt-0.5 h-[18px] w-[18px] rounded-full shrink-0 flex items-center justify-center', isSelected ? 'bg-accent text-white' : 'border-[1.5px] border-label-3')}>
                    {isSelected && <span className="h-[7px] w-[7px] rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-label">{s.title}{isSelected && <span className="text-[11px] font-normal text-accent-text">当前生效</span>}</span>
                    <span className="block mt-0.5 text-[12px] leading-relaxed text-label-2">{s.desc}</span>
                  </span>
                </button>
              );
            })}
          </Group>

          <section className="space-y-1.5">
            <h2 className="px-1 text-[13px] font-semibold text-label">回答风格与提示词预设</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {styles.map(st => {
                const isSelected = currentSession?.promptStyle === st.id;
                return (
                  <button key={st.id} disabled={!currentSession} onClick={() => onUpdateSession({ promptStyle: st.id })} aria-pressed={isSelected}
                    className={cx('relative text-left rounded-xl p-3.5 transition-all disabled:opacity-50', isSelected ? 'bg-surface ring-2 ring-accent shadow-card' : 'bg-surface shadow-card hover:-translate-y-0.5')}>
                    {isSelected && <span className="absolute top-3 right-3 h-4 w-4 rounded-full bg-accent text-white flex items-center justify-center"><Check size={10} strokeWidth={3} /></span>}
                    <div className="text-[13px] font-medium text-label">{st.name}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-label-2 pr-4">{st.desc}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <Group title="macOS 窗口防窥与录屏保护" footer="内容保护在不同录屏与会议软件中的效果需要自行验证，不保证始终不可见。">
            <Row label="开启 setContentProtection 保护" detail="利用 macOS 原生 Window 属性阻止腾讯会议、钉钉、Zoom 等主流会议软件在屏幕共享时捕捉助手窗口。">
              <span className={cx('text-[12px]', contentProtected ? 'text-success' : 'text-label-3')}>{contentProtected ? '保护已启用' : '未启用'}</span>
              <Switch checked={contentProtected} onChange={onToggleProtection} label={contentProtected ? '保护已启用' : '点击启用保护'} />
            </Row>
          </Group>

          <Group title="全局热键说明" footer="快捷键冲突时，面试辅助页会提示，也可以使用界面按钮。">
            {shortcuts.map(([label, keys]) => (
              <Row key={label} label={label} className="min-h-10">
                <span className="flex items-center gap-1">{keys.map(key => <Kbd key={key}>{key}</Kbd>)}</span>
              </Row>
            ))}
          </Group>
        </div>
      </div>
    </div>
  );
};
