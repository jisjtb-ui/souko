import { HEATMAP_LAYERS, HEATMAP_LAYER_META, OBJECT_SPEC_LIST } from '@ws/shared';
import type { HeatmapLayerKey, LayoutObjectKind } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';
import { useSimulationStore } from '../store/simulationStore';
import { HeatmapLegend } from './HeatmapLegend';

const GROUPS: { key: string; label: string }[] = [
  { key: 'storage', label: '保管設備' },
  { key: 'logistics', label: '入出荷設備' },
  { key: 'structure', label: '構造物' },
  { key: 'area', label: '区域' },
  { key: 'equipment', label: '車両' },
];

/**
 * 左サイドのツールバー。
 * クリックして配置、またはマップへドラッグ＆ドロップで配置できる。
 */
/**
 * ヒートマップの表示切替 (要件14)。
 * シミュレーションの走行データが無いうちは操作できないようにする。
 */
function HeatmapControls(): JSX.Element {
  const options = useEditorStore((s) => s.options);
  const setOption = useEditorStore((s) => s.setOption);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const hasData = Boolean(snapshot && snapshot.heatmap.maxOf('traffic') > 0);
  const current = options.heatmapLayer;

  return (
    <div className="panel-block">
      <div className="panel-title">ヒートマップ</div>
      <div className="heat-tabs">
        <button
          type="button"
          className={current === null ? 'heat-tab active' : 'heat-tab'}
          onClick={() => setOption('heatmapLayer', null)}
        >
          なし
        </button>
        {HEATMAP_LAYERS.map((layer: HeatmapLayerKey) => (
          <button
            key={layer}
            type="button"
            className={current === layer ? 'heat-tab active' : 'heat-tab'}
            disabled={!hasData}
            title={HEATMAP_LAYER_META[layer].description}
            onClick={() => setOption('heatmapLayer', layer)}
          >
            {HEATMAP_LAYER_META[layer].label}
          </button>
        ))}
      </div>

      {!hasData && <p className="muted small">シミュレーションを実行すると表示できます。</p>}
      {hasData && current && snapshot && (
        <>
          <HeatmapLegend layer={current} heatmap={snapshot.heatmap} />
          <p className="muted small">{HEATMAP_LAYER_META[current].description}</p>
        </>
      )}
    </div>
  );
}

export function Toolbar(): JSX.Element {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const placingKind = useEditorStore((s) => s.placingKind);
  const setPlacingKind = useEditorStore((s) => s.setPlacingKind);
  const options = useEditorStore((s) => s.options);
  const setOption = useEditorStore((s) => s.setOption);
  const startPolygonArea = useEditorStore((s) => s.startPolygonArea);
  const polygonDraft = useEditorStore((s) => s.polygonDraft);
  const finishPolygonArea = useEditorStore((s) => s.finishPolygonArea);
  const cancelPolygonArea = useEditorStore((s) => s.cancelPolygonArea);
  const areaCount = useEditorStore((s) => s.areas.length);
  const connectionCount = useEditorStore((s) => s.connections.length);

  const pick = (kind: LayoutObjectKind): void => {
    setPlacingKind(placingKind === kind ? null : kind);
  };

  return (
    <aside className="toolbar">
      <div className="panel-block">
        <div className="panel-title">操作</div>
        <div className="tool-row">
          <button type="button" className={tool === 'select' ? 'tool active' : 'tool'} onClick={() => setTool('select')}>
            ⬚ 選択
          </button>
          <button type="button" className={tool === 'pan' ? 'tool active' : 'tool'} onClick={() => setTool('pan')}>
            ✋ 移動
          </button>
          <button type="button" className={tool === 'route' ? 'tool active' : 'tool'} onClick={() => setTool('route')}>
            ➜ 経路確認
          </button>
        </div>
      </div>

      <div className="panel-block">
        <div className="panel-title">倉庫の形（エリア {areaCount} / 接続 {connectionCount}）</div>
        <div className="tool-row">
          <button
            type="button"
            className={tool === 'area-rect' ? 'tool active' : 'tool'}
            onClick={() => setTool(tool === 'area-rect' ? 'select' : 'area-rect')}
            title="ドラッグして矩形エリアを追加します"
          >
            ▭ 矩形
          </button>
          <button
            type="button"
            className={tool === 'area-polygon' ? 'tool active' : 'tool'}
            onClick={() => (tool === 'area-polygon' ? cancelPolygonArea() : startPolygonArea())}
            title="クリックで頂点を追加し、始点をクリックすると確定します"
          >
            ⬟ 多角形
          </button>
        </div>
        <div className="tool-row">
          <button
            type="button"
            className={tool === 'connect' ? 'tool active' : 'tool'}
            onClick={() => setTool(tool === 'connect' ? 'select' : 'connect')}
            title="2つのエリアを順にクリックすると接続口を作ります"
          >
            ⇔ 接続口を追加
          </button>
        </div>
        {tool === 'area-polygon' && (
          <div className="draft-hint">
            <span>
              頂点 {polygonDraft?.length ?? 0} 個
              {(polygonDraft?.length ?? 0) >= 3 ? ' — 始点クリック / Enter で確定' : ' — 3点以上必要です'}
            </span>
            <div className="btn-row">
              <button type="button" onClick={finishPolygonArea} disabled={(polygonDraft?.length ?? 0) < 3}>
                確定
              </button>
              <button type="button" onClick={cancelPolygonArea}>
                取消 (Esc)
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel-block scroll">
        <div className="panel-title">配置する（クリック / ドラッグ）</div>
        {GROUPS.map((group) => (
          <div key={group.key} className="palette-group">
            <div className="palette-group-label">{group.label}</div>
            {OBJECT_SPEC_LIST.filter((spec) => spec.group === group.key).map((spec) => (
              <button
                key={spec.kind}
                type="button"
                className={placingKind === spec.kind ? 'palette-item active' : 'palette-item'}
                title={spec.hint}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-ws-kind', spec.kind);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => pick(spec.kind)}
              >
                <span className="swatch" style={{ background: spec.fill, borderColor: spec.stroke }} />
                <span className="palette-label">{spec.label}</span>
                <span className="palette-size">
                  {spec.defaultWidthM}×{spec.defaultDepthM}m
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <HeatmapControls />

      <div className="panel-block">
        <div className="panel-title">表示</div>
        <label className="check">
          <input type="checkbox" checked={options.showGrid} onChange={(e) => setOption('showGrid', e.target.checked)} />
          グリッド
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={options.snapToGrid}
            onChange={(e) => setOption('snapToGrid', e.target.checked)}
          />
          グリッドに合わせる
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={options.showLocations}
            onChange={(e) => setOption('showLocations', e.target.checked)}
          />
          ロケーション枠
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={options.showLocationCodes}
            onChange={(e) => setOption('showLocationCodes', e.target.checked)}
          />
          ロケーション番号
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={options.showObstacles}
            onChange={(e) => setOption('showObstacles', e.target.checked)}
          />
          走行不可エリア
        </label>
      </div>
    </aside>
  );
}
