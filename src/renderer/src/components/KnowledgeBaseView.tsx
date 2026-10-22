import React, { useState, useEffect } from 'react';
import {
  Plus,
  FolderPlus,
  FilePlus,
  Trash2,
  Search,
  FileText,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  BookOpen
} from 'lucide-react';
import { Library, DocumentRecord, RetrievalResult } from '../../../main/types';
import { Badge, EmptyState, PageHeader, Segmented, Toolbar, button, cx, field } from './ui';

interface KnowledgeBaseViewProps {
  libraries: Library[];
  currentLibrary: Library | null;
  onSelectLibrary: (lib: Library) => void;
  onRefreshLibraries: () => void;
}

const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  libraries,
  currentLibrary,
  onSelectLibrary,
  onRefreshLibraries
}) => {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'docs' | 'search_test'>('docs');
  const [searchQuery, setSearchQuery] = useState('');
  const [retrievalResult, setRetrievalResult] = useState<RetrievalResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [ingestionStats, setIngestionStats] = useState<any>({ total: 0, completed: 0, processing: 0, failed: 0 });
  const [importingPreset, setImportingPreset] = useState(false);
  // window.prompt is unavailable in Electron, so new libraries are named inline.
  const [newLibraryName, setNewLibraryName] = useState<string | null>(null);

  const loadDocuments = () => {
    if (currentLibrary) {
      (window as any).api.getDocuments(currentLibrary.id).then((docs: DocumentRecord[]) => {
        setDocuments(docs);
      });
    }
  };

  useEffect(() => {
    loadDocuments();
    (window as any).api.getIngestionStats().then((stats: any) => setIngestionStats(stats));

    const unsubProgress = (window as any).api.onIngestionProgress(() => {
      loadDocuments();
      (window as any).api.getIngestionStats().then((stats: any) => setIngestionStats(stats));
    });

    return () => unsubProgress();
  }, [currentLibrary]);

  const handleImportFiles = async () => {
    if (!currentLibrary) return;
    await (window as any).api.selectAndImportFiles(currentLibrary.id);
  };

  const handleImportFolder = async () => {
    if (!currentLibrary) return;
    await (window as any).api.selectAndImportFolder(currentLibrary.id);
  };

  const handleImportPreset = async () => {
    if (!currentLibrary) return;
    setImportingPreset(true);
    try {
      const res = await (window as any).api.importPresetQuestionBank(currentLibrary.id);
      loadDocuments();
      alert(res.message || '大厂高频技术面试真题库已加入导入队列！');
    } catch (err: any) {
      alert(`导入预置真题库失败: ${err.message}`);
    } finally {
      setImportingPreset(false);
    }
  };

  const handleDeleteDoc = async (id: string) => {
    if (confirm('确认从知识库中删除此文档？')) {
      await (window as any).api.deleteDocument(id);
      loadDocuments();
    }
  };

  const handleCreateLibrary = async (name: string) => {
    if (name && name.trim()) {
      const newLib: Library = {
        id: `lib_${Date.now()}`,
        name: name.trim(),
        description: '用户自定义资料库',
        docCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await (window as any).api.saveLibrary(newLib);
      setNewLibraryName(null);
      onRefreshLibraries();
    }
  };

  const handleTestSearch = async () => {
    if (!searchQuery.trim() || !currentLibrary) return;
    setIsSearching(true);
    try {
      const res: RetrievalResult = await (window as any).api.testRetrieval({
        query: searchQuery.trim(),
        libraryIds: [currentLibrary.id],
        topK: 10
      });
      setRetrievalResult(res);
    } catch (err: any) {
      alert(`检索测试失败: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const statusCell = (doc: DocumentRecord) => {
    if (doc.status === 'ready') return <Badge tone="success"><CheckCircle2 size={11} />已就绪</Badge>;
    if (doc.status === 'parsing' || doc.status === 'indexing') return <Badge tone="accent"><RefreshCw size={11} className="animate-spin" />{doc.status === 'parsing' ? '解析中' : '索引中'}</Badge>;
    if (doc.status === 'keyword_only') return <Badge tone="warning" title={doc.errorMsg || ''}>{doc.needsOcr ? '需 OCR' : '仅关键词 · 可重建向量'}</Badge>;
    if (doc.status === 'failed') return <Badge tone="danger" title={doc.errorMsg || ''}><AlertCircle size={11} />失败</Badge>;
    return <Badge>{doc.status}</Badge>;
  };

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden aurora">
      {/* Libraries */}
      <aside className="w-[232px] shrink-0 border-r border-separator flex flex-col min-h-0 glass">
        <Toolbar className="justify-between pr-2">
          <span className="text-[13px] font-semibold text-label">知识库列表</span>
          <button onClick={() => setNewLibraryName('项目与技术笔记')} className={button.icon} title="新建知识库">
            <Plus size={16} strokeWidth={1.75} />
          </button>
        </Toolbar>

        <div className="flex-1 overflow-y-auto p-2 space-y-px">
          {newLibraryName !== null && (
            <form className="mb-2 rounded-xl bg-elevated shadow-card p-2.5 space-y-2 animate-fade-up" onSubmit={e => { e.preventDefault(); void handleCreateLibrary(newLibraryName); }}>
              <div className="text-[11px] font-medium text-label-2 px-0.5">请输入新知识库名称</div>
              <input autoFocus aria-label="新知识库名称" value={newLibraryName} onChange={e => setNewLibraryName(e.target.value)} onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Escape') setNewLibraryName(null); }} className={field} />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setNewLibraryName(null)} className={cx(button.plain, 'h-7 text-[12px]')}>取消</button>
                <button disabled={!newLibraryName.trim()} className={cx(button.primary, 'h-7 px-3 text-[12px]')}>创建</button>
              </div>
            </form>
          )}
          {libraries.map(lib => {
            const active = currentLibrary?.id === lib.id;
            return (
              <button key={lib.id} onClick={() => onSelectLibrary(lib)} className={cx('w-full flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-[13px] transition-colors', active ? 'bg-accent-soft text-label font-medium' : 'text-label hover:bg-fill')}>
                <BookOpen size={15} strokeWidth={1.75} className={active ? 'text-accent' : 'text-label-3'} />
                <span className="truncate flex-1 text-left">{lib.name}</span>
                <span className="text-[11px] text-label-3 tabular-nums">{lib.docCount || 0}</span>
              </button>
            );
          })}
        </div>

        {/* Ingestion Queue Mini Status */}
        {ingestionStats.processing > 0 && (
          <div className="m-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[12px] space-y-0.5">
            <div className="flex items-center gap-1.5 text-accent-text font-medium">
              <RefreshCw size={12} className="animate-spin" />
              <span>文档导入中...</span>
            </div>
            <div className="text-[11px] text-label-2">处理中: {ingestionStats.processing} · 队列: {ingestionStats.queued}</div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Toolbar className="justify-center">
          <Segmented
            value={activeSubTab}
            onChange={setActiveSubTab}
            options={[
              {id: 'docs', label: `文档管理 (${documents.length})`},
              {id: 'search_test', label: '检索测试 (混合召回诊断)'}
            ]}
          />
        </Toolbar>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1000px] mx-auto px-10 pt-9 pb-12">
            <PageHeader title={currentLibrary?.name || '知识库'} subtitle={activeSubTab === 'docs' ? '导入 PDF、DOCX、Markdown、TXT。等待文档状态变成“已就绪”后，即可在面试中引用。' : '在此输入查询词，可直观诊断关键词与向量的召回排序、RRF 融合分与原文片段'}>
              {activeSubTab === 'docs' && <>
                <button onClick={handleImportPreset} disabled={importingPreset} className={button.secondary} title="导入系统内置的大厂高频技术面试真题（高并发、微服务、MySQL、Redis、前端与算法）">
                  <Sparkles size={14} className={importingPreset ? 'animate-spin' : ''} />
                  <span>{importingPreset ? '正在导入真题库...' : '导入大厂高频真题'}</span>
                </button>
                <button onClick={handleImportFolder} className={button.secondary}>
                  <FolderPlus size={14} />
                  <span>导入文件夹</span>
                </button>
                <button onClick={handleImportFiles} className={button.primary}>
                  <FilePlus size={14} />
                  <span>批量选择文件</span>
                </button>
              </>}
            </PageHeader>

            {/* Documents */}
            {activeSubTab === 'docs' && (
              documents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-separator">
                  <EmptyState icon={<FileText size={36} strokeWidth={1.25} />} title="当前知识库暂无文档">
                    可一键导入预置大厂真题库，或导入你的自定义技术资料。
                    <div className="mt-5 flex justify-center gap-2">
                      <button onClick={handleImportPreset} disabled={importingPreset} className={button.secondary}>
                        <Sparkles size={14} />
                        <span>一键导入大厂高频真题库</span>
                      </button>
                      <button onClick={handleImportFiles} className={button.primary}>导入自选文件</button>
                    </div>
                  </EmptyState>
                </div>
              ) : (
                <div className="rounded-2xl bg-surface shadow-card overflow-hidden">
                  <table className="w-full text-left text-[13px] whitespace-nowrap">
                    <thead className="text-[11px] text-label-3">
                      <tr className="border-b border-separator">
                        <th className="h-9 pl-4 pr-3 font-medium">文档名称</th>
                        <th className="h-9 px-3 font-medium">格式</th>
                        <th className="h-9 px-3 font-medium">大小</th>
                        <th className="h-9 px-3 font-medium">页数/段落</th>
                        <th className="h-9 px-3 font-medium">状态</th>
                        <th className="h-9 px-3 font-medium">更新时间</th>
                        <th className="h-9 pl-3 pr-4 font-medium text-right sr-only">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-separator">
                      {documents.map(doc => (
                        <tr key={doc.id} className="group hover:bg-fill transition-colors">
                          <td className="h-11 pl-4 pr-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText size={15} strokeWidth={1.75} className="text-accent shrink-0" />
                              <span className="truncate max-w-[300px] text-label" title={doc.fileName}>{doc.fileName}</span>
                              {doc.needsOcr && <Badge tone="warning">待 OCR</Badge>}
                            </div>
                          </td>
                          <td className="px-3 uppercase text-[12px] text-label-2">{doc.fileType}</td>
                          <td className="px-3 text-[12px] text-label-2 tabular-nums">{formatSize(doc.fileSize)}</td>
                          <td className="px-3 text-[12px] text-label-2">{doc.pageCount ? `${doc.pageCount} 页` : '-'}</td>
                          <td className="px-3">{statusCell(doc)}</td>
                          <td className="px-3 text-[12px] text-label-3">{new Date(doc.updatedAt).toLocaleDateString()}</td>
                          <td className="pl-3 pr-3 text-right">
                            <button onClick={() => handleDeleteDoc(doc.id)} className={cx(button.icon, 'opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger')} title="删除文档">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Search Testing & Diagnostics */}
            {activeSubTab === 'search_test' && (
              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-label-3 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleTestSearch()}
                      placeholder="输入检索测试问题，如：订单重复提交怎么解决？"
                      className={cx(field, 'h-10 pl-10 text-[14px] rounded-xl')}
                    />
                  </div>
                  <button onClick={handleTestSearch} disabled={isSearching || !searchQuery.trim()} className={cx(button.primary, 'h-10 px-5 rounded-xl')}>
                    {isSearching ? '检索中...' : '开始测试检索'}
                  </button>
                </div>

                {retrievalResult ? (
                  <div className="space-y-3">
                    <div className="text-[12px] text-label-2 px-1">
                      检索耗时: <strong className="text-label font-semibold">{retrievalResult.latencyMs} ms</strong> · 候选召回: {retrievalResult.totalCandidates} 条 · 最终选取: {retrievalResult.items.length} 条
                    </div>
                    {retrievalResult.items.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-separator"><EmptyState title="未命中任何相关资料片段" /></div>
                    ) : retrievalResult.items.map((item, idx) => (
                      <div key={item.chunkId} className="rounded-2xl bg-surface shadow-card p-4 space-y-2.5">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge tone="accent">#{idx + 1} RRF 分数: {item.rrfScore.toFixed(4)}</Badge>
                            <span className="text-[13px] font-medium text-label truncate">{item.fileName}</span>
                            <span className="text-[12px] text-label-3 truncate">{item.sectionPath}</span>
                          </div>
                          <div className="text-[11px] text-label-2 flex gap-3 tabular-nums">
                            <span>关键词 (BM25): {item.keywordScore.toFixed(2)} (排名: #{item.keywordRank || '-'})</span>
                            <span>向量相似度: {item.vectorScore.toFixed(3)} (排名: #{item.vectorRank || '-'})</span>
                          </div>
                        </div>
                        <div className="text-[13px] leading-relaxed text-label-2 whitespace-pre-wrap select-text">{item.text}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<SlidersHorizontal size={30} strokeWidth={1.25} />} title="检索测试">
                    输入一个面试问题，查看哪些资料片段会被召回、排序依据是什么。
                  </EmptyState>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
