import { useMemo } from 'react';
import {
  LOCATION_ADDRESS_STATUS_LABEL,
  getObjectSpec,
  isEmptyRackYardObject,
  isForkliftObject,
  isInboundGateObject,
  isOutboundGateObject,
  isRackObject,
  summarizeLocationAddresses,
} from '@ws/shared';
import type { LayoutObject, Location, RackObject } from '@ws/shared';
import {
  computeAreaStatsList,
  computeStats,
  computeTotalArea,
  findOutOfBounds,
  selectSelectedObject,
  useEditorStore,
} from '../store/editorStore';
import { useDeferredValue, useState } from 'react';
import { AreaInspector, ConnectionInspector } from './AreaInspector';
import { SimulationPanel } from './SimulationPanel';
import { EmptyRackYardInspector, InboundGateInspector, OutboundGateInspector } from './GateInspector';
import { api } from '../api/client';
import { useSimulationStore } from '../store/simulationStore';

/** 右サイドの情報パネル: 選択中オブジェクトの詳細と倉庫サマリー。 */
export function Inspector(): JSX.Element {
  const selected = useEditorStore(selectSelectedObject);
  const selectedCount = useEditorStore((s) => s.selectedIds.length);
  const objects = useEditorStore((s) => s.objects);
  const locations = useEditorStore((s) => s.locations);
  const warehouse = useEditorStore((s) => s.warehouse);
  const layout = useEditorStore((s) => s.layout);

  const areas = useEditorStore((s) => s.areas);
  const connections = useEditorStore((s) => s.connections);
  const selectedAreaId = useEditorStore((s) => s.selectedAreaId);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const selectArea = useEditorStore((s) => s.selectArea);

  /*
   * 集計は全ロケーションを走査するため、ドラッグ中に毎フレーム回すと重い。
   * useDeferredValue で低優先度にし、操作が落ち着いてから計算させる。
   * （表示される値そのものは変わらない）
   */
  const deferredObjects = useDeferredValue(objects);
  const deferredLocations = useDeferredValue(locations);
  const deferredAreas = useDeferredValue(areas);

  const stats = useMemo(
    () => computeStats(deferredObjects, deferredLocations, warehouse),
    [deferredObjects, deferredLocations, warehouse],
  );
  const outOfBounds = useMemo(
    () => findOutOfBounds(deferredObjects, warehouse),
    [deferredObjects, warehouse],
  );
  const areaStats = useMemo(
    () => computeAreaStatsList(deferredAreas, deferredObjects, deferredLocations),
    [deferredAreas, deferredObjects, deferredLocations],
  );
  const totalAreaM2 = useMemo(() => computeTotalArea(deferredAreas), [deferredAreas]);
  const selectedArea = areas.find((a) => a.id === selectedAreaId);
  const selectedConnection = connections.find((c) => c.id === selectedConnectionId);

  const [tab, setTab] = useState<'layout' | 'sim'>('layout');

  return (
    <aside className="inspector">
      <div className="tab-row inspector-tabs">
        <button type="button" className={tab === 'layout' ? 'tab active' : 'tab'} onClick={() => setTab('layout')}>
          レイアウト
        </button>
        <button type="button" className={tab === 'sim' ? 'tab active' : 'tab'} onClick={() => setTab('sim')}>
          シミュレーション
        </button>
      </div>

      {tab === 'sim' ? (
        <SimulationPanel />
      ) : (
        <>
      {selectedArea ? (
        <AreaInspector area={selectedArea} />
      ) : selectedConnection ? (
        <ConnectionInspector connection={selectedConnection} />
      ) : selected ? (
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
        <div className="panel-title">倉庫全体（エリア {areas.length}）</div>
        <dl className="stat-grid">
          <div>
            <dt>倉庫総面積</dt>
            <dd>{totalAreaM2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ㎡</dd>
          </div>
          <div>
            <dt>接続口</dt>
            <dd>{connections.length} 箇所</dd>
          </div>
        </dl>
        <div className="area-list">
          {areaStats.map((stat) => (
            <button
              key={stat.areaId}
              type="button"
              className={stat.areaId === selectedAreaId ? 'list-row-button active' : 'list-row-button'}
              onClick={() => selectArea(stat.areaId)}
            >
              <span>{stat.name}</span>
              <span className="muted small">{stat.sizeM2.toFixed(0)} ㎡</span>
              <span className="muted small">ロケ {stat.locationCount}</span>
            </button>
          ))}
        </div>
        <p className="muted small">重なっているエリアは総面積で二重計上しません。</p>
      </div>

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
        </>
      )}
    </aside>
  );
}

function ObjectInspector({ object }: { object: LayoutObject }): JSX.Element {
  if (isInboundGateObject(object)) return <GateWrapper object={object}><InboundGateInspector gate={object} /></GateWrapper>;
  if (isOutboundGateObject(object)) return <GateWrapper object={object}><OutboundGateInspector gate={object} /></GateWrapper>;
  if (isEmptyRackYardObject(object)) return <GateWrapper object={object}><EmptyRackYardInspector yard={object} /></GateWrapper>;
  return <GenericObjectInspector object={object} />;
}

/** ゲート系オブジェクトの共通操作（位置・サイズ・削除）を設定パネルに添える。 */
function GateWrapper({ object, children }: { object: LayoutObject; children: React.ReactNode }): JSX.Element {
  const updateObject = useEditorStore((s) => s.updateObject);
  const commit = useEditorStore((s) => s.commitObjectChange);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const rotateSelected = useEditorStore((s) => s.rotateSelected);
  const areas = useEditorStore((s) => s.areas);
  const area = areas.find((a) => a.id === object.areaId);

  return (
    <>
      {children}
      <div className="panel-block">
        <div className="panel-title">配置</div>
        <div className="field-grid">
          {(['x', 'y', 'widthM', 'depthM'] as const).map((key) => (
            <label className="field" key={key}>
              <span>{{ x: 'X (m)', y: 'Y (m)', widthM: '幅 (m)', depthM: '奥行 (m)' }[key]}</span>
              <input
                type="number"
                step={0.5}
                value={Number(object[key].toFixed(2))}
                onChange={(e) => updateObject(object.id, { [key]: Number(e.target.value) })}
                onBlur={() => commit('配置を変更しました')}
              />
            </label>
          ))}
        </div>
        <p className="muted small">所属エリア: {area?.name ?? '（エリア外）'}</p>
        <div className="btn-row">
          <button type="button" onClick={() => rotateSelected(90)}>
            90°回転
          </button>
          <button type="button" onClick={duplicateSelected}>
            複製
          </button>
          <button type="button" className="danger" onClick={deleteSelected}>
            削除
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * 自動生成したロケーション住所 (001-1 など) の内訳。
 *
 * 「住所」と「物理列 × 段」を分けて見せる。
 * 在庫はシミュレーション結果があればそれを反映し、無ければ「空」。
 */
function LocationAddressBlock({
  object,
  locations,
}: {
  object: RackObject;
  locations: readonly Location[];
}): JSX.Element {
  const snapshot = useSimulationStore((s) => s.snapshot);
  const productSizes = useEditorStore((s) => s.productSizes);

  const view = useMemo(() => {
    const inventory = snapshot
      ? {
          occupancy: snapshot.occupancy,
          rackUnits: new Map(snapshot.rackUnits.map((u) => [u.id, u])),
        }
      : undefined;
    return summarizeLocationAddresses([object], locations, inventory)[0];
  }, [object, locations, snapshot]);

  if (!view) return <></>;

  const sizeLabel = view.productSizeIds
    .map((id) => productSizes.find((p) => p.id === id)?.code ?? id)
    .join(' / ');

  return (
    <div className="sub-block">
      <div className="sub-title">
        ロケーション {view.locationCode}
        <span className={`loc-status loc-status-${view.status}`}>
          {LOCATION_ADDRESS_STATUS_LABEL[view.status]}
        </span>
      </div>
      <dl className="stat-grid compact">
        <div>
          <dt>内部構造</dt>
          <dd>
            {view.columns} 列 × {view.levels} 段 = {view.slots.length} 箇所
          </dd>
        </div>
        <div>
          <dt>最大容量</dt>
          <dd>{view.capacity.toLocaleString()} 本</dd>
        </div>
        <div>
          <dt>現在在庫</dt>
          <dd>{view.currentQuantity.toLocaleString()} 本</dd>
        </div>
        <div>
          <dt>空き容量</dt>
          <dd>{view.freeCapacity.toLocaleString()} 本</dd>
        </div>
        <div>
          <dt>使用率</dt>
          <dd>{(view.usageRatio * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>商品サイズ</dt>
          <dd>{sizeLabel || '—'}</dd>
        </div>
      </dl>
      <p className="muted small">
        {object.rack.block?.singleSize
          ? 'この住所には1つの商品サイズだけを入れます（縦列すべて同じサイズ）。'
          : 'この住所には複数の商品サイズを入れられます。'}
      </p>
    </div>
  );
}

function GenericObjectInspector({ object }: { object: LayoutObject }): JSX.Element {
  const spec = getObjectSpec(object.kind);
  const updateObject = useEditorStore((s) => s.updateObject);
  const commit = useEditorStore((s) => s.commitObjectChange);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const rotateSelected = useEditorStore((s) => s.rotateSelected);
  const openRackDraft = useEditorStore((s) => s.openRackDraft);
  const locations = useEditorStore((s) => s.locations);

  // 一覧も全ロケーション走査になるため、ドラッグ中は遅延させる
  const deferredLocations = useDeferredValue(locations);
  const rackLocations = useMemo(
    () =>
      deferredLocations
        .filter((l) => l.rackId === object.id)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [deferredLocations, object.id],
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

      {isRackObject(object) && object.rack.block && (
        <LocationAddressBlock object={object} locations={rackLocations} />
      )}

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
