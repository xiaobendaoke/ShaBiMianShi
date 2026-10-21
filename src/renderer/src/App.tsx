import {RuntimeGate} from './components/RuntimeGate';
import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { CopilotView } from './components/CopilotView';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { ModelConfigView } from './components/ModelConfigView';
import { SettingsView } from './components/SettingsView';
import { SessionHistoryView } from './components/SessionHistoryView';
import { FloatingWindowView } from './components/FloatingWindowView';
import { Library, SessionRecord } from '../../main/types';
import {SessionList} from './components/SessionList';

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
  const [currentLibrary, setCurrentLibrary] = useState<Library | null>(null);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [contentProtected, setContentProtected] = useState(false);

  const loadLibraries = async () => {
    const list: Library[] = await (window as any).api.getLibraries();
    setLibraries(list);
    if (list.length > 0 && !currentLibrary) {
      setCurrentLibrary(list[0]);
    }
  };

  const loadSession = async () => {
    const list: SessionRecord[] = await (window as any).api.getSessions();
    const selected: string | null = await (window as any).api.getSelectedSession();
    setSessions(list);
    setCurrentSession(previous=>list.find(s=>s.id===previous?.id)||list.find(s=>s.id===selected)||list[0]||null);
  };
  const selectSession = async (session:SessionRecord) => {
    await (window as any).api.selectSession(session.id);
    setCurrentSession(session);setCurrentTab('copilot');
  };
  const updateLocalSession = (session:SessionRecord) => {
    setCurrentSession(session);
    setSessions(previous=>previous.map(s=>s.id===session.id?session:s).sort((a,b)=>b.updatedAt-a.updatedAt));
  };
  const createSession = async (title:string) => {
    const now=Date.now();
    const session:SessionRecord={id:crypto.randomUUID(),title,libraryIds:currentSession?.libraryIds??libraries.map(l=>l.id),strategy:currentSession?.strategy??'docs_and_general',promptStyle:'standard',language:currentSession?.language||'C17',createdAt:now,updatedAt:now};
    await (window as any).api.saveSession(session);
    await selectSession(session);await loadSession();
  };
  const renameSession = async (session:SessionRecord,title:string) => {
    await (window as any).api.saveSession({...session,title,updatedAt:Date.now()});await loadSession();
  };
  const deleteSession = async (session:SessionRecord) => {
    await (window as any).api.deleteSession(session.id);await loadSession();
  };

  useEffect(() => {
    loadLibraries();
    loadSession();
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
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900 text-gray-100 font-sans">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onToggleFloating={handleToggleFloating}
        contentProtected={contentProtected}
        onToggleProtection={handleToggleProtection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
      >
        <SessionList sessions={sessions} currentId={currentSession?.id} collapsed={sidebarCollapsed} onExpand={handleToggleSidebar} onSelect={selectSession} onCreate={createSession} onRename={renameSession} onDelete={deleteSession}/>
      </Sidebar>

      <main className="flex-1 flex overflow-hidden">
        <div className="flex flex-1 overflow-hidden" style={{display: currentTab === 'copilot' ? 'flex' : 'none'}}>
          <CopilotView currentSession={currentSession} libraries={libraries} onSessionChange={updateLocalSession} />
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
    </div>
  );
}
