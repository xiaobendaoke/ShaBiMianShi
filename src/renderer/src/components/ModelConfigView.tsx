import React, { useState, useEffect } from 'react';
import {
  Key,
  Globe,
  Cpu,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Server,
  Zap,
  RefreshCw,
  Sparkles,
  Eye,
  EyeOff,
  Copy,
  Check,
  MessageSquare,
  Database,
  Mic,
  Save,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import { ProviderRole, RoleModelConfig } from '../../../main/types';

type ConfigRole = Exclude<ProviderRole, 'vision'>;
const CONFIG_ROLES: ConfigRole[] = ['chat', 'asr', 'embed'];

interface RoleState {
  role: ProviderRole;
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  newKey: string;
  showKey: boolean;
  timeoutMs: number;
  testStatus: { testing: boolean; ok?: boolean; message?: string; latencyMs?: number };
  saving: boolean;
}

const ROLE_METADATA: Record<ConfigRole, {
  title: string;
  tag: string;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  borderColor: string;
  accentBg: string;
  presets: Array<{ label: string; baseUrl: string; model: string }>;
}> = {
  chat: {
    title: '默认问答模型（文字 / 图片 / 代码）',
    tag: 'Chat',
    subtitle: '请配置支持图片输入的多模态模型，统一处理文字问答、截图解题和代码',
    icon: MessageSquare,
    color: 'text-emerald-400',
    borderColor: 'border-emerald-500/30 hover:border-emerald-500/50',
    accentBg: 'bg-emerald-950/30',
    presets: [
      { label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
      { label: 'Gemini (Google)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash' },
      { label: '硅基流动 (DeepSeek-V3)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
      { label: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      { label: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', model: 'deepseek-r1:8b' }
    ]
  },
  embed: {
    title: '向量嵌入模型',
    tag: 'Embedding',
    subtitle: '负责将文档分片与搜索提问转化为高维向量，用于语义混合召回',
    icon: Database,
    color: 'text-cyan-400',
    borderColor: 'border-cyan-500/30 hover:border-cyan-500/50',
    accentBg: 'bg-cyan-950/30',
    presets: [
      { label: '硅基流动 (BGE-M3 推荐)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
      { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
      { label: 'Gemini 官方', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'text-embedding-004' },
      { label: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3' },
      { label: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', model: 'nomic-embed-text' }
    ]
  },
  asr: {
    title: '语音转写模型',
    tag: 'ASR',
    subtitle: '持续收音，自动分段上传并返回文本；不是逐字流式字幕',
    icon: Mic,
    color: 'text-amber-400',
    borderColor: 'border-amber-500/30 hover:border-amber-500/50',
    accentBg: 'bg-amber-950/30',
    presets: [
      { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
      { label: 'Groq 高速 Whisper', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' },
      { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall' }
    ]
  }
};

export const ModelConfigView: React.FC = () => {
  const [roleStates, setRoleStates] = useState<Record<ConfigRole, RoleState>>({
    chat: { role: 'chat', name: '文本对话服务', baseUrl: '', model: '', hasKey: false, newKey: '', showKey: false, timeoutMs: 30000, testStatus: { testing: false }, saving: false },
    embed: { role: 'embed', name: '向量嵌入服务', baseUrl: '', model: '', hasKey: false, newKey: '', showKey: false, timeoutMs: 30000, testStatus: { testing: false }, saving: false },
    asr: { role: 'asr', name: '语音转写服务', baseUrl: '', model: '', hasKey: false, newKey: '', showKey: false, timeoutMs: 30000, testStatus: { testing: false }, saving: false }
  });

  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [mockRunning, setMockRunning] = useState(false);
  const [rebuildingEmbeddings, setRebuildingEmbeddings] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const loadRoleConfigs = async () => {
    try {
      setLoading(true);
      const configs: Record<ProviderRole, RoleModelConfig> = await (window as any).api.getRoleConfigs();
      setRoleStates(prev => {
        const next = { ...prev };
        for (const role of CONFIG_ROLES) {
          if (configs[role]) {
            next[role] = {
              ...next[role],
              name: configs[role].name,
              newKey: '',
              baseUrl: configs[role].baseUrl,
              model: configs[role].model,
              hasKey: configs[role].hasKey,
              timeoutMs: configs[role].timeoutMs
            };
          }
        }
        return next;
      });
    } catch (err) {
      console.error('加载模型配置失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoleConfigs();
  }, []);

  const handleFieldChange = (role: ConfigRole, field: keyof RoleState, value: any) => {
    setRoleStates(prev => ({
      ...prev,
      [role]: { ...prev[role], [field]: value }
    }));
  };

  const handleApplyPreset = (role: ConfigRole, preset: { baseUrl: string; model: string }) => {
    setRoleStates(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        baseUrl: preset.baseUrl,
        model: preset.model,
        testStatus: { testing: false }
      }
    }));
  };

  const handleSaveRole = async (role: ConfigRole) => {
    const s = roleStates[role];
    handleFieldChange(role, 'saving', true);
    try {
      await (window as any).api.saveRoleConfig({
        role,
        baseUrl: s.baseUrl,
        model: s.model,
        key: s.newKey.trim() || undefined,
        timeoutMs: s.timeoutMs
      });
      handleFieldChange(role, 'hasKey', s.newKey.trim() ? true : s.hasKey);
      handleFieldChange(role, 'newKey', '');
      handleFieldChange(role, 'saving', false);
      setSyncToast(`${ROLE_METADATA[role].title} 配置已保存成功！`);
      setTimeout(() => setSyncToast(null), 3000);
    } catch (err: any) {
      handleFieldChange(role, 'saving', false);
      alert(`保存失败: ${err.message}`);
    }
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    try {
      const roles = CONFIG_ROLES;
      for (const r of roles) {
        const s = roleStates[r];
        await (window as any).api.saveRoleConfig({
          role: r,
          baseUrl: s.baseUrl,
          model: s.model,
          key: s.newKey.trim() || undefined,
          timeoutMs: s.timeoutMs
        });
      }
      await loadRoleConfigs();
      setSyncToast('模型配置已保存！');
      setTimeout(() => setSyncToast(null), 3500);
    } catch (err: any) {
      alert(`批量保存失败: ${err.message}`);
    } finally {
      setSavingAll(false);
    }
  };

  const handleSyncToAll = async (sourceRole: ConfigRole) => {
    const source = roleStates[sourceRole];
    if (!source.baseUrl) {
      alert('请先填写当前模型的 Base URL');
      return;
    }
    const confirmSync = confirm(
      `确认将 [${ROLE_METADATA[sourceRole].title}] 的 Base URL 与 API 密钥同步覆盖至其他 2 个模型能力？\n（各模型原有的推荐模型标识将被保留）`
    );
    if (!confirmSync) return;

    try {
      // If user typed a new key in source, save it first
      if (source.newKey.trim()) {
        await (window as any).api.saveRoleConfig({
          role: sourceRole,
          baseUrl: source.baseUrl,
          model: source.model,
          key: source.newKey.trim()
        });
      }
      await (window as any).api.syncRoleConfig(sourceRole);
      await loadRoleConfigs();
      setSyncToast(`已成功将 [${ROLE_METADATA[sourceRole].tag}] 的接口地址与密钥同步给其他全部 2 个模型！`);
      setTimeout(() => setSyncToast(null), 3500);
    } catch (err: any) {
      alert(`同步失败: ${err.message}`);
    }
  };

  const handleTestRole = async (role: ConfigRole, testAs: ProviderRole = role) => {
    const s = roleStates[role];
    if (!s.baseUrl) {
      alert('请先填写 Base URL');
      return;
    }
    handleFieldChange(role, 'testStatus', { testing: true });
    try {
      const res = await (window as any).api.testRoleConnection({
        role: testAs,
        baseUrl: s.baseUrl,
        model: s.model,
        key: s.newKey.trim() || undefined,
        timeoutMs: s.timeoutMs
      });
      handleFieldChange(role, 'testStatus', {
        testing: false,
        ok: res.ok,
        message: res.message,
        latencyMs: res.latencyMs
      });
    } catch (err: any) {
      handleFieldChange(role, 'testStatus', {
        testing: false,
        ok: false,
        message: err.message
      });
    }
  };

  const handleRebuildEmbeddings = async () => {
    const ok = confirm('确认使用当前配置的向量嵌入模型重新为全库文档生成语义向量？\n如果文档数量较多可能需要耗费一定 Token 与时间。');
    if (!ok) return;

    setRebuildingEmbeddings(true);
    try {
      const res = await (window as any).api.rebuildEmbeddings();
      alert(`语义向量重建完成！共处理 ${res.processed} 个分片，成功生成 ${res.succeeded} 条向量。`);
    } catch (err: any) {
      alert(`向量重建失败: ${err.message}`);
    } finally {
      setRebuildingEmbeddings(false);
    }
  };

  const handleToggleMock = async () => {
    const next = !mockRunning;
    const res = await (window as any).api.toggleMockServer(next);
    setMockRunning(res);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-gray-900 text-gray-100 p-6 space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-gray-800 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-bold text-gray-100">问答模型与语音服务</h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 rounded-full">
              文字与图片共用多模态模型
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            只需配置一个支持图片输入的多模态问答模型；ASR与向量服务独立配置。
          </p>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          {/* Mock Server toggle */}
          <div className="flex items-center space-x-2 px-3 py-1.5 bg-gray-950/80 border border-gray-800 rounded-lg text-xs">
            <Server size={14} className={mockRunning ? 'text-emerald-400' : 'text-gray-500'} />
            <span className="text-gray-400">离线模拟服务 (52140):</span>
            <button onClick={handleToggleMock} className="text-gray-400 hover:text-gray-200">
              {mockRunning ? <ToggleRight size={20} className="text-emerald-400" /> : <ToggleLeft size={20} />}
            </button>
          </div>

          <button
            onClick={handleSaveAll}
            disabled={savingAll || loading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 shadow-md shadow-emerald-950/30 disabled:opacity-50"
          >
            <Save size={14} />
            <span>{savingAll ? '正在保存全部...' : '全部保存'}</span>
          </button>
        </div>
      </div>

      {/* Sync Toast Feedback Banner */}
      {syncToast && (
        <div className="bg-emerald-950/80 border border-emerald-700 text-emerald-300 px-4 py-2.5 rounded-lg text-xs flex items-center justify-between shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center space-x-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>{syncToast}</span>
          </div>
          <button onClick={() => setSyncToast(null)} className="text-emerald-400 hover:text-emerald-200 text-xs ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Quick sync tip banner */}
      <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg text-xs flex items-center justify-between text-gray-400">
        <div className="flex items-center space-x-2">
          <Sparkles size={14} className="text-amber-400 shrink-0" />
          <span>
            <strong className="text-gray-200">全功能中转站用户提示：</strong>
            如果您使用 OpenAI 官方或一体化 API 聚合转发平台，可在任意卡片中填好后点击「⚡ 同步当前 URL & Key 至全部模型」，一键免除重复粘贴。
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {CONFIG_ROLES.map(rawRole => {
          const role = rawRole;
          const meta = ROLE_METADATA[role];
          const state = roleStates[role];
          const Icon = meta.icon;

          return (
            <div
              key={role}
              className={`bg-gray-950/80 border ${meta.borderColor} rounded-xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-sm`}
            >
              {/* Card Header */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className={`p-2 rounded-lg ${meta.accentBg} ${meta.color}`}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-sm font-bold text-gray-100">{meta.title}</h2>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${meta.accentBg} ${meta.color}`}>
                          {meta.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{meta.subtitle}</p>
                    </div>
                  </div>

                  {/* Keychain status pill */}
                  <div className="flex items-center space-x-1 shrink-0">
                    {state.hasKey ? (
                      <span className="flex items-center space-x-1 text-[11px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/80 px-2 py-0.5 rounded-full font-medium" title="密钥由系统加密存储保护">
                        <ShieldCheck size={12} />
                        <span>已配置密钥</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-500 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded-full">
                        未设置 Key
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Presets Pills */}
                <div className="pt-1 flex items-center space-x-1.5 flex-wrap gap-y-1">
                  <span className="text-[10px] text-gray-500 font-medium">快捷填入:</span>
                  {meta.presets.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyPreset(role, preset)}
                      className="px-2 py-0.5 text-[10px] bg-gray-900 hover:bg-gray-800 border border-gray-700/80 text-gray-300 hover:text-white rounded transition-colors"
                      title={`填入地址: ${preset.baseUrl}\n推荐模型: ${preset.model}`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Form Inputs */}
              <div className="space-y-3 text-xs pt-1">
                {/* Base URL Input */}
                <div>
                  <label className="block text-gray-400 font-medium mb-1">
                    接口地址 (Base URL)
                  </label>
                  <div className="relative">
                    <Globe size={13} className="absolute left-3 top-2.5 text-gray-500" />
                    <input
                      type="text"
                      value={state.baseUrl}
                      onChange={e => handleFieldChange(role, 'baseUrl', e.target.value)}
                      placeholder={role === 'embed' ? 'https://api.siliconflow.cn/v1' : 'https://api.deepseek.com/v1'}
                      className="w-full bg-gray-900/90 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-gray-100 font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                {/* API Key Input */}
                <div>
                  <label className="block text-gray-400 font-medium mb-1 flex items-center justify-between">
                    <span>API 密钥（本地加密保存）</span>
                    <span className="text-[10px] text-gray-500">
                      {state.hasKey ? '留空保持现有密钥' : '需要配置'}
                    </span>
                  </label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-2.5 text-gray-500" />
                    <input
                      type={state.showKey ? 'text' : 'password'}
                      value={state.newKey}
                      onChange={e => handleFieldChange(role, 'newKey', e.target.value)}
                      placeholder={state.hasKey ? '•••••••••••••••• (已保存，输入新 Key 覆盖)' : 'sk-...'}
                      className="w-full bg-gray-900/90 border border-gray-700 rounded-lg pl-9 pr-9 py-1.5 text-gray-100 font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => handleFieldChange(role, 'showKey', !state.showKey)}
                      className="absolute right-2.5 top-2 text-gray-500 hover:text-gray-300"
                      title={state.showKey ? '隐藏密钥' : '显示密钥'}
                    >
                      {state.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Model Identifier Input */}
                <div>
                  <label className="block text-gray-400 font-medium mb-1">
                    模型标识 (Model Name)
                  </label>
                  <div className="relative">
                    <Cpu size={13} className="absolute left-3 top-2.5 text-gray-500" />
                    <input
                      type="text"
                      value={state.model}
                      onChange={e => handleFieldChange(role, 'model', e.target.value)}
                      placeholder={role === 'embed' ? 'BAAI/bge-m3' : 'deepseek-chat'}
                      className="w-full bg-gray-900/90 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-gray-100 font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

              <label className="text-xs text-gray-400">请求超时（秒） <input className="w-20 bg-gray-800 p-1" type="number" min="5" max="300" value={state.timeoutMs/1000} onChange={e=>handleFieldChange(role,'timeoutMs',Math.max(5000,Math.min(300000,Number(e.target.value)*1000)))}/></label>
              {/* Card Footer / Actions */}
              <div className="pt-2 border-t border-gray-800/80 flex flex-col space-y-2">
                {/* Test Feedback Display if available */}
                {state.testStatus.message && (
                  <div className={`flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded bg-gray-900 border ${state.testStatus.ok ? 'border-emerald-800 text-emerald-300' : 'border-red-800 text-red-300'}`}>
                    {state.testStatus.ok ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" /> : <AlertCircle size={13} className="text-red-400 shrink-0" />}
                    <span className="truncate">
                      {state.testStatus.message} {state.testStatus.latencyMs ? `(${state.testStatus.latencyMs}ms)` : ''}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-1.5">
                    {/* Test button */}
                    <button
                      type="button"
                      onClick={() => handleTestRole(role)}
                      disabled={state.testStatus.testing}
                      className="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center space-x-1"
                      title={role === 'embed' ? '发送测试向量请求至 /embeddings' : '发送连通性探测请求'}
                    >
                      <Zap size={12} className="text-amber-400" />
                      <span>{state.testStatus.testing ? '验证中…' : role === 'asr' ? '测试真实音频' : '测试服务'}</span>
                    </button>

                    {role === 'chat' && <button type="button" disabled={state.testStatus.testing} className="text-xs text-purple-300" onClick={()=>void handleTestRole('chat','vision')}>测试图片能力</button>}
                    {/* Sync to all button */}
                    <button
                      type="button"
                      onClick={() => handleSyncToAll(role)}
                      className="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-400 hover:text-cyan-300 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1"
                      title="将当前卡片的 Base URL 和 API Key 快速应用至其他 2 个模型"
                    >
                      <Copy size={12} />
                      <span className="hidden sm:inline">同步到全部</span>
                    </button>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {/* If role is embed: extra rebuild button */}
                    {role === 'embed' && (
                      <button
                        type="button"
                        onClick={handleRebuildEmbeddings}
                        disabled={rebuildingEmbeddings}
                        className="px-2.5 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800/80 text-cyan-300 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1"
                        title="使用当前向量嵌入模型重新为全部文档生成语义向量"
                      >
                        <RefreshCw size={12} className={rebuildingEmbeddings ? 'animate-spin' : ''} />
                        <span>{rebuildingEmbeddings ? '重建中...' : '重建全库向量'}</span>
                      </button>
                    )}

                    {/* Save single role button */}
                    <button
                      type="button"
                      onClick={() => handleSaveRole(role)}
                      disabled={state.saving}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1"
                    >
                      <Save size={12} />
                      <span>{state.saving ? '保存中...' : '保存'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
