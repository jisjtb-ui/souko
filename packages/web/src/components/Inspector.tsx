import { useMemo } from 'react';
import { getObjectSpec, isForkliftObject, isRackObject } from '@ws/shared';
import type { LayoutObject } from '@ws/shared';
import { computeStats, findOutOfBounds, selectSelectedObject, useEditorStore } from '../store/editorStore';
import { api } from '../api/client';

/** 右サイドの情報パネル: 選択中オブジェクトの詳細と倉庫サマリー。 */
export function Inspector(): JSX.Element {
  const selected = useEditorStore(selectSelectedObject);
  const selectedCount = useEditorStore((s) => s.selectedIds.length);
  const objects = useEditorStore((s) => s.objects);
  const locations = useEditorStore((s) => s.locations);
  const warehouse = useEditorStore((s) => s.warehouse);
  const layout = useEditorStore((s) => s.layout);

  const stats = useMemo(() => computeStats(objects, locations, warehouse), [objects, locations, warehouse]);
  const outOfBounds = useMemo(() => findOutOfBounds(objects, warehouse), [objects, warehouse]);

  return (
    <aside className="inspector">
      {selected ? (
        <ObjectInspector object={selected} />
      ) : (
        <div className="panel-block">
          <div className="panel-title">選択中のオブジェクト</div>
          <p className="muted">
            {selectedCount > 1
              ? `${selectedCount}件を選択中です（Deleteで削除 / Ctrl+Dで複製）`
              : 'マップ上のオブジェクトをクリックすると、ここに詳細が表示されます。'}
          </p>
        </div>
      )}

      <div className="panel-block">
        <div className="panel-title">倉庫サマリー</div>
        <dl className="stat-grid">
          <div>
            <dt>ラック</dt>
            <dd>{stats.rackCount} 本</dd>
          </div>
          <div>
            <dt>ロケーション</dt>
            <dd>{stats.locationCount.toLocaleString()} 箇所</dd>
          </div>
          <div>
            <dt>総収納可能数</dt>
            <dd>{stats.totalCapacity.toLocaleString()}</dd>
          </div>
          <div>
            <dt>フォークリフト</dt>
            <dd>{stats.forkliftCount} 台</dd>
          </div>
          <div>
            <dt>床面積</dt>
            <dd>{stats.floorAreaM2.toLocaleString()} ㎡</dd>
          </div>
          <div>
            <dt>ラック占有率</dt>
            <dd>{stats.floorAreaM2 > 0 ? ((stats.rackAreaM2 / stats.floorAreaM2) * 100).toFixed(1) : '0.0'} %</dd>
          </div>
        </dl>
      </div>

      {(stats.duplicateCodes > 0 || outOfBounds.length > 0) && (
        <div className="panel-block warn-block">
          <div className="panel-title">確認が必要です</div>
          {stats.duplicateCodes > 0 && (
            <p className="warn">ロケーション番号が {stats.duplicateCodes} 件重複しています（エリア記号を変えてください）</p>
          )}
          {outOfBounds.length > 0 && (
            <p className="warn">倉庫の外にはみ出した配置が {outOfBounds.length} 件あります</p>
          )}
        </div>
      )}

      <div className="panel-block">
        <div className="panel-title">エクスポート</div>
        <div className="btn-row">
          <a className="btn" href={layout ? api.exportUrl(layout.id, 'locations') : '#'} download>
            ロケーションCSV
          </a>
          <a className="btn" href={layout ? api.exportUrl(layout.id, 'objects') : '#'} download>
            配置CSV
          </a>
          <a className="btn" href={layout ? api.exportUrl(layout.id, 'json') : '#'} download>
            JSON
          </a>
        </div>
        <p className="muted small">保存済みの内容が出力されます。</p>
      </div>
    </aside>
  );
}

