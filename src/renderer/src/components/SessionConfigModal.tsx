import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, FileText, FolderOpen, X } from 'lucide-react';
import type { DocumentRecord, Library, SessionRecord } from '../../../main/types';
import { Badge, Notice, button, cx, field, textArea } from './ui';

export interface SessionConfigDraft {
  title: string;
  targetRole: string;
  jobDescription: string;
  libraryIds: string[];
  documentIds?: string[];
}

interface SessionConfigModalProps {
  mode: 'create' | 'edit';
  initialSession?: SessionRecord | null;
  defaultSession?: SessionRecord | null;
  libraries: Library[];
  onClose: () => void;
  onOpenKnowledgeBase: () => void;
  onSubmit: (draft: SessionConfigDraft) => Promise<void>;
}

function isResumeLike(doc: Pick<DocumentRecord, 'fileName' | 'fileType'>): boolean {
  return doc.fileType === 'pdf' || /\.pdf$/i.test(doc.fileName) || /(?:简历|履历|个人介绍|候选人|求职|\bcv\b|\bresume\b)/i.test(doc.fileName);
}

export const SessionConfigModal: React.FC<SessionConfigModalProps> = ({
  mode,
  initialSession,
  defaultSession,
  libraries,
  onClose,
  onOpenKnowledgeBase,
  onSubmit
}) => {
  const isEdit = mode === 'edit' && !!initialSession;
  const [targetRole, setTargetRole] = useState(() => isEdit ? (initialSession?.targetRole || '') : '');
  const [customNote, setCustomNote] = useState(() => {
    if (!isEdit || !initialSession) return '';
    const role = initialSession.targetRole?.trim() || '';
    if (!role) return initialSession.title;
    if (initialSession.title === role) return '';
    if (initialSession.title.endsWith(` · ${role}`)) return initialSession.title.slice(0, -(` · ${role}`).length);
    return initialSession.title;
  });
  const [jobDescription, setJobDescription] = useState(() => isEdit ? (initialSession?.jobDescription || '') : '');
  const [jdOpen, setJdOpen] = useState(() => isEdit && !!initialSession?.jobDescription?.trim());
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [expandedLibIds, setExpandedLibIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const roleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    roleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingDocs(true);
    void (window as any).api.getDocuments()
      .then((docs: DocumentRecord[]) => {
        if (!active) return;
        setDocuments(docs);
        const validDocIds = new Set(docs.map(d => d.id));
        const sourceSession = isEdit ? initialSession : defaultSession;

        let initialSelected: string[] = [];
        if (sourceSession?.documentIds !== undefined) {
          initialSelected = sourceSession.documentIds.filter(id => validDocIds.has(id));
        } else if (sourceSession?.libraryIds?.length) {
          const libSet = new Set(sourceSession.libraryIds);
          initialSelected = docs.filter(d => d.libraryIds.some(lid => libSet.has(lid))).map(d => d.id);
        }
        if (!isEdit && initialSelected.length === 0 && docs.length > 0) {
          initialSelected = docs.map(d => d.id);
        }
        setSelectedDocIds([...new Set(initialSelected)]);

        // Expand libraries by default when total libraries <= 3, or when a library has multiple resumes or partial selection
        const autoExpand = libraries
          .filter(lib => {
            const libDocs = docs.filter(d => d.libraryIds.includes(lib.id));
            const resumeCount = libDocs.filter(isResumeLike).length;
            const pickedCount = libDocs.filter(d => initialSelected.includes(d.id)).length;
            return libraries.length <= 3 || resumeCount > 1 || (pickedCount > 0 && pickedCount < libDocs.length);
          })
          .map(lib => lib.id);
        setExpandedLibIds(autoExpand);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || '读取知识库文档失败');
      })
      .finally(() => {
        if (active) setLoadingDocs(false);
      });
    return () => { active = false; };
  }, [isEdit, initialSession?.id, defaultSession?.id, libraries]);

  const docsByLibrary = (libId: string) => documents.filter(d => d.libraryIds.includes(libId));

  const toggleLibrary = (libId: string) => {
    const libDocs = docsByLibrary(libId);
    if (libDocs.length === 0) return;
    const libDocIds = libDocs.map(d => d.id);
    const allChecked = libDocIds.every(id => selectedDocIds.includes(id));
    if (allChecked) {
      setSelectedDocIds(prev => prev.filter(id => !libDocIds.includes(id)));
    } else {
      setSelectedDocIds(prev => [...new Set([...prev, ...libDocIds])]);
    }
    setError('');
  };

  const toggleDoc = (docId: string) => {
    setSelectedDocIds(prev => prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]);
    setError('');
  };

  const toggleExpandLib = (libId: string) => {
    setExpandedLibIds(prev => prev.includes(libId) ? prev.filter(id => id !== libId) : [...prev, libId]);
  };

  const selectedDocs = documents.filter(d => selectedDocIds.includes(d.id));
  const selectedResumeCount = selectedDocs.filter(isResumeLike).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || loadingDocs) return;

    const cleanRole = targetRole.trim();
    if (!cleanRole) {
      setError('请输入本场面试的目标岗位（例如：销售、产品经理、Java后端）');
      roleInputRef.current?.focus();
      return;
    }

    if (documents.length === 0 || selectedDocs.length === 0) {
      setError('请至少勾选一份本场要使用的知识库或简历资料');
      return;
    }

    const activeLibIds = libraries
      .filter(lib => docsByLibrary(lib.id).some(d => selectedDocIds.includes(d.id)))
      .map(lib => lib.id);

    // Check if every selected library has 100% of its documents selected
    const isFullLibrarySelection = activeLibIds.every(libId => {
      const libDocs = docsByLibrary(libId);
      return libDocs.length > 0 && libDocs.every(d => selectedDocIds.includes(d.id));
    });

    const cleanNote = customNote.trim();
    const computedTitle = cleanNote
      ? (isEdit && cleanNote === initialSession?.title && cleanRole === (initialSession?.targetRole || '')
          ? cleanNote
          : cleanNote === cleanRole
            ? cleanRole
            : `${cleanNote} · ${cleanRole}`)
      : cleanRole;

    setBusy(true);
    setError('');
    try {
      await onSubmit({
        title: computedTitle.slice(0, 100),
        targetRole: cleanRole.slice(0, 80),
        jobDescription: jobDescription.trim(),
        libraryIds: activeLibIds,
        documentIds: isFullLibrarySelection ? undefined : selectedDocs.map(d => d.id)
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || '保存面试配置失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="no-drag fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => { if (!busy) onClose(); }}
      onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '编辑本场面试岗位与资料' : '新建面试'}
        className="w-full max-w-[520px] rounded-2xl bg-elevated shadow-pop border border-separator overflow-hidden animate-fade-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-13 border-b border-separator">
          <div>
            <h2 className="text-[15px] font-semibold text-label">{isEdit ? '面试岗位与资料设置' : '新建面试'}</h2>
          </div>
          <button type="button" disabled={busy} onClick={onClose} className={button.icon} title="关闭 (Esc)">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* 1. Pure free-text Target Role input (Enter submits directly) */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-2.5">
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1 text-[12px] font-medium text-label">
                <span>目标岗位</span>
                <span className="text-danger">*</span>
              </span>
              <input
                ref={roleInputRef}
                type="text"
                autoFocus
                maxLength={80}
                value={targetRole}
                onChange={e => { setTargetRole(e.target.value); if (error) setError(''); }}
                placeholder="直接输入，如：销售、产品经理、技术支持"
                className={cx(field, 'h-9 text-[13px]')}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[12px] font-medium text-label-2">公司 / 轮次备注（可选）</span>
              <input
                type="text"
                maxLength={60}
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                placeholder="不填默认用岗位名"
                className={cx(field, 'h-9 text-[13px]')}
              />
            </label>
          </div>
          <p className="text-[11px] text-label-3 -mt-2">
            输入目标岗位后按 <kbd className="px-1 py-0.5 rounded bg-fill border border-separator text-label-2">Enter</kbd> 即可直接开聊；AI 会按该岗位专业视角作答，并自动将简历经历重心往该岗位靠拢。
          </p>

          {/* 2. Mandatory Knowledge Base / Resume Picker */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[12px] font-medium text-label">
                <span>本场使用的知识库 / 简历</span>
                <span className="text-danger">* 必选</span>
              </span>
              {!loadingDocs && documents.length > 0 && (
                <span className="text-[11px] text-label-2">
                  已选 <strong className="text-label font-semibold">{selectedDocs.length}</strong> / {documents.length} 份资料
                </span>
              )}
            </div>

            {loadingDocs ? (
              <div className="rounded-xl border border-separator bg-surface px-4 py-5 text-center text-[12px] text-label-3">
                正在读取知识库与简历列表…
              </div>
            ) : documents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-separator bg-surface p-4 text-center space-y-2.5">
                <div className="text-[13px] font-medium text-label">当前还没有导入任何简历或知识库资料</div>
                <div className="text-[12px] text-label-2">请先在「知识库」中上传你的简历（PDF / DOCX / MD）后再开始面试。</div>
                <button
                  type="button"
                  onClick={() => { onClose(); onOpenKnowledgeBase(); }}
                  className={cx(button.secondary, 'h-8 px-3 text-[12px]')}
                >
                  <FolderOpen size={14} />
                  <span>前往知识库导入简历</span>
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-separator bg-surface divide-y divide-separator max-h-52 overflow-y-auto">
                {libraries.map(lib => {
                  const libDocs = docsByLibrary(lib.id);
                  if (libDocs.length === 0) return null;
                  const pickedCount = libDocs.filter(d => selectedDocIds.includes(d.id)).length;
                  const allChecked = pickedCount === libDocs.length;
                  const partial = pickedCount > 0 && !allChecked;
                  const expanded = expandedLibIds.includes(lib.id);

                  return (
                    <div key={lib.id}>
                      <div className="flex items-center gap-2 px-3 h-9 hover:bg-fill transition-colors">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={partial ? 'mixed' : allChecked}
                          onClick={() => toggleLibrary(lib.id)}
                          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                        >
                          <span className={cx(
                            'h-4 w-4 shrink-0 rounded-[5px] flex items-center justify-center transition-colors',
                            allChecked || partial ? 'bg-accent text-white' : 'border border-label-3 bg-canvas'
                          )}>
                            {allChecked && <Check size={11} strokeWidth={3} />}
                            {partial && <span className="h-0.5 w-2 rounded-full bg-white" />}
                          </span>
                          <BookOpen size={14} className="text-accent shrink-0" />
                          <span className="truncate text-[13px] font-medium text-label">{lib.name}</span>
                          <span className="text-[11px] text-label-3 shrink-0">
                            {pickedCount}/{libDocs.length} 篇
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpandLib(lib.id)}
                          className={cx(button.icon, 'h-6 w-6')}
                          title={expanded ? '收起文档列表' : '展开勾选单份简历/文档'}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </div>

                      {expanded && (
                        <div className="bg-canvas/60 border-t border-separator/60 py-1 divide-y divide-separator/40">
                          {libDocs.map(doc => {
                            const checked = selectedDocIds.includes(doc.id);
                            const resume = isResumeLike(doc);
                            return (
                              <button
                                key={doc.id}
                                type="button"
                                role="checkbox"
                                aria-checked={checked}
                                onClick={() => toggleDoc(doc.id)}
                                className="w-full flex items-center gap-2.5 pl-8 pr-3 py-1.5 text-left hover:bg-fill transition-colors"
                              >
                                <span className={cx(
                                  'h-3.5 w-3.5 shrink-0 rounded-[4px] flex items-center justify-center transition-colors',
                                  checked ? 'bg-accent text-white' : 'border border-label-3 bg-canvas'
                                )}>
                                  {checked && <Check size={10} strokeWidth={3} />}
                                </span>
                                <FileText size={13} className={resume ? 'text-accent shrink-0' : 'text-label-3 shrink-0'} />
                                <span className="truncate flex-1 text-[12px] text-label" title={doc.fileName}>{doc.fileName}</span>
                                {resume && <Badge tone="accent">简历</Badge>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {selectedResumeCount > 1 && (
              <p className="text-[11px] text-warning">
                当前同时勾选了 {selectedResumeCount} 份简历类文件；若本场只用其中一份，可展开取消勾选其余简历以防串台。
              </p>
            )}
          </div>

          {/* 3. Optional Collapsible JD Input */}
          <div className="rounded-xl border border-separator bg-surface overflow-hidden">
            <button
              type="button"
              onClick={() => setJdOpen(v => !v)}
              className="w-full flex items-center justify-between px-3.5 h-9 text-[12px] font-medium text-label-2 hover:text-label hover:bg-fill transition-colors"
            >
              <span className="flex items-center gap-1.5">
                {jdOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>粘贴招聘软件上的具体 JD / 岗位职责（可选）</span>
              </span>
              {jobDescription.trim() && <Badge tone="accent">已填写</Badge>}
            </button>
            {jdOpen && (
              <div className="px-3.5 pb-3.5 pt-1 border-t border-separator">
                <textarea
                  rows={4}
                  value={jobDescription}
                  onChange={e => setJobDescription(e.target.value)}
                  placeholder="粘贴目标岗位的职责描述与任职要求（可选）。AI 会根据 JD 关注点从你的简历中挑选最匹配的经历切入回答，不会将 JD 要求冒充为你做过的事实。"
                  className={cx(textArea, 'text-[12px]')}
                />
              </div>
            )}
          </div>

          {error && <Notice tone="danger">{error}</Notice>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" disabled={busy} onClick={onClose} className={button.plain}>
              取消
            </button>
            <button
              type="submit"
              disabled={busy || loadingDocs || documents.length === 0}
              className={cx(button.primary, 'px-4')}
            >
              {busy ? '保存中…' : isEdit ? '保存设置' : '开始面试 ↵'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
