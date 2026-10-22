import React from 'react';
import {
  MessageSquare,
  BookOpen,
  Settings2,
  History,
  Cpu,
  Layers,
  ShieldCheck,
  Shield,
  PanelLeft
} from 'lucide-react';
import {cx} from './ui';

export type NavTab = 'copilot' | 'knowledge' | 'history' | 'models' | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onToggleFloating: () => void;
  contentProtected: boolean;
  onToggleProtection: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children?: React.ReactNode;
}

const navItems = [
  { id: 'copilot', label: '面试辅助', icon: MessageSquare },
  { id: 'knowledge', label: '知识库', icon: BookOpen },
  { id: 'history', label: '会话记录', icon: History },
  { id: 'models', label: '模型与 API', icon: Cpu },
  { id: 'settings', label: '面试配置', icon: Settings2 }
] as const;

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onToggleFloating,
  contentProtected,
  onToggleProtection,
  collapsed = false,
  onToggleCollapse,
  children
}) => {
  const row = (active: boolean) => cx(
    'w-full flex items-center h-8 rounded-lg text-[13px] transition-colors',
    collapsed ? 'justify-center' : 'gap-2.5 px-2.5',
    active ? 'bg-surface text-label font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.04)]' : 'text-label-2 hover:bg-fill hover:text-label'
  );
  return (
    <aside className={cx(collapsed ? 'w-[64px]' : 'w-[248px]', 'bg-sidebar border-r border-separator flex flex-col select-none transition-[width] duration-200 shrink-0')}>
      {/* Titlebar zone: the traffic lights sit here. */}
      <div className={cx('titlebar-drag h-[52px] shrink-0 flex items-center', collapsed ? 'justify-center pt-8' : 'justify-end px-3')}>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-label-2 hover:bg-fill hover:text-label" title={collapsed ? '展开侧边栏' : '收起侧边栏'}>
            <PanelLeft size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pt-1 pb-4 flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-[9px] bg-gradient-to-br from-[#0894ff] via-[#c959dd] to-[#ff9004] text-white flex items-center justify-center text-[11px] font-black tracking-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_6px_rgba(0,0,0,0.15)]">SB</div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold tracking-[-0.01em] text-label leading-tight">傻逼面试</div>
            <div className="text-[11px] text-label-3 leading-tight">Interview Copilot</div>
          </div>
        </div>
      )}

      <nav className={cx('px-2.5 space-y-0.5', collapsed && 'pt-6')}>
        {navItems.map(item => {
          const Icon = item.icon;
          const active = currentTab === item.id;
          return (
            <button key={item.id} onClick={() => onSelectTab(item.id)} title={collapsed ? item.label : undefined} aria-current={active ? 'true' : undefined} className={row(active)}>
              <Icon size={16} strokeWidth={1.75} className={active ? 'text-accent' : ''} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {children}

      <div className="px-2.5 py-2.5 border-t border-separator space-y-0.5">
        <button onClick={onToggleFloating} className={row(false)} title="独立悬浮窗 (Cmd+Shift+Space)">
          <Layers size={16} strokeWidth={1.75} />
          {!collapsed && <span className="truncate flex-1 text-left">独立悬浮窗</span>}
          {!collapsed && <span className="text-[11px] text-label-3">⇧⌘Space</span>}
        </button>
        <button onClick={onToggleProtection} className={row(false)} title={contentProtected ? '防窥保护: 已开启' : '防窥保护: 未开启'}>
          {contentProtected ? <ShieldCheck size={16} strokeWidth={1.75} className="text-success" /> : <Shield size={16} strokeWidth={1.75} />}
          {!collapsed && <span className="truncate flex-1 text-left">防窥保护</span>}
          {!collapsed && <span className={cx('text-[11px]', contentProtected ? 'text-success' : 'text-label-3')}>{contentProtected ? '已开启' : '未开启'}</span>}
        </button>
      </div>
    </aside>
  );
};
