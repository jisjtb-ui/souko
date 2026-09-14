import { useMemo, useState } from 'react';
import { previewLocationCodes, validateNamingRule } from '@ws/shared';
import type { LocationNamingRule, RackFace, RackObject, RackSpec } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';

/**
 * ラック設定ダイアログ。
 *
 * 「サイズ → 列数 → ロケーション番号 → 自動生成」という
 * 現場の手順どおりの並びにして、説明書なしで進められるようにしている。
 * 細かい設定は「詳細設定」に隠す。
 *
 * レイアウトで決めるのは列数だけ。段数と1ラックの入り本数は
 * シミュレーション設定の「段数の割合」「入り本数の割合」で決める。
 */
export function RackDialog(): JSX.Element | null {
  const draft = useEditorStore((s) => s.rackDraft);
  const cancel = useEditorStore((s) => s.cancelRackDraft);
  const apply = useEditorStore((s) => s.applyRackDraft);

  if (!draft) return null;
  return <RackDialogInner key={draft.object.id} object={draft.object} isNew={draft.isNew} onCancel={cancel} onApply={apply} />;
}

interface InnerProps {
  object: RackObject;
  isNew: boolean;
  onCancel: () => void;
  onApply: (input: { object: RackObject; spec: RackSpec }) => void;
}

