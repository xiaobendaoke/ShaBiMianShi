import {RuntimeGate} from './components/RuntimeGate';
import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { CopilotView } from './components/CopilotView';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { ModelConfigView } from './components/ModelConfigView';
import { SettingsView } from './components/SettingsView';
import { SessionHistoryView } from './components/SessionHistoryView';
import { FloatingWindowView } from './components/FloatingWindowView';
import { DocumentRecord, Library, SessionRecord } from '../../main/types';
import { SessionList } from './components/SessionList';
import { SessionConfigModal, SessionConfigDraft } from './components/SessionConfigModal';

export default function App() { return <RuntimeGate><WorkspaceApp/></RuntimeGate>; }
function WorkspaceApp() {
  const isFloatingWindow = window.location.hash.includes('floating');

  if (isFloatingWindow) {
    return <FloatingWindowView />;
  }

  const [currentTab, setCurrentTab] = useState<NavTab>('copilot');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sb_sidebar_collapsed') === 'true';
  });
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [currentLibrary, setCurrentLibrary] = useState<Library | null>(null);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [contentProtected, setContentProtected] = useState(false);
  const [sessionModal, setSessionModal] = useState<{ mode: 'create' } | { mode: 'edit'; session: SessionRecord } | null>(null);

  const loadLibraries = async () => {
    const [list, docs]: [Library[], DocumentRecord[]] = await Promise.all([
      (window as any).api.getLibraries(),
      (window as any).api.getDocuments()
    ]);
    setLibraries(list);
    setDocuments(docs);
    if (list.length > 0 && !currentLibrary) {
      setCurrentLibrary(list[0]);
    }
  };

  const loadSession = async (keepSelection = true) => {
    const list: SessionRecord[] = await (window as any).api.getSessions();
    setSessions(list);
    if (!keepSelection) {
      // Start on a clean blank canvas when freshly launching the app
      setCurrentSession(null);
      return;
    }
    setCurrentSession(previous => previous ? (list.find(s => s.id === previous.id) || null) : null);
  };
  const selectSession = async (session:SessionRecord) => {
    await (window as any).api.selectSession(session.id);
    setCurrentSession(session);setCurrentTab('copilot');
  };
  const updateLocalSession = (session:SessionRecord) => {
    setCurrentSession(session);
    setSessions(previous=>previous.map(s=>s.id===session.id?session:s).sort((a,b)=>b.updatedAt-a.updatedAt));
  };
  const createSessionFromDraft = async (draft: SessionConfigDraft) => {
    const now = Date.now();
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      title: draft.title,
      targetRole: draft.targetRole,
      jobDescription: draft.jobDescription,
      libraryIds: draft.libraryIds,
      documentIds: draft.documentIds,
      strategy: currentSession?.strategy ?? 'docs_and_general',
      promptStyle: 'standard',
      language: currentSession?.language || 'C17',
      createdAt: now,
      updatedAt: now
    };
    await (window as any).api.saveSession(session);
    await selectSession(session);
    await loadSession();
  };
  const editSessionFromDraft = async (target: SessionRecord, draft: SessionConfigDraft) => {
    const updated: SessionRecord = {
      ...target,
      title: draft.title,
      targetRole: draft.targetRole,
      jobDescription: draft.jobDescription,
      libraryIds: draft.libraryIds,
      documentIds: draft.documentIds,
      updatedAt: Date.now()
    };
    await (window as any).api.saveSession(updated);
    if (currentSession?.id === updated.id) {
      updateLocalSession(updated);
    }
    await loadSession();
  };
  const deleteSession = async (session:SessionRecord) => {
    await (window as any).api.deleteSession(session.id);await loadSession();
  };

  useEffect(() => {
    loadLibraries();
    void loadSession(false);
    void (window as any).api.getContentProtection?.().then((enabled: boolean) => {
      setContentProtected(Boolean(enabled));
    }).catch(() => {});
    const unsubIngest = (window as any).api.onIngestionProgress?.(() => { void loadLibraries(); });
    return () => { unsubIngest?.(); };
  }, []);

  const handleToggleFloating = async () => {
    await (window as any).api.toggleFloatingWindow();
  };

  const handleToggleProtection = async () => {
    const next = !contentProtected;
    setContentProtected(next);
    await (window as any).api.setContentProtection(next);
  };

  const handleUpdateSession = async (updated: Partial<SessionRecord>) => {
    if (!currentSession) return;
    const next = { ...currentSession, ...updated, updatedAt: Date.now() };
    await (window as any).api.saveSession(next);
    updateLocalSession(next);
  };

  const handleToggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sb_sidebar_collapsed', String(next));
      return next;
    });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden text-label font-sans">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onToggleFloating={handleToggleFloating}
        contentProtected={contentProtected}
        onToggleProtection={handleToggleProtection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
      >
        <SessionList
          sessions={sessions}
          currentId={currentSession?.id}
          collapsed={sidebarCollapsed}
          onExpand={handleToggleSidebar}
          onSelect={selectSession}
          onRequestCreate={() => { void loadLibraries(); setSessionModal({ mode: 'create' }); }}
          onRequestEdit={session => { void loadLibraries(); setSessionModal({ mode: 'edit', session }); }}
          onDelete={deleteSession}
        />
      </Sidebar>

      <main className="flex-1 flex min-w-0 overflow-hidden bg-canvas">
        <div className="flex flex-1 overflow-hidden" style={{display: currentTab === 'copilot' ? 'flex' : 'none'}}>
          <CopilotView
            currentSession={currentSession}
            libraries={libraries}
            documents={documents}
            onSessionChange={updateLocalSession}
            onEditSession={() => {
              if (currentSession) {
                void loadLibraries();
                setSessionModal({ mode: 'edit', session: currentSession });
              } else {
                void loadLibraries();
                setSessionModal({ mode: 'create' });
              }
            }}
          />
        </div>
        {currentTab === 'knowledge' && (
          <KnowledgeBaseView
            libraries={libraries}
            currentLibrary={currentLibrary}
            onSelectLibrary={setCurrentLibrary}
            onRefreshLibraries={loadLibraries}
          />
        )}
        {currentTab === 'history' && (
          <SessionHistoryView
            currentSession={currentSession}
            onSelectSession={s => {
              void selectSession(s);
            }}
            onRefreshSessions={loadSession}
          />
        )}
        {currentTab === 'models' && <ModelConfigView />}
        {currentTab === 'settings' && (
          <SettingsView
            currentSession={currentSession}
            contentProtected={contentProtected}
            onToggleProtection={handleToggleProtection}
            onUpdateSession={handleUpdateSession}
          />
        )}
      </main>
      {sessionModal && (
        <SessionConfigModal
          mode={sessionModal.mode}
          initialSession={sessionModal.mode === 'edit' ? sessionModal.session : null}
          defaultSession={currentSession}
          libraries={libraries}
          onClose={() => setSessionModal(null)}
          onOpenKnowledgeBase={() => setCurrentTab('knowledge')}
          onSubmit={draft =>
            sessionModal.mode === 'create'
              ? createSessionFromDraft(draft)
              : editSessionFromDraft(sessionModal.session, draft)
          }
        />
      )}
    </div>
  );
}
