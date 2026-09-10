import { useState } from 'react';
import type { GridSizeM } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';

/** 倉庫の実寸・縮尺・グリッド・制限速度の設定。 */
export function WarehouseDialog({ onClose }: { onClose: () => void }): JSX.Element | null {
  const warehouse = useEditorStore((s) => s.warehouse);
  const update = useEditorStore((s) => s.updateWarehouseSettings);
  const createWarehouse = useEditorStore((s) => s.createWarehouse);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('新しい倉庫');
  const [newWidth, setNewWidth] = useState(100);
  const [newDepth, setNewDepth] = useState(80);

  if (!warehouse) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>倉庫設定</h2>
        <p className="muted">実際の倉庫の寸法を入力してください。画面の縮尺は 1m あたりのピクセル数で決まります。</p>

        <label className="field">
          <span>倉庫名</span>
          <input value={warehouse.name} onChange={(e) => update({ name: e.target.value })} />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>幅 (m)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={warehouse.widthM}
              onChange={(e) => update({ widthM: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <label className="field">
            <span>奥行 (m)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={warehouse.depthM}
              onChange={(e) => update({ depthM: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <label className="field">
            <span>縮尺 (1m = ? px)</span>
            <input
              type="number"
              min={1}
              max={80}
              value={warehouse.pixelsPerMeter}
              onChange={(e) => update({ pixelsPerMeter: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <label className="field">
            <span>グリッド</span>
            <select
              value={warehouse.gridSizeM}
              onChange={(e) => update({ gridSizeM: Number(e.target.value) as GridSizeM })}
            >
              <option value={1}>1 m</option>
              <option value={0.5}>0.5 m</option>
              <option value={0.25}>0.25 m</option>
              <option value={0.1}>0.1 m</option>
            </select>
          </label>
          <label className="field">
            <span>構内制限速度 (km/h)</span>
            <select
              value={warehouse.speedLimitKmh}
              onChange={(e) => update({ speedLimitKmh: Number(e.target.value) })}
            >
              {[2, 5, 8, 10, 12].map((v) => (
                <option key={v} value={v}>
                  {v} km/h
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="sub-block">
          <button type="button" className="link" onClick={() => setCreating((v) => !v)}>
            {creating ? '▾ 新しい倉庫の作成を閉じる' : '▸ 新しい倉庫を作る'}
          </button>
          {creating && (
            <>
              <div className="field-grid">
                <label className="field">
                  <span>倉庫名</span>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} />
                </label>
                <label className="field">
                  <span>幅 (m)</span>
                  <input type="number" value={newWidth} onChange={(e) => setNewWidth(Number(e.target.value))} />
                </label>
                <label className="field">
                  <span>奥行 (m)</span>
                  <input type="number" value={newDepth} onChange={(e) => setNewDepth(Number(e.target.value))} />
                </label>
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  onClick={() => {
                    void createWarehouse({ name: newName, widthM: newWidth, depthM: newDepth });
                    onClose();
                  }}
                >
                  空の倉庫を作成
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void createWarehouse({ name: `${newName}（サンプル）`, sample: true });
                    onClose();
                  }}
                >
                  サンプル倉庫を作成
                </button>
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </div>
        <p className="muted small">サイズの変更は「保存」で確定します。</p>
      </div>
    </div>
  );
}
