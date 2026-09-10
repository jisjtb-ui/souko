import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { SPEED_OPTIONS, useSimulationStore } from '../store/simulationStore';
import type { WarehouseSummary } from '../api/client';
import { useEditorStore } from '../store/editorStore';

/**
 * 上部バー: ファイル操作 (倉庫/レイアウトの切替・保存) と
 * シミュレーションのタイムコントロール枠。
 */
/** シミュレーションのタイムコントロール（要件12）。 */
function SimulationControls(): JSX.Element {
  const status = useSimulationStore((s) => s.status);
  const speed = useSimulationStore((s) => s.speed);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const play = useSimulationStore((s) => s.play);
  const pause = useSimulationStore((s) => s.pause);
  const stop = useSimulationStore((s) => s.stop);
  const clock = useSimulationStore((s) => s.snapshot?.clock ?? '--:--:--');
  const snapshot = useSimulationStore((s) => s.snapshot);

  const statusLabel =
    status === 'running' ? '実行中' : status === 'paused' ? '一時停止' : status === 'finished' ? '完了' : '停止中';

  return (
    <div className="topbar-group sim-controls">
      <span className="sim-label">シミュレーション</span>
      <button type="button" onClick={play} disabled={status === 'running'} title="再生">
        ▶
      </button>
      <button type="button" onClick={pause} disabled={status !== 'running'} title="一時停止">
        ⏸
      </button>
      <button type="button" onClick={stop} disabled={status === 'idle'} title="停止（最初から）">
        ⏹
      </button>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="再生速度">
        {SPEED_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}倍速
          </option>
        ))}
      </select>
      <span className="sim-clock">{clock}</span>
      <span className={status === 'running' ? 'badge running' : 'badge'}>{statusLabel}</span>
      {snapshot && (
        <span className="sim-progress" title="入庫 / 出荷の処理本数">
          {snapshot.metrics.inboundUnits.toLocaleString()} / {snapshot.metrics.outboundUnits.toLocaleString()}
        </span>
      )}
    </div>
  );
}

export function TopBar({
  onOpenSettings,
  onOpenMasters,
}: {
  onOpenSettings: () => void;
  onOpenMasters: () => void;
}): JSX.Element {
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
        <button type="button" onClick={onOpenMasters}>
          マスタ設定
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

      <SimulationControls />
    </header>
  );
}