function RackDialogInner({ object, isNew, onCancel, onApply }: InnerProps): JSX.Element {
  const [name, setName] = useState(object.name);
  const [widthM, setWidthM] = useState(object.widthM);
  const [depthM, setDepthM] = useState(object.depthM);
  const [spec, setSpec] = useState<RackSpec>(object.rack);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const setNaming = (patch: Partial<LocationNamingRule>): void =>
    setSpec((s) => ({ ...s, naming: { ...s.naming, ...patch } }));

  // 1列 = 1ロケーション。段数はシミュレーション時に決まる。
  const total = spec.columns;
  const bayWidth = widthM / Math.max(1, spec.columns);
  const preview = useMemo(
    () => previewLocationCodes(spec.naming, spec.columns, 1, 8),
    [spec.naming, spec.columns],
  );
  const errors = useMemo(() => {
    const list = validateNamingRule(spec.naming);
    if (widthM <= 0 || depthM <= 0) list.push('サイズは0より大きい値にしてください');
    if (spec.columns < 1) list.push('列数は1以上にしてください');
    if (bayWidth < 0.3) list.push('間口が狭すぎます。列数を減らすか幅を広げてください');
    return list;
  }, [spec, widthM, depthM, bayWidth]);

  const submit = (): void => {
    if (errors.length > 0) return;
    // 段数と収納数はシミュレーション時に決めるため、レイアウトには持たせない
    // (1列=1ロケーション、収容数は無制限=0)
    onApply({
      object: { ...object, name, widthM, depthM },
      spec: { ...spec, levels: 1, capacityPerLocation: 0 },
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{isNew ? 'ラックを配置' : 'ラック設定'}</h2>
        <p className="muted">
          サイズと列数を入力すると、ロケーション番号が自動生成されます。
          段数と1ラックの入り本数は、シミュレーション設定の「段数の割合」「入り本数の割合」で決まります。
        </p>

        <div className="modal-columns">
          <div>
            <div className="step-label">1. 基本</div>
            <label className="field">
              <span>ラック名</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field-grid">
              <label className="field">
                <span>横幅 (m)</span>
                <input type="number" step={0.1} min={0.3} value={widthM} onChange={(e) => setWidthM(Number(e.target.value))} />
              </label>
              <label className="field">
                <span>奥行 (m)</span>
                <input type="number" step={0.1} min={0.3} value={depthM} onChange={(e) => setDepthM(Number(e.target.value))} />
              </label>
            </div>

            <div className="step-label">2. 縦列</div>
            <div className="field-grid">
              <label className="field">
                <span>縦列の数</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={spec.columns}
                  onChange={(e) => setSpec((s) => ({ ...s, columns: Math.max(1, Number(e.target.value)) }))}
                />
              </label>
              <label className="field">
                <span>1列の横幅 (m)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0.3}
                  value={Number(bayWidth.toFixed(2))}
                  onChange={(e) => {
                    // 1列の幅を指定したら、ラック全体の幅を 列数 × 指定値 に合わせる
                    const lane = Math.max(0.3, Number(e.target.value));
                    setWidthM(Number((lane * spec.columns).toFixed(2)));
                  }}
                />
              </label>
              <label className="field">
                <span>ピッキング面</span>
                <select value={spec.face} onChange={(e) => setSpec((s) => ({ ...s, face: e.target.value as RackFace }))}>
                  <option value="front">手前側（通路が上）</option>
                  <option value="back">奥側（通路が下）</option>
                  <option value="both">両面</option>
                </select>
              </label>
            </div>
            <p className="muted small">
              ラック幅 = 縦列の数 × 1列の横幅。どちらを変えても他方が追従します。
              <br />
              1つの縦列には1サイズだけを入れます（シミュレーション設定で切り替え可）。
              <br />
              段数と1ラックの入り本数はここでは決めません。
              シミュレーションパネルの「段数の割合」「入り本数の割合」で指定します。
            </p>
          </div>

          <div>
            <div className="step-label">3. ロケーション番号</div>
            <div className="field-grid">
              <label className="field">
                <span>エリア記号</span>
                <input value={spec.naming.area} onChange={(e) => setNaming({ area: e.target.value })} maxLength={4} />
              </label>
              <label className="field">
                <span>命名パターン</span>
                <select value={spec.naming.pattern} onChange={(e) => setNaming({ pattern: e.target.value })}>
                  <option value="{area}-{column}-{level}">A-01-01（エリア-列-段）</option>
                  <option value="{area}{column}-{level}">A01-01</option>
                  <option value="{area}-{column}">A-01（段を分けない）</option>
                  <option value="{area}-{level}-{column}">A-01-01（エリア-段-列）</option>
                </select>
              </label>
            </div>

            <button type="button" className="link" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? '▾ 詳細設定を隠す' : '▸ 詳細設定'}
            </button>

            {showAdvanced && (
              <div className="field-grid">
                <label className="field">
                  <span>列の開始番号</span>
                  <input
                    type="number"
                    value={spec.naming.columnStart}
                    onChange={(e) => setNaming({ columnStart: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>列の桁数</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={spec.naming.columnDigits}
                    onChange={(e) => setNaming({ columnDigits: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>列の並び</span>
                  <select
                    value={spec.naming.columnOrder}
                    onChange={(e) => setNaming({ columnOrder: e.target.value as 'asc' | 'desc' })}
                  >
                    <option value="asc">左から昇順</option>
                    <option value="desc">右から昇順</option>
                  </select>
                </label>
                <label className="field">
                  <span>段の開始番号</span>
                  <input
                    type="number"
                    value={spec.naming.levelStart}
                    onChange={(e) => setNaming({ levelStart: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>段の桁数</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={spec.naming.levelDigits}
                    onChange={(e) => setNaming({ levelDigits: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>段の並び</span>
                  <select
                    value={spec.naming.levelOrder}
                    onChange={(e) => setNaming({ levelOrder: e.target.value as 'bottom-up' | 'top-down' })}
                  >
                    <option value="bottom-up">下段から昇順</option>
                    <option value="top-down">上段から昇順</option>
                  </select>
                </label>
                <label className="field">
                  <span>商品カテゴリ</span>
                  <input
                    value={spec.category ?? ''}
                    placeholder="例: 常温 / 冷蔵"
                    onChange={(e) => setSpec((s) => ({ ...s, category: e.target.value }))}
                  />
                </label>
              </div>
            )}

            <div className="step-label">4. 生成されるロケーション</div>
            <div className="preview-box">
              <div className="preview-count">
                縦列 {spec.columns} 本 = <strong>{total}</strong> ロケーション
                <span className="muted small">
                  （1列 {bayWidth.toFixed(2)}m × 奥行 {depthM.toFixed(2)}m）
                </span>
              </div>
              <div className="muted small">段数はシミュレーション時に割合から決まります。</div>
              <div className="preview-codes">
                {preview.map((code) => (
                  <span key={code} className="code-chip">
                    {code}
                  </span>
                ))}
                {total > preview.length && <span className="muted small">… 全{total}件</span>}
              </div>
            </div>

            {errors.length > 0 && (
              <ul className="error-list">
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={submit} disabled={errors.length > 0}>
            {isNew ? '配置してロケーションを生成' : 'ロケーションを再生成'}
          </button>
        </div>
      </div>
    </div>
  );
}
