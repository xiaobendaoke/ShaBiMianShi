import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Server,
  Zap,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  MessageSquare,
  Database,
  Mic,
  Save,
  ShieldCheck,
  Image as ImageIcon,
  X
} from 'lucide-react';
import { ProviderRole, RoleModelConfig } from '../../../main/types';
import { Badge, Group, Notice, PageHeader, Row, Switch, Toolbar, button, cx, field, fieldBox, selectField } from './ui';

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
  tile: string;
  presets: Array<{ label: string; baseUrl: string; model: string }>;
}> = {
  chat: {
    title: '默认问答模型（文字 / 图片 / 代码）',
    tag: 'Chat',
    subtitle: '请配置支持图片输入的多模态模型，统一处理文字问答、截图解题和代码',
    icon: MessageSquare,
    tile: 'from-[#5ac8fa] to-[#0071e3]',
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
    tile: 'from-[#64d2ff] to-[#30b0c7]',
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
    tile: 'from-[#ffb340] to-[#ff9500]',
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

  const inputRowField = cx(field, 'h-7 font-mono text-[12px] max-w-[360px]');

  return (
    <div className="flex-1 min-w-0 flex flex-col aurora">
      <Toolbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-10 pt-9 pb-14 space-y-8">
          <PageHeader title="问答模型与语音服务" subtitle="只需配置一个支持图片输入的多模态问答模型；ASR与向量服务独立配置。">
            <button onClick={handleSaveAll} disabled={savingAll || loading} className={button.primary}>
              <Save size={14} />
              <span>{savingAll ? '正在保存全部...' : '全部保存'}</span>
            </button>
          </PageHeader>

          {syncToast && (
            <div className="-mt-4">
              <Notice tone="success" action={<button onClick={() => setSyncToast(null)} className={cx(button.icon, 'h-5 w-5 text-success')} title="关闭"><X size={12} /></button>}>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} />{syncToast}</span>
              </Notice>
            </div>
          )}

          <Group footer={<>使用 OpenAI 官方或一体化 API 聚合转发平台时，可在任意一项填好后点击「同步到全部」，免除重复粘贴。只有服务商确实同时提供这些能力时才使用。</>}>
            <Row label="离线模拟服务" detail="在本机 52140 端口启动模拟接口，用于不花钱地演示流程">
              <span className="text-[12px] text-label-3 inline-flex items-center gap-1"><Server size={12} />{mockRunning ? '运行中' : '已停止'}</span>
              <Switch checked={mockRunning} onChange={() => void handleToggleMock()} label="离线模拟服务 (52140)" />
            </Row>
          </Group>

          {CONFIG_ROLES.map(role => {
            const meta = ROLE_METADATA[role];
            const state = roleStates[role];
            const Icon = meta.icon;
            return (
              <section key={role} className="space-y-2">
                <div className="flex items-center gap-3 px-1">
                  <div className={cx('h-8 w-8 rounded-[9px] bg-gradient-to-b text-white flex items-center justify-center shrink-0', meta.tile)}>
                    <Icon size={16} strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-label">{meta.title}</h2>
                      <Badge>{meta.tag}</Badge>
                    </div>
                    <p className="text-[12px] text-label-2">{meta.subtitle}</p>
                  </div>
                  {state.hasKey
                    ? <Badge tone="success" title="密钥由系统加密存储保护"><ShieldCheck size={11} />已配置密钥</Badge>
                    : <Badge>未设置 Key</Badge>}
                </div>

                <div className="rounded-2xl bg-surface shadow-card divide-y divide-separator">
                  <Row label="快捷填入" detail="填入服务商的地址和推荐模型，密钥仍需自行填写">
                    <select
                      aria-label={`${meta.title} 快捷填入`}
                      value=""
                      onChange={e => { const preset = meta.presets[Number(e.target.value)]; if (preset) handleApplyPreset(role, preset); }}
                      className={cx(selectField, 'max-w-[220px]')}
                    >
                      <option value="" disabled>选择服务商…</option>
                      {meta.presets.map((preset, idx) => <option key={idx} value={idx}>{preset.label}</option>)}
                    </select>
                  </Row>
                  <Row label="接口地址 (Base URL)">
                    <input type="text" value={state.baseUrl} onChange={e => handleFieldChange(role, 'baseUrl', e.target.value)}
                      placeholder={role === 'embed' ? 'https://api.siliconflow.cn/v1' : 'https://api.deepseek.com/v1'} className={inputRowField} />
                  </Row>
                  <Row label="API 密钥（本地加密保存）" detail={state.hasKey ? '留空保持现有密钥' : '需要配置'}>
                    <div className="relative w-full max-w-[360px]">
                      <KeyRound size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-label-3 pointer-events-none" />
                      <input type={state.showKey ? 'text' : 'password'} value={state.newKey} onChange={e => handleFieldChange(role, 'newKey', e.target.value)}
                        placeholder={state.hasKey ? '••••••••（已保存，输入新 Key 覆盖）' : 'sk-...'} className={cx(inputRowField, 'pl-7 pr-8')} />
                      <button type="button" onClick={() => handleFieldChange(role, 'showKey', !state.showKey)} className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center text-label-3 hover:text-label" title={state.showKey ? '隐藏密钥' : '显示密钥'}>
                        {state.showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </Row>
                  <Row label="模型标识 (Model Name)">
                    <input type="text" value={state.model} onChange={e => handleFieldChange(role, 'model', e.target.value)}
                      placeholder={role === 'embed' ? 'BAAI/bge-m3' : 'deepseek-chat'} className={inputRowField} />
                  </Row>
                  <Row label="请求超时（秒）">
                    <input className={cx(fieldBox, 'h-7 w-20 text-right tabular-nums')} type="number" min="5" max="300" value={state.timeoutMs/1000}
                      onChange={e=>handleFieldChange(role,'timeoutMs',Math.max(5000,Math.min(300000,Number(e.target.value)*1000)))}/>
                  </Row>
                  <div className="px-3 py-2.5 space-y-2">
                    {state.testStatus.message && (
                      <Notice tone={state.testStatus.ok ? 'success' : 'danger'}>
                        <span className="inline-flex items-start gap-1.5">
                          {state.testStatus.ok ? <CheckCircle2 size={13} className="shrink-0 mt-[2px]" /> : <AlertCircle size={13} className="shrink-0 mt-[2px]" />}
                          <span>{state.testStatus.message} {state.testStatus.latencyMs ? `(${state.testStatus.latencyMs}ms)` : ''}</span>
                        </span>
                      </Notice>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button type="button" onClick={() => handleTestRole(role)} disabled={state.testStatus.testing} className={cx(button.secondary, 'h-7 text-[12px]')} title={role === 'embed' ? '发送测试向量请求至 /embeddings' : '发送连通性探测请求'}>
                        {state.testStatus.testing ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
                        <span>{state.testStatus.testing ? '验证中…' : role === 'asr' ? '测试真实音频' : '测试服务'}</span>
                      </button>
                      {role === 'chat' && (
                        <button type="button" disabled={state.testStatus.testing} className={cx(button.secondary, 'h-7 text-[12px]')} onClick={()=>void handleTestRole('chat','vision')}>
                          <ImageIcon size={12} />
                          <span>测试图片能力</span>
                        </button>
                      )}
                      <button type="button" onClick={() => handleSyncToAll(role)} className={cx(button.plain, 'h-7 text-[12px]')} title="将当前卡片的 Base URL 和 API Key 快速应用至其他 2 个模型">
                        <Copy size={12} />
                        <span>同步到全部</span>
                      </button>
                      <div className="flex-1" />
                      {role === 'embed' && (
                        <button type="button" onClick={handleRebuildEmbeddings} disabled={rebuildingEmbeddings} className={cx(button.plain, 'h-7 text-[12px]')} title="使用当前向量嵌入模型重新为全部文档生成语义向量">
                          <RefreshCw size={12} className={rebuildingEmbeddings ? 'animate-spin' : ''} />
                          <span>{rebuildingEmbeddings ? '重建中...' : '重建全库向量'}</span>
                        </button>
                      )}
                      <button type="button" onClick={() => handleSaveRole(role)} disabled={state.saving} className={cx(button.primary, 'h-7 px-3 text-[12px]')}>
                        <span>{state.saving ? '保存中...' : '保存'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
