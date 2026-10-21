import React from 'react';
import {
  MessageSquare,
  BookOpen,
  Settings,
  History,
  Cpu,
  Layers,
  ShieldCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

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
  const navItems = [
    { id: 'copilot', label: '面试辅助', icon: MessageSquare },
    { id: 'knowledge', label: '知识库', icon: BookOpen },
    { id: 'history', label: '会话记录', icon: History },
    { id: 'models', label: '模型与 API', icon: Cpu },
    { id: 'settings', label: '面试配置', icon: Settings }
  ] as const;

  return (
    <aside
      className={`${
        collapsed ? 'w-14' : 'w-52'
      } bg-gray-950 border-r border-gray-800 flex flex-col justify-between select-none transition-all duration-200 shrink-0`}
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Brand Header */}
        <div
          className={`border-b border-gray-800/80 flex items-center ${
            collapsed ? 'p-2.5 justify-center' : 'p-3.5 justify-between'
          }`}
        >
          <div className="flex items-center space-x-2.5 overflow-hidden">
            <div
              onClick={onToggleCollapse}
              className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-white text-xs tracking-wider shadow-md shadow-emerald-900/40 shrink-0 cursor-pointer hover:bg-emerald-500 transition-colors"
              title={collapsed ? '展开侧边栏' : '傻逼面试'}
            >
              SB
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="font-semibold text-sm text-gray-100 tracking-tight truncate">傻逼面试</h1>
              </div>
            )}
          </div>

          {!collapsed && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="text-gray-400 hover:text-gray-200 p-1 rounded-md hover:bg-gray-800 transition-colors"
              title="收起侧边栏"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center ${
                  collapsed ? 'justify-center px-0 py-2.5' : 'space-x-3 px-3 py-2.5'
                } rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900 border border-transparent'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-emerald-400' : 'text-gray-400'} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
        {children}
      </div>

      {/* Footer Controls */}
      <div className={`p-2 border-t border-gray-800/80 space-y-2 ${collapsed ? 'flex flex-col items-center' : ''}`}>
        {collapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
            title="展开侧边栏"
          >
            <ChevronRight size={16} />
          </button>
        )}

        <button
          onClick={onToggleFloating}
          className={`${
            collapsed ? 'w-9 h-9 p-0' : 'w-full px-3 py-2 space-x-2'
          } flex items-center justify-center bg-gray-900 hover:bg-gray-800 border border-gray-700/60 rounded-lg text-xs text-gray-300 transition-colors`}
          title="独立悬浮窗 (Cmd+Shift+Space)"
        >
          <Layers size={14} className="text-emerald-400 shrink-0" />
          {!collapsed && <span className="truncate">独立悬浮窗</span>}
        </button>

        <button
          onClick={onToggleProtection}
          className={`${
            collapsed ? 'w-9 h-9 p-0' : 'w-full px-2 py-1.5 space-x-1.5 text-[11px]'
          } flex items-center justify-center rounded-lg transition-colors ${
            contentProtected
              ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-400'
              : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-300'
          }`}
          title={contentProtected ? '防窥保护: 已开启' : '防窥保护: 未开启'}
        >
          {contentProtected ? (
            <>
              <ShieldCheck size={13} className="shrink-0" />
              {!collapsed && <span className="truncate">防窥保护: 已开启</span>}
            </>
          ) : (
            <>
              <ShieldAlert size={13} className="shrink-0" />
              {!collapsed && <span className="truncate">防窥保护: 未开启</span>}
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