function ObjectInspector({ object }: { object: LayoutObject }): JSX.Element {
  const spec = getObjectSpec(object.kind);
  const updateObject = useEditorStore((s) => s.updateObject);
  const commit = useEditorStore((s) => s.commitObjectChange);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const rotateSelected = useEditorStore((s) => s.rotateSelected);
  const openRackDraft = useEditorStore((s) => s.openRackDraft);
  const locations = useEditorStore((s) => s.locations);

  const rackLocations = useMemo(
    () => locations.filter((l) => l.rackId === object.id).sort((a, b) => a.code.localeCompare(b.code)),
    [locations, object.id],
  );

  const num = (key: 'x' | 'y' | 'widthM' | 'depthM' | 'rotationDeg', label: string, step = 0.1): JSX.Element => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(object[key].toFixed(2))}
        onChange={(e) => updateObject(object.id, { [key]: Number(e.target.value) })}
        onBlur={() => commit(`${object.name} の${label}を変更しました`)}
      />
    </label>
  );

  return (
    <div className="panel-block">
      <div className="panel-title">
        <span className="swatch" style={{ background: spec.fill, borderColor: spec.stroke }} />
        {spec.label}
      </div>

      <label className="field">
        <span>名称</span>
        <input
          value={object.name}
          onChange={(e) => updateObject(object.id, { name: e.target.value })}
          onBlur={() => commit('名称を変更しました')}
        />
      </label>

      <div className="field-grid">
        {num('x', 'X (m)')}
        {num('y', 'Y (m)')}
        {num('widthM', '幅 (m)')}
        {num('depthM', '奥行 (m)')}
        {num('rotationDeg', '回転 (°)', 15)}
      </div>

      <div className="btn-row">
        <button type="button" onClick={() => rotateSelected(90)}>
          90°回転 (R)
        </button>
        <button type="button" onClick={duplicateSelected}>
          複製 (Ctrl+D)
        </button>
        <button type="button" className="danger" onClick={deleteSelected}>
          削除 (Del)
        </button>
      </div>

      {isRackObject(object) && (
        <div className="sub-block">
          <div className="sub-title">ラック設定</div>
          <dl className="stat-grid compact">
            <div>
              <dt>列数 × 段数</dt>
              <dd>
                {object.rack.columns} × {object.rack.levels}
              </dd>
            </div>
            <div>
              <dt>エリア記号</dt>
              <dd>{object.rack.naming.area}</dd>
            </div>
            <div>
              <dt>ロケーション</dt>
              <dd>{rackLocations.length} 箇所</dd>
            </div>
            <div>
              <dt>最大収納数</dt>
              <dd>{object.rack.capacityPerLocation} / 箇所</dd>
            </div>
            <div>
              <dt>間口幅</dt>
              <dd>{(object.widthM / Math.max(1, object.rack.columns)).toFixed(2)} m</dd>
            </div>
            <div>
              <dt>ピッキング面</dt>
              <dd>{object.rack.face === 'back' ? '奥側' : object.rack.face === 'both' ? '両面' : '手前側'}</dd>
            </div>
          </dl>
          <button type="button" className="primary wide" onClick={() => openRackDraft(object, false)}>
            ラック設定・ロケーション再生成
          </button>

          <div className="sub-title">ロケーション一覧</div>
          <div className="location-list">
            {rackLocations.slice(0, 200).map((loc) => (
              <div key={loc.id} className="location-row">
                <span className="code">{loc.code}</span>
                <span className="muted small">
                  {loc.column}列 {loc.level}段
                </span>
                <span className="muted small">最大 {loc.capacity}</span>
              </div>
            ))}
            {rackLocations.length > 200 && <div className="muted small">…ほか {rackLocations.length - 200} 件</div>}
          </div>
        </div>
      )}

      {isForkliftObject(object) && (
        <div className="sub-block">
          <div className="sub-title">フォークリフト設定</div>
          <label className="field">
            <span>最大速度 (km/h)</span>
            <select
              value={object.forklift.maxSpeedKmh}
              onChange={(e) =>
                updateObject(object.id, {
                  forklift: { ...object.forklift, maxSpeedKmh: Number(e.target.value) },
                } as Partial<LayoutObject>)
              }
            >
              {[2, 5, 8, 10, 12].map((v) => (
                <option key={v} value={v}>
                  {v} km/h
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>最大積載重量 (kg)</span>
            <input
              type="number"
              step={100}
              value={object.forklift.maxPayloadKg}
              onChange={(e) =>
                updateObject(object.id, {
                  forklift: { ...object.forklift, maxPayloadKg: Number(e.target.value) },
                } as Partial<LayoutObject>)
              }
              onBlur={() => commit('積載重量を変更しました')}
            />
          </label>
          <p className="muted small">加減速や荷役時間はシミュレーション（Phase 3以降）で使用します。</p>
        </div>
      )}
    </div>
  );
}
