import { useMemo } from 'react';
import {
  applyRackType,
  formatBlockCode,
  locationGroupStats,
  validateLocationGroup,
} from '@ws/shared';
import type { LocationGroup } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';

/**
 * ロケーション自動生成ダイアログ。
 *
 * 「縦方向の列数 × 横方向のブロック数」を入れると、
 * フリーロケーション用の収納スペース一式を作る。
 *
 * 最低限「開始番号・ラックサイズ・縦列数・横ブロック数」だけで生成でき、
 * 残りの項目には既定値が入っている。
 */
export function LocationGroupDialog(): JSX.Element | null {
  const draft = useEditorStore((s) => s.locationGroupDraft);
  const rackTypes = useEditorStore((s) => s.rackTypes);
  const setDraft = useEditorStore((s) => s.setLocationGroupDraft);
  const close = useEditorStore((s) => s.closeLocationGroupDraft);
  const generate = useEditorStore((s) => s.generateLocationGroup);

  const stats = useMemo(() => (draft ? locationGroupStats(draft) : null), [draft]);
  const errors = useMemo(() => (draft ? validateLocationGroup(draft) : []), [draft]);
  const rackType = rackTypes.find((t) => t.id === draft?.rackTypeId);
  // 1つの物理収納単位には可搬ラックが1台入る。収納本数がそれより少ないと何も置けない。
  const capacityWarning =
    draft && rackType && draft.unitsPerSlot < rackType.maxUnits
      ? `1列1段あたりの収納本数が「${rackType.name}」の最大収納本数 ${rackType.maxUnits} 本を下回っています。` +
        'このままでは入庫できないため、同じ本数以上にしてください。'
      : null;

  if (!draft || !stats) return null;

  const num = (value: number): string => value.toLocaleString('ja-JP');

  const field = (
    label: string,
    key: keyof LocationGroup,
    opts: { step?: number; min?: number; max?: number; unit?: string } = {},
  ): JSX.Element => (
    <label className="field">
      <span>
        {label}
        {opts.unit ? ` (${opts.unit})` : ''}
      </span>
      <input
        type="number"
        step={opts.step ?? 1}
        min={opts.min ?? 0}
        max={opts.max}
        value={Number(draft[key] as number)}
        onChange={(e) => setDraft({ [key]: Number(e.target.value) } as Partial<LocationGroup>)}
      />
    </label>
  );

  const firstCode = formatBlockCode(draft.startNumber, 1);
  const lastCode = formatBlockCode(draft.startNumber, draft.horizontalBlocks);

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>ロケーションを自動生成</h2>
        <p className="muted">
          ラックを1台ずつ並べる代わりに、「縦方向の列数 × 横方向のブロック数」でフリーロケーション用の
          収納スペースをまとめて作ります。縦列をまとめた1つが、1つのロケーション住所になります。
        </p>

        <div className="modal-columns">
          <div>
            <div className="step-label">1. 必須</div>
            <div className="field-grid">
              <label className="field">
                <span>ロケーション開始番号</span>
                <input
                  value={draft.startNumber}
                  onChange={(e) => setDraft({ startNumber: e.target.value })}
                  placeholder="001"
                  maxLength={8}
                />
              </label>
              <label className="field">
                <span>ラックサイズ</span>
                <select
                  value={draft.rackTypeId}
                  onChange={(e) => {
                    const type = rackTypes.find((t) => t.id === e.target.value);
                    if (type) setDraft(applyRackType(draft, type));
                  }}
                >
                  {rackTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}（{type.category === 'large' ? '大型' : '小型'} / 幅
                      {type.widthM}m × 奥行{type.depthM}m）
                    </option>
                  ))}
                </select>
              </label>
              {field('縦方向の列数', 'verticalColumns', { min: 1, max: 20 })}
              {field('横方向のブロック数', 'horizontalBlocks', { min: 1, max: 500 })}
            </div>

            <div className="step-label">2. 収納</div>
            <div className="field-grid">
              {field('段数', 'levels', { min: 1, max: 20 })}
              {field('1列1段あたりの収納本数', 'unitsPerSlot', { min: 1 })}
            </div>

            <div className="step-label">3. 寸法と間隔</div>
            <div className="field-grid">
              {field('ラック幅', 'rackWidthM', { step: 0.1, min: 0.1, unit: 'm' })}
              {field('ラック奥行', 'rackDepthM', { step: 0.1, min: 0.1, unit: 'm' })}
              {field('ラック高さ', 'rackHeightM', { step: 0.1, min: 0.1, unit: 'm' })}
              {field('列間隔', 'columnGapM', { step: 0.1, unit: 'm' })}
              {field('横方向の間隔', 'blockGapM', { step: 0.1, unit: 'm' })}
              {field('配置 X', 'x', { step: 0.5, unit: 'm' })}
              {field('配置 Y', 'y', { step: 0.5, unit: 'm' })}
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={draft.singleSizePerLocation}
                onChange={(e) => setDraft({ singleSizePerLocation: e.target.checked })}
              />
              1つのロケーションには1つの商品サイズだけを入れる
            </label>
          </div>

          <div>
            <div className="step-label">4. 生成プレビュー</div>
            <div className="preview-box">
              <div className="preview-count">
                {stats.totalPhysicalColumns} 列生成・<strong>{stats.locationCount}</strong> ロケーション
              </div>
              <table className="dp-table preview-table">
                <tbody>
                  <tr>
                    <th scope="row">ラック</th>
                    <td>
                      {rackType?.name ?? '-'}（{draft.rackWidthM}m × {draft.rackDepthM}m）
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">縦</th>
                    <td>{stats.verticalColumns} 列</td>
                  </tr>
                  <tr>
                    <th scope="row">横</th>
                    <td>{stats.horizontalBlocks} ブロック</td>
                  </tr>
                  <tr>
                    <th scope="row">段数</th>
                    <td>{stats.levels} 段</td>
                  </tr>
                  <tr>
                    <th scope="row">総物理列</th>
                    <td>{num(stats.totalPhysicalColumns)} 列</td>
                  </tr>
                  <tr>
                    <th scope="row">ロケーション</th>
                    <td>{num(stats.locationCount)} 個</td>
                  </tr>
                  <tr>
                    <th scope="row">物理収納単位</th>
                    <td>{num(stats.slotCount)} 箇所（列 × 段 × ブロック）</td>
                  </tr>
                  <tr>
                    <th scope="row">1列の収納</th>
                    <td>{num(stats.unitsPerColumn)} 本</td>
                  </tr>
                  <tr>
                    <th scope="row">1ロケーションの収納</th>
                    <td>{num(stats.unitsPerLocation)} 本</td>
                  </tr>
                  <tr>
                    <th scope="row">推定容量</th>
                    <td>
                      <strong>{num(stats.totalUnits)} 本</strong>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">占有サイズ</th>
                    <td>
                      {stats.totalWidthM.toFixed(1)}m × {stats.totalDepthM.toFixed(1)}m
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="preview-codes">
                <span className="code-chip">{firstCode}</span>
                <span className="code-chip">{formatBlockCode(draft.startNumber, 2)}</span>
                <span className="code-chip">{formatBlockCode(draft.startNumber, 3)}</span>
                <span className="muted small">… </span>
                <span className="code-chip">{lastCode}</span>
              </div>
              <div className="muted small">
                1ロケーションの内部: {stats.verticalColumns} 列 × {stats.levels} 段 ={' '}
                {stats.verticalColumns * stats.levels} 箇所（例: {firstCode}-C1-L1）
              </div>
              <div className="muted small">生成直後のロケーションはすべて「空」です。</div>
            </div>

            {capacityWarning && <p className="warn small">{capacityWarning}</p>}

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
          <button type="button" onClick={close}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => generate(draft)}
            disabled={errors.length > 0}
          >
            {stats.locationCount} ロケーションを生成
          </button>
        </div>
      </div>
    </div>
  );
}
