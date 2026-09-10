import { useMemo, useState } from 'react';
import { validateProductSizes, validateRatioTotal } from '@ws/shared';
import type { ProductSize, RackType } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';

/**
 * マスタ設定ダイアログ。
 *
 * - ラック種別（小型 / 大型）: 実寸・収納本数・積み重ね段数
 * - 商品サイズ: 使用ラック・1ラックあたり本数・搬入/出荷割合・優先保管エリア
 *
 * ここで設定した値がシミュレーションのラック生成・保管場所選定に使われる。
 */
export function MasterDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<'rack' | 'size'>('rack');
  const rackTypes = useEditorStore((s) => s.rackTypes);
  const productSizes = useEditorStore((s) => s.productSizes);
  const saveMasters = useEditorStore((s) => s.saveMasters);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>マスタ設定</h2>
        <div className="tab-row">
          <button
            type="button"
            className={tab === 'rack' ? 'tab active' : 'tab'}
            onClick={() => setTab('rack')}
          >
            ラック種別（{rackTypes.length}）
          </button>
          <button
            type="button"
            className={tab === 'size' ? 'tab active' : 'tab'}
            onClick={() => setTab('size')}
          >
            商品サイズ（{productSizes.length}）
          </button>
        </div>

        {tab === 'rack' ? <RackTypeTab types={rackTypes} /> : <ProductSizeTab sizes={productSizes} />}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void saveMasters();
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function RackTypeTab({ types }: { types: RackType[] }): JSX.Element {
  const updateRackType = useEditorStore((s) => s.updateRackType);

  const num = (
    type: RackType,
    key: keyof RackType,
    label: string,
    step = 1,
    hint?: string,
  ): JSX.Element => (
    <label className="field" key={String(key)}>
      <span title={hint}>{label}</span>
      <input
        type="number"
        step={step}
        min={0}
        value={Number(type[key] as number)}
        onChange={(e) => updateRackType(type.id, { [key]: Number(e.target.value) } as Partial<RackType>)}
      />
    </label>
  );

  return (
    <div className="master-grid">
      {types.map((type) => (
        <div key={type.id} className="master-card">
          <div className="master-card-head">
            <span className="swatch" style={{ background: type.color ?? '#8fb8e8', borderColor: '#41618f' }} />
            <input
              className="master-name"
              value={type.name}
              onChange={(e) => updateRackType(type.id, { name: e.target.value })}
            />
            <span className="badge">{type.category === 'small' ? '小型' : '大型'}</span>
          </div>

          <div className="field-grid">
            {num(type, 'widthM', '幅 (m)', 0.1)}
            {num(type, 'depthM', '奥行 (m)', 0.1)}
            {num(type, 'heightM', '高さ (m)', 0.1)}
            {num(type, 'levels', '段数')}
            {num(type, 'unitsPerLevel', '1段あたり収納本数')}
            {num(type, 'maxUnits', '最大収納本数')}
            {num(type, 'maxLoadKg', '最大積載重量 (kg)', 50)}
          </div>

          <div className="sub-title">積み重ね段数</div>
          <div className="field-grid">
            {num(type, 'maxStackWhenLoaded', '中身あり', 1, '商品が入っている状態で積める段数')}
            {num(type, 'maxStackWhenEmpty', '空', 1, '空ラックとして積める段数')}
          </div>
          <p className="muted small">
            段数 × 1段あたり本数 = {type.levels * type.unitsPerLevel} 本
            {type.levels * type.unitsPerLevel !== type.maxUnits && (
              <strong className="warn-inline">（最大収納本数 {type.maxUnits} 本と不一致）</strong>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

function ProductSizeTab({ sizes }: { sizes: ProductSize[] }): JSX.Element {
  const updateProductSize = useEditorStore((s) => s.updateProductSize);
  const addProductSize = useEditorStore((s) => s.addProductSize);
  const removeProductSize = useEditorStore((s) => s.removeProductSize);

  const errors = useMemo(() => validateProductSizes(sizes), [sizes]);
  const inboundTotal = sizes.reduce((sum, s) => sum + s.inboundRatioPct, 0);
  const outboundTotal = sizes.reduce((sum, s) => sum + s.outboundRatioPct, 0);

  return (
    <div>
      <table className="master-table">
        <thead>
          <tr>
            <th>サイズコード</th>
            <th>名称</th>
            <th>使用ラック</th>
            <th title="1ラックあたりの収納本数">本/ラック</th>
            <th>重量(kg)</th>
            <th>搬入%</th>
            <th>出荷%</th>
            <th>出荷頻度</th>
            <th title="この商品を優先的に保管するエリアのタグ">優先エリア</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sizes.map((size) => (
            <tr key={size.id}>
              <td>
                <input value={size.code} onChange={(e) => updateProductSize(size.id, { code: e.target.value })} />
              </td>
              <td>
                <input value={size.name} onChange={(e) => updateProductSize(size.id, { name: e.target.value })} />
              </td>
              <td>
                <select
                  value={size.rackCategory}
                  onChange={(e) =>
                    updateProductSize(size.id, { rackCategory: e.target.value as ProductSize['rackCategory'] })
                  }
                >
                  <option value="small">小型</option>
                  <option value="large">大型</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  min={1}
                  value={size.unitsPerRack}
                  onChange={(e) => updateProductSize(size.id, { unitsPerRack: Math.max(1, Number(e.target.value)) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step={0.5}
                  value={size.weightPerUnitKg}
                  onChange={(e) => updateProductSize(size.id, { weightPerUnitKg: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={size.inboundRatioPct}
                  onChange={(e) => updateProductSize(size.id, { inboundRatioPct: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={size.outboundRatioPct}
                  onChange={(e) => updateProductSize(size.id, { outboundRatioPct: Number(e.target.value) })}
                />
              </td>
              <td>
                <select
                  value={size.turnover}
                  onChange={(e) =>
                    updateProductSize(size.id, { turnover: e.target.value as ProductSize['turnover'] })
                  }
                >
                  <option value="high">高回転</option>
                  <option value="medium">中回転</option>
                  <option value="low">低回転</option>
                </select>
              </td>
              <td>
                <input
                  value={size.preferredAreaTag ?? ''}
                  placeholder="例: 北側"
                  onChange={(e) => updateProductSize(size.id, { preferredAreaTag: e.target.value })}
                />
              </td>
              <td>
                <button type="button" className="icon" onClick={() => removeProductSize(size.id)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="btn-row">
        <button type="button" onClick={addProductSize}>
          サイズを追加
        </button>
        <span className={Math.abs(inboundTotal - 100) < 0.01 ? 'ratio-badge ok' : 'ratio-badge ng'}>
          搬入 合計 {inboundTotal.toFixed(0)}%
        </span>
        <span className={Math.abs(outboundTotal - 100) < 0.01 ? 'ratio-badge ok' : 'ratio-badge ng'}>
          出荷 合計 {outboundTotal.toFixed(0)}%
        </span>
      </div>

      {errors.length > 0 && (
        <ul className="error-list">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <p className="muted small">
        「優先エリア」はラックの商品カテゴリと突き合わせます（例: 大型タイヤ → 北側エリアのラック）。
      </p>
    </div>
  );
}

export { validateRatioTotal };
