import { useMemo } from 'react';
import {
  areaBounds,
  areaSizeM2,
  computeAreaStats,
  findShutter,
  isConnectionPassable,
} from '@ws/shared';
import type { Area, AreaConnection, AreaKind } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';

const AREA_KIND_LABEL: Record<AreaKind, string> = {
  building: '建屋',
  extension: '増築部分',
  'outdoor-yard': '屋外ヤード',
  mezzanine: '中2階',
};

/** エリアを選択したときのプロパティパネル。 */
export function AreaInspector({ area }: { area: Area }): JSX.Element {
  const objects = useEditorStore((s) => s.objects);
  const locations = useEditorStore((s) => s.locations);
  const connections = useEditorStore((s) => s.connections);
  const areas = useEditorStore((s) => s.areas);
  const updateArea = useEditorStore((s) => s.updateArea);
  const deleteArea = useEditorStore((s) => s.deleteArea);
  const duplicateArea = useEditorStore((s) => s.duplicateArea);
  const beginConnect = useEditorStore((s) => s.beginConnect);
  const scaleArea = useEditorStore((s) => s.scaleArea);
  const setTool = useEditorStore((s) => s.setTool);
  const selectConnection = useEditorStore((s) => s.selectConnection);

  const stats = useMemo(
    () => computeAreaStats(area, objects, locations),
    [area, objects, locations],
  );
  const bounds = useMemo(() => areaBounds(area), [area]);
  const related = connections.filter((c) => c.fromAreaId === area.id || c.toAreaId === area.id);
  const areaNameById = new Map(areas.map((a) => [a.id, a.name]));

  return (
    <div className="panel-block">
      <div className="panel-title">
        <span className="swatch" style={{ background: '#ffffff', borderColor: '#3d4854' }} />
        エリア（{area.type === 'rect' ? '矩形' : `多角形 ${area.polygon.length}頂点`}）
      </div>

      <label className="field">
        <span>エリア名</span>
        <input
          value={area.name}
          onChange={(e) => updateArea(area.id, { name: e.target.value })}
          onBlur={() => useEditorStore.getState().commitObjectChange('エリア名を変更しました')}
        />
      </label>

      <label className="field">
        <span>種別</span>
        <select value={area.kind} onChange={(e) => updateArea(area.id, { kind: e.target.value as AreaKind })}>
          {(Object.keys(AREA_KIND_LABEL) as AreaKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {AREA_KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </label>

      <div className="field-grid">
        <label className="field">
          <span>X (m)</span>
          <input
            type="number"
            step={0.5}
            value={Number(area.x.toFixed(2))}
            onChange={(e) => updateArea(area.id, { x: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Y (m)</span>
          <input
            type="number"
            step={0.5}
            value={Number(area.y.toFixed(2))}
            onChange={(e) => updateArea(area.id, { y: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>回転 (°)</span>
          <input
            type="number"
            step={15}
            value={Number(area.rotationDeg.toFixed(1))}
            onChange={(e) => updateArea(area.id, { rotationDeg: Number(e.target.value) })}
          />
        </label>
        {area.type === 'rect' && (
          <>
            <label className="field">
              <span>幅 (m)</span>
              <input
                type="number"
                step={0.5}
                min={0.5}
                value={Number(bounds.widthM.toFixed(2))}
                onChange={(e) => resizeRect(area, Number(e.target.value), undefined, updateArea)}
              />
            </label>
            <label className="field">
              <span>奥行 (m)</span>
              <input
                type="number"
                step={0.5}
                min={0.5}
                value={Number(bounds.depthM.toFixed(2))}
                onChange={(e) => resizeRect(area, undefined, Number(e.target.value), updateArea)}
              />
            </label>
          </>
        )}
      </div>

      <dl className="stat-grid compact">
        <div>
          <dt>面積</dt>
          <dd>{areaSizeM2(area).toFixed(1)} ㎡</dd>
        </div>
        <div>
          <dt>外接サイズ</dt>
          <dd>
            {bounds.widthM.toFixed(1)} × {bounds.depthM.toFixed(1)} m
          </dd>
        </div>
        <div>
          <dt>ラック</dt>
          <dd>{stats.rackCount} 本</dd>
        </div>
        <div>
          <dt>ロケーション</dt>
          <dd>{stats.locationCount} 箇所</dd>
        </div>
        <div>
          <dt>収納可能数</dt>
          <dd>{stats.capacity.toLocaleString()}</dd>
        </div>
        <div>
          <dt>在庫数</dt>
          <dd>{stats.inventoryUnits.toLocaleString()}</dd>
        </div>
        <div>
          <dt>ゲート</dt>
          <dd>{stats.gateCount} 箇所</dd>
        </div>
        <div>
          <dt>フォークリフト</dt>
          <dd>{stats.forkliftCount} 台</dd>
        </div>
      </dl>

      <div className="btn-row">
        <span className="muted small">拡大縮小</span>
        <button type="button" onClick={() => scaleArea(area.id, 1.1)} title="10%拡大">
          ＋10%
        </button>
        <button type="button" onClick={() => scaleArea(area.id, 1 / 1.1)} title="10%縮小">
          −10%
        </button>
      </div>

      <div className="btn-row">
        <button
          type="button"
          onClick={() => {
            setTool('connect');
            beginConnect(area.id);
          }}
        >
          接続を追加
        </button>
        <button type="button" onClick={() => duplicateArea(area.id)}>
          複製
        </button>
        <button type="button" className="danger" onClick={() => deleteArea(area.id)}>
          削除
        </button>
      </div>

      <p className="muted small">
        頂点をドラッグすると形状を変更できます（右クリックで頂点を削除）。多角形にすると L字・コの字なども作れます。
      </p>

      <div className="sub-block">
        <div className="sub-title">接続口 ({related.length})</div>
        {related.length === 0 && <p className="muted small">接続口がありません。隣のエリアへは通行できません。</p>}
        {related.map((connection) => (
          <button
            key={connection.id}
            type="button"
            className="list-row-button"
            onClick={() => selectConnection(connection.id)}
          >
            <span>
              {connection.fromAreaId === area.id
                ? `→ ${areaNameById.get(connection.toAreaId) ?? '?'}`
                : `← ${areaNameById.get(connection.fromAreaId) ?? '?'}`}
            </span>
            <span className="muted small">幅 {connection.widthM}m</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 矩形エリアのサイズ変更（4頂点を作り直す）。 */
function resizeRect(
  area: Area,
  widthM: number | undefined,
  depthM: number | undefined,
  updateArea: (id: string, patch: Partial<Area>) => void,
): void {
  const bounds = areaBounds(area);
  const w = Math.max(0.5, widthM ?? bounds.widthM);
  const d = Math.max(0.5, depthM ?? bounds.depthM);
  updateArea(area.id, {
    polygon: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ],
  });
}

/** 接続口を選択したときのプロパティパネル。 */
export function ConnectionInspector({ connection }: { connection: AreaConnection }): JSX.Element {
  const areas = useEditorStore((s) => s.areas);
  const shutters = useEditorStore((s) => s.shutters);
  const updateConnection = useEditorStore((s) => s.updateConnection);
  const deleteConnection = useEditorStore((s) => s.deleteConnection);
  const addShutter = useEditorStore((s) => s.addShutter);
  const toggleShutter = useEditorStore((s) => s.toggleShutter);
  const removeShutter = useEditorStore((s) => s.removeShutter);
  const selectArea = useEditorStore((s) => s.selectArea);

  const shutter = findShutter(connection.id, shutters);
  const passable = isConnectionPassable(connection, shutters);
  const from = areas.find((a) => a.id === connection.fromAreaId);
  const to = areas.find((a) => a.id === connection.toAreaId);

  return (
    <div className="panel-block">
      <div className="panel-title">
        <span className="swatch" style={{ background: passable ? '#cdebd9' : '#f6d2cd', borderColor: passable ? '#2f9e5f' : '#c0392b' }} />
        接続口
      </div>

      <label className="field">
        <span>名称</span>
        <input
          value={connection.name}
          onChange={(e) => updateConnection(connection.id, { name: e.target.value })}
        />
      </label>

      <div className="btn-row">
        <button type="button" onClick={() => from && selectArea(from.id)}>
          {from?.name ?? '?'}
        </button>
        <span className="muted">⇔</span>
        <button type="button" onClick={() => to && selectArea(to.id)}>
          {to?.name ?? '?'}
        </button>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>X (m)</span>
          <input
            type="number"
            step={0.5}
            value={Number(connection.x.toFixed(2))}
            onChange={(e) => updateConnection(connection.id, { x: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Y (m)</span>
          <input
            type="number"
            step={0.5}
            value={Number(connection.y.toFixed(2))}
            onChange={(e) => updateConnection(connection.id, { y: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>開口幅 (m)</span>
          <input
            type="number"
            step={0.5}
            min={0.5}
            value={connection.widthM}
            onChange={(e) => updateConnection(connection.id, { widthM: Math.max(0.5, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>厚み (m)</span>
          <input
            type="number"
            step={0.5}
            min={0.5}
            value={connection.spanM}
            onChange={(e) => updateConnection(connection.id, { spanM: Math.max(0.5, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>角度 (°)</span>
          <input
            type="number"
            step={15}
            value={Number(connection.rotationDeg.toFixed(1))}
            onChange={(e) => updateConnection(connection.id, { rotationDeg: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>種類</span>
          <select
            value={connection.type}
            onChange={(e) =>
              updateConnection(connection.id, { type: e.target.value as AreaConnection['type'] })
            }
          >
            <option value="opening">開口</option>
            <option value="shutter">シャッター</option>
            <option value="door">扉</option>
            <option value="corridor">連絡通路</option>
          </select>
        </label>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={connection.passable}
          onChange={(e) => updateConnection(connection.id, { passable: e.target.checked }, { commit: true })}
        />
        通行可能
      </label>

      <div className="sub-block">
        <div className="sub-title">シャッター</div>
        {shutter ? (
          <>
            <div className={shutter.state === 'open' ? 'shutter-state open' : 'shutter-state closed'}>
              {shutter.name}：{shutter.state === 'open' ? '開（通行可）' : '閉（通行不可）'}
            </div>
            <div className="btn-row">
              <button type="button" className="primary" onClick={() => toggleShutter(connection.id)}>
                {shutter.state === 'open' ? '閉じる' : '開ける'}
              </button>
              <button type="button" onClick={() => removeShutter(connection.id)}>
                撤去
              </button>
            </div>
            <p className="muted small">
              シャッターを閉じると、この接続口を通る経路が探索されなくなります（フォークリフトは通過できません）。
            </p>
          </>
        ) : (
          <>
            <p className="muted small">この接続口は常時開放されています。</p>
            <button type="button" onClick={() => addShutter(connection.id)}>
              シャッターを設置
            </button>
          </>
        )}
      </div>

      <div className="btn-row">
        <button type="button" className="danger" onClick={() => deleteConnection(connection.id)}>
          接続口を削除
        </button>
      </div>
    </div>
  );
}
