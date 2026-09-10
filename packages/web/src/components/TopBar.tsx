import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { WarehouseSummary } from '../api/client';
import { useEditorStore } from '../store/editorStore';

/**
 * 上部バー: ファイル操作 (倉庫/レイアウトの切替・保存) と
 * シミュレーションのタイムコントロール枠。
 */
export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const warehouse = useEditorStore((s) => s.warehouse);
  const layout = useEditorStore((s) => s.layout);
  const layouts = useEditorStore((s) => s.layouts);
  const dirty = useEditorStore((s) => s.dirty);
  const saving = useEditorStore((s) => s.saving);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const save = useEditorStore((s) => s.save);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s._past.length > 0);
  const canRedo = useEditorStore((s) => s._future.length > 0);
  const openLayout = useEditorStore((s) => s.openLayout);
  const openWarehouse = useEditorStore((s) => s.openWarehouse);
  const createLayout = useEditorStore((s) => s.createLayout);

  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);

  useEffect(() => {
    void api
      .listWarehouses()
      .then(({ warehouses: list }) => setWarehouses(list))
      .catch(() => undefined);
  }, [warehouse?.id, warehouse?.name, lastSavedAt]);

  const handleNewLayout = async (clone: boolean): Promise<void> => {
    const suggested = `レイアウト${String.fromCharCode(65 + layouts.length)}`;
    const name = window.prompt(clone ? '複製後のレイアウト名' : '新しいレイアウト名', suggested);
    if (name) await createLayout(name, clone);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">WS</span>
        <span className="brand-name">Warehouse Simulator</span>
      </div>

      <div className="topbar-group">
        <label className="field-inline">
          <span>倉庫</span>
          <select
            value={warehouse?.id ?? ''}
            onChange={(e) => void openWarehouse(e.target.value)}
            disabled={warehouses.length === 0}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}（{w.widthM}×{w.depthM}m）
              </option>
            ))}
          </select>
        </label>

        <label className="field-inline">
          <span>レイアウト</span>
          <select value={layout?.id ?? ''} onChange={(e) => void openLayout(e.target.value)}>
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <button type="button" onClick={() => void handleNewLayout(true)} title="現在のレイアウトを複製して比較案を作る">
          レイアウト複製
        </button>
        <button type="button" onClick={() => void handleNewLayout(false)}>
          新規レイアウト
        </button>
        <button type="button" onClick={onOpenSettings}>
          倉庫設定
        </button>
      </div>

      <div className="topbar-group">
        <button type="button" onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
          ↶
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="やり直す (Ctrl+Shift+Z)">
          ↷
        </button>
        <button type="button" className="primary" onClick={() => void save()} disabled={saving || !layout}>
          {saving ? '保存中…' : '保存'}
        </button>
        <span className={dirty ? 'save-state dirty' : 'save-state'}>
          {dirty ? '未保存の変更あり' : lastSavedAt ? `${lastSavedAt} に保存` : '保存済み'}
        </span>
      </div>

      <div className="topbar-group sim-controls" title="シミュレーション機能は Phase 4 で有効になります">
        <span className="sim-label">シミュレーション</span>
        <button type="button" disabled>
          ▶
        </button>
        <button type="button" disabled>
          ⏸
        </button>
        <button type="button" disabled>
          ⏹
        </button>
        <span className="sim-clock">--:--:--</span>
        <span className="badge">準備中</span>
      </div>
    </header>
  );
}
