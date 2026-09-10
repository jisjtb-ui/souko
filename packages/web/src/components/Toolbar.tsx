import { OBJECT_SPEC_LIST } from '@ws/shared';
import type { LayoutObjectKind } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';

const GROUPS: { key: string; label: string }[] = [
  { key: 'storage', label: '保管設備' },
  { key: 'structure', label: '構造物' },
  { key: 'area', label: 'エリア' },
  { key: 'equipment', label: '車両' },
];

/**
 * 左サイドのツールバー。
 * クリックして配置、またはマップへドラッグ＆ドロップで配置できる。
 */
export function Toolbar(): JSX.Element {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const placingKind = useEditorStore((s) => s.placingKind);
  const setPlacingKind = useEditorStore((s) => s.setPlacingKind);
  const options = useEditorStore((s) => s.options);
  const setOption = useEditorStore((s) => s.setOption);

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
