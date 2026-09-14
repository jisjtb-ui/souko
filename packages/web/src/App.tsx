import { useEffect, useState } from 'react';
import { WarehouseCanvas } from './canvas/WarehouseCanvas';
import { EventLog } from './components/EventLog';
import { Inspector } from './components/Inspector';
import { RackDialog } from './components/RackDialog';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { LocationGroupDialog } from './components/LocationGroupDialog';
import { MasterDialog } from './components/MasterDialog';
import { WarehouseDialog } from './components/WarehouseDialog';
import { DeadPositionPage } from './pages/DeadPositionPage';
import { useEditorStore } from './store/editorStore';

/** 画面。平面図エディタと分析ページは独立していて、状態はストアに残る。 */
export type Page = 'editor' | 'dead-position';

export default function App(): JSX.Element {
  const bootstrap = useEditorStore((s) => s.bootstrap);
  const loading = useEditorStore((s) => s.loading);
  const error = useEditorStore((s) => s.error);
  const warehouse = useEditorStore((s) => s.warehouse);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mastersOpen, setMastersOpen] = useState(false);
  const [page, setPage] = useState<Page>('editor');

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const store = useEditorStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        store.duplicateSelected();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void store.save();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (store.selectedAreaId) store.deleteArea(store.selectedAreaId);
        else if (store.selectedConnectionId) store.deleteConnection(store.selectedConnectionId);
        else store.deleteSelected();
        return;
      }
      if (e.key.toLowerCase() === 'r') {
        store.rotateSelected(e.shiftKey ? -90 : 90);
        return;
      }
      if (e.key === 'Enter' && store.polygonDraft && store.polygonDraft.length >= 3) {
        e.preventDefault();
        store.finishPolygonArea();
        return;
      }
      if (e.key === 'Escape') {
        if (store.polygonDraft) store.cancelPolygonArea();
        if (store.connectFromAreaId) store.setTool('select');
        store.setPlacingKind(null);
        store.clearRoute();
        store.clearSelection();
        return;
      }
      const step = e.shiftKey ? 1 : (store.warehouse?.gridSizeM ?? 0.5);
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = nudges[e.key];
      if (delta && store.selectedIds.length > 0) {
        e.preventDefault();
        store.nudgeSelected(delta[0], delta[1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* 未保存のまま閉じようとしたら確認する */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (useEditorStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <TopBar
        page={page}
        onChangePage={setPage}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenMasters={() => setMastersOpen(true)}
      />

      {page === 'editor' ? (
        <>
          <div className="workspace">
            <Toolbar />
            <main className="canvas-area">
              {loading && <div className="overlay-message">読み込み中…</div>}
              {!loading && !warehouse && <div className="overlay-message">倉庫がありません。「倉庫設定」から作成してください。</div>}
              {error && <div className="overlay-message error">{error}</div>}
              <WarehouseCanvas />
            </main>
            <Inspector />
          </div>

          <EventLog />
        </>
      ) : (
        <main className="page-area">
          <DeadPositionPage />
        </main>
      )}

      <RackDialog />
      <LocationGroupDialog />
      {settingsOpen && <WarehouseDialog onClose={() => setSettingsOpen(false)} />}
      {mastersOpen && <MasterDialog onClose={() => setMastersOpen(false)} />}
    </div>
  );
}
