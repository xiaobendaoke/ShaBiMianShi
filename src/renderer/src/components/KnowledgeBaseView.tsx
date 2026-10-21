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
  Clock,
  Sparkles,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react';
import { Library, DocumentRecord, RetrievalResult, RetrievalResultItem } from '../../../main/types';

interface KnowledgeBaseViewProps {
  libraries: Library[];
  currentLibrary: Library | null;
  onSelectLibrary: (lib: Library) => void;
  onRefreshLibraries: () => void;
}

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

  const [importingPreset, setImportingPreset] = useState(false);

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

  const handleCreateLibrary = async () => {
    const name = prompt('请输入新知识库名称：', '项目与技术笔记');
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

  return (
    <div className="flex-1 flex overflow-hidden bg-gray-900">
      {/* Left: Libraries List */}
      <div className="w-64 border-r border-gray-800 bg-gray-950/70 p-4 flex flex-col justify-between shrink-0">
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-gray-300">知识库列表</span>
            <button
              onClick={handleCreateLibrary}
              className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-emerald-400 transition-colors"
              title="新建知识库"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="space-y-1">
            {libraries.map(lib => (
              <button
                key={lib.id}
                onClick={() => onSelectLibrary(lib)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between ${
                  currentLibrary?.id === lib.id
                    ? 'bg-emerald-950/40 border border-emerald-700/60 text-emerald-300'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900 border border-transparent'
                }`}
              >
                <span className="truncate">{lib.name}</span>
                <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-400">
                  {lib.docCount || 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Ingestion Queue Mini Status */}
        {ingestionStats.processing > 0 && (
          <div className="p-3 bg-gray-900 border border-emerald-800/40 rounded-lg text-xs space-y-1">
            <div className="flex items-center space-x-1.5 text-emerald-400 font-medium">
              <RefreshCw size={12} className="animate-spin" />
              <span>文档导入中...</span>
            </div>
            <div className="text-[11px] text-gray-400">
              处理中: {ingestionStats.processing} · 队列: {ingestionStats.queued}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-900 p-6 space-y-4">
        {/* Top Header & Sub-Tabs */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-800">
          <div className="flex items-center space-x-4">
            <h2 className="text-sm font-semibold text-gray-100 flex items-center space-x-2">
              <span>{currentLibrary?.name || '知识库'}</span>
            </h2>

            <div className="flex items-center space-x-1 bg-gray-950 p-1 rounded-lg border border-gray-800">
              <button
                onClick={() => setActiveSubTab('docs')}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  activeSubTab === 'docs' ? 'bg-emerald-600 text-white font-medium' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                文档管理 ({documents.length})
              </button>
              <button
                onClick={() => setActiveSubTab('search_test')}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  activeSubTab === 'search_test' ? 'bg-emerald-600 text-white font-medium' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                检索测试 (混合召回诊断)
              </button>
            </div>
          </div>

          {activeSubTab === 'docs' && (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleImportPreset}
                disabled={importingPreset}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-700/60 rounded-md text-xs font-medium transition-colors"
                title="导入系统内置的大厂高频技术面试真题（高并发、微服务、MySQL、Redis、前端与算法）"
              >
                <Sparkles size={14} className={importingPreset ? "animate-spin text-amber-400" : "text-amber-400"} />
                <span>{importingPreset ? '正在导入真题库...' : '导入大厂高频真题'}</span>
              </button>
              <button
                onClick={handleImportFiles}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-medium transition-colors"
              >
                <FilePlus size={14} />
                <span>批量选择文件</span>
              </button>
              <button
                onClick={handleImportFolder}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-md text-xs font-medium transition-colors"
              >
                <FolderPlus size={14} />
                <span>导入文件夹</span>
              </button>
            </div>
          )}
        </div>

        {/* TAB 1: Document Table */}
        {activeSubTab === 'docs' && (
          <div className="flex-1 overflow-y-auto">
            {documents.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-xl p-8 text-center space-y-3">
                <FileText size={32} className="text-gray-600" />
                <div className="text-xs text-gray-400">
                  当前知识库暂无文档。可一键导入预置大厂真题库，或导入你的自定义技术资料。
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleImportPreset}
                    disabled={importingPreset}
                    className="px-4 py-2 bg-amber-950/70 hover:bg-amber-900/90 border border-amber-600/70 text-amber-300 rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                  >
                    <Sparkles size={13} />
                    <span>一键导入大厂高频真题库</span>
                  </button>
                  <button
                    onClick={handleImportFiles}
                    className="px-4 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 rounded-lg text-xs"
                  >
                    导入自选文件
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950/40">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-950/90 text-gray-400 border-b border-gray-800 text-[11px]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">文档名称</th>
                      <th className="py-2.5 px-3 font-medium">格式</th>
                      <th className="py-2.5 px-3 font-medium">大小</th>
                      <th className="py-2.5 px-3 font-medium">页数/段落</th>
                      <th className="py-2.5 px-3 font-medium">状态</th>
                      <th className="py-2.5 px-3 font-medium">更新时间</th>
                      <th className="py-2.5 px-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {documents.map(doc => (
                      <tr key={doc.id} className="hover:bg-gray-900/50 transition-colors">
                        <td className="py-3 px-4 font-medium text-gray-200 flex items-center space-x-2">
                          <FileText size={14} className="text-gray-400 shrink-0" />
                          <span className="truncate max-w-xs">{doc.fileName}</span>
                          {doc.needsOcr && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-950 border border-amber-800 text-amber-400 font-medium">
                              待 OCR
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 uppercase text-gray-400">{doc.fileType}</td>
                        <td className="py-3 px-3 text-gray-400">
                          {(doc.fileSize / 1024).toFixed(1)} KB
                        </td>
                        <td className="py-3 px-3 text-gray-400">
                          {doc.pageCount ? `${doc.pageCount} 页` : '-'}
                        </td>
                        <td className="py-3 px-3">
                          {doc.status === 'ready' && (
                            <span className="inline-flex items-center space-x-1 text-emerald-400">
                              <CheckCircle2 size={13} />
                              <span>已就绪</span>
                            </span>
                          )}
                          {(doc.status === 'parsing' || doc.status === 'indexing') && (
                            <span className="inline-flex items-center space-x-1 text-amber-400">
                              <RefreshCw size={13} className="animate-spin" />
                              <span>{doc.status === 'parsing' ? '解析中' : '索引中'}</span>
                            </span>
                          )}
                          {doc.status === 'keyword_only' && (
                            <span className="text-amber-400" title={doc.errorMsg || ''}>
                              {doc.needsOcr ? '需 OCR' : '仅关键词 · 可重建向量'}
                            </span>
                          )}
                          {doc.status === 'failed' && (
                            <span className="inline-flex items-center space-x-1 text-red-400" title={doc.errorMsg || ''}>
                              <AlertCircle size={13} />
                              <span>失败</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-gray-500">
                          {new Date(doc.updatedAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="p-1 hover:text-red-400 text-gray-500 transition-colors"
                            title="删除文档"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Search Testing & Diagnostics */}
        {activeSubTab === 'search_test' && (
          <div className="flex-1 flex flex-col overflow-hidden space-y-4">
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-3 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTestSearch()}
                  placeholder="输入检索测试问题，如：订单重复提交怎么解决？"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                onClick={handleTestSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
              >
                {isSearching ? '检索中...' : '开始测试检索'}
              </button>
            </div>

            {/* Results Display */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {retrievalResult ? (
                <>
                  <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                    <span>
                      检索耗时: <strong className="text-emerald-400">{retrievalResult.latencyMs} ms</strong> · 候选召回: {retrievalResult.totalCandidates} 条 · 最终选取: {retrievalResult.items.length} 条
                    </span>
                  </div>

                  {retrievalResult.items.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-500 border border-dashed border-gray-800 rounded-xl">
                      未命中任何相关资料片段
                    </div>
                  ) : (
                    retrievalResult.items.map((item, idx) => (
                      <div
                        key={item.chunkId}
                        className="p-4 bg-gray-950 border border-gray-800 rounded-xl space-y-2 hover:border-gray-700 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-400 font-bold">
                              #{idx + 1} RRF 分数: {item.rrfScore.toFixed(4)}
                            </span>
                            <span className="text-xs font-semibold text-gray-200">{item.fileName}</span>
                            <span className="text-[11px] text-gray-500">{item.sectionPath}</span>
                          </div>

                          <div className="text-[10px] space-x-3 text-gray-400">
                            <span>关键词 (BM25): {item.keywordScore.toFixed(2)} (排名: #{item.keywordRank || '-'})</span>
                            <span>向量相似度: {item.vectorScore.toFixed(3)} (排名: #{item.vectorRank || '-'})</span>
                          </div>
                        </div>

                        <div className="text-xs text-gray-300 bg-gray-900/80 p-3 rounded-lg border border-gray-800/80 leading-relaxed whitespace-pre-wrap">
                          {item.text}
                        </div>
                      </div>
                    ))
                  )}
                </>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center text-xs text-gray-500 space-y-2">
                  <SlidersHorizontal size={24} className="text-gray-600" />
                  <div>在此输入查询词，可直观诊断关键词与向量的召回排序、RRF 融合分与原文片段</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
