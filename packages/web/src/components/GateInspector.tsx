import { useMemo } from 'react';
import {
  validateInboundGateConfig,
  validateOutboundGateConfig,
  validateRatioTotal,
} from '@ws/shared';
import type {
  EmptyRackYardObject,
  InboundGateConfig,
  InboundGateObject,
  OutboundGateConfig,
  OutboundGateObject,
  RackMixSetting,
  SizeMixEntry,
  TimeBandSetting,
  VolumeClassSetting,
} from '@ws/shared';
import { useEditorStore } from '../store/editorStore';

/* ============================================================================
 * ゲート設定パネル
 * ----------------------------------------------------------------------------
 * ここで入力した数量・割合は、そのままシミュレーションのイベント生成
 * （入庫/出庫の発生本数・タイミング・使用ラック）に使われる。
 * 割合の合計が100%でない場合はエラーとして表示する。
 * ========================================================================== */

function ratioBadge(values: number[], label: string): JSX.Element {
  const total = values.reduce((sum, v) => sum + v, 0);
  const ok = Math.abs(total - 100) <= 0.01;
  return (
    <span className={ok ? 'ratio-badge ok' : 'ratio-badge ng'}>
      {label} 合計 {total.toFixed(0)}%
    </span>
  );
}

/** 時間帯別の割合エディタ。 */
function TimeBandEditor({
  bands,
  onChange,
}: {
  bands: TimeBandSetting[];
  onChange: (bands: TimeBandSetting[]) => void;
}): JSX.Element {
  const update = (index: number, patch: Partial<TimeBandSetting>): void =>
    onChange(bands.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  return (
    <div className="mix-editor">
      {bands.map((band, index) => (
        <div key={index} className="mix-row">
          <input
            type="time"
            value={band.from}
            onChange={(e) => update(index, { from: e.target.value })}
          />
          <span className="muted">〜</span>
          <input type="time" value={band.to} onChange={(e) => update(index, { to: e.target.value })} />
          <input
            type="number"
            min={0}
            max={100}
            value={band.ratioPct}
            onChange={(e) => update(index, { ratioPct: Number(e.target.value) })}
          />
          <span className="muted small">%</span>
          <button type="button" className="icon" onClick={() => onChange(bands.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
      <div className="btn-row">
        <button
          type="button"
          onClick={() => onChange([...bands, { from: '17:00', to: '18:00', ratioPct: 0 }])}
        >
          時間帯を追加
        </button>
        {ratioBadge(bands.map((b) => b.ratioPct), '時間帯')}
      </div>
    </div>
  );
}

/** 使用ラックサイズ割合のエディタ。 */
function RackMixEditor({
  mix,
  onChange,
}: {
  mix: RackMixSetting;
  onChange: (mix: RackMixSetting) => void;
}): JSX.Element {
  return (
    <div className="mix-editor">
      <div className="field-grid">
        <label className="field">
          <span>小型ラック (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={mix.smallPct}
            onChange={(e) => onChange({ ...mix, smallPct: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>大型ラック (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={mix.largePct}
            onChange={(e) => onChange({ ...mix, largePct: Number(e.target.value) })}
          />
        </label>
      </div>
      {ratioBadge([mix.smallPct, mix.largePct], 'ラック')}
    </div>
  );
}

/** 倉入れ口（入庫ゲート）の設定。 */
export function InboundGateInspector({ gate }: { gate: InboundGateObject }): JSX.Element {
  const updateObject = useEditorStore((s) => s.updateObject);
  const productSizes = useEditorStore((s) => s.productSizes);
  const config = gate.inboundGate;

  const update = (patch: Partial<InboundGateConfig>): void =>
    updateObject(gate.id, { inboundGate: { ...config, ...patch } } as never);

  const errors = useMemo(() => validateInboundGateConfig(config), [config]);

  // マスタに登録された商品サイズと搬入割合を突き合わせる
  const sizeMix: SizeMixEntry[] = useMemo(() => {
    const byId = new Map(config.sizeMix.map((s) => [s.productSizeId, s.ratioPct]));
    return productSizes.map((size) => ({
      productSizeId: size.id,
      ratioPct: byId.get(size.id) ?? 0,
    }));
  }, [config.sizeMix, productSizes]);

  const hourlyPlan = config.dailyVolume / Math.max(1, hoursBetween(config.openFrom, config.openTo));

  return (
    <div className="panel-block">
      <div className="panel-title">
        <span className="swatch" style={{ background: '#bfe3c6', borderColor: '#2f7d4f' }} />
        倉入れ口
      </div>

      <div className="field-grid">
        <label className="field">
          <span>ゲートID</span>
          <input value={config.code} onChange={(e) => update({ code: e.target.value })} />
        </label>
        <label className="field">
          <span>ゲート名</span>
          <input value={gate.name} onChange={(e) => updateObject(gate.id, { name: e.target.value })} />
        </label>
        <label className="field">
          <span>1日の倉入れ本数</span>
          <input
            type="number"
            min={0}
            step={100}
            value={config.dailyVolume}
            onChange={(e) => update({ dailyVolume: Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>処理能力 (本/時)</span>
          <input
            type="number"
            min={1}
            step={50}
            value={config.capacityPerHour}
            onChange={(e) => update({ capacityPerHour: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>同時搬入台数</span>
          <input
            type="number"
            min={1}
            value={config.concurrentSlots}
            onChange={(e) => update({ concurrentSlots: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>使用可能時間</span>
          <div className="time-range">
            <input type="time" value={config.openFrom} onChange={(e) => update({ openFrom: e.target.value })} />
            <input type="time" value={config.openTo} onChange={(e) => update({ openTo: e.target.value })} />
          </div>
        </label>
      </div>

      <p className="muted small">
        平均 {Math.round(hourlyPlan).toLocaleString()} 本/時の計画に対し、処理能力は{' '}
        {config.capacityPerHour.toLocaleString()} 本/時
        {hourlyPlan > config.capacityPerHour && <strong className="warn-inline">（能力不足）</strong>}
      </p>

      <div className="sub-block">
        <div className="sub-title">時間帯別の搬入割合</div>
        <TimeBandEditor bands={config.timeBands} onChange={(timeBands) => update({ timeBands })} />
      </div>

      <div className="sub-block">
        <div className="sub-title">サイズ別搬入割合</div>
        {productSizes.length === 0 && <p className="muted small">商品サイズマスタが未登録です。</p>}
        <div className="mix-editor">
          {sizeMix.map((entry) => {
            const size = productSizes.find((p) => p.id === entry.productSizeId);
            return (
              <div key={entry.productSizeId} className="mix-row">
                <span className="mix-label">{size?.code ?? entry.productSizeId}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={entry.ratioPct}
                  onChange={(e) =>
                    update({
                      sizeMix: sizeMix.map((s) =>
                        s.productSizeId === entry.productSizeId
                          ? { ...s, ratioPct: Number(e.target.value) }
                          : s,
                      ),
                    })
                  }
                />
                <span className="muted small">
                  % ＝ {Math.round((config.dailyVolume * entry.ratioPct) / 100).toLocaleString()} 本
                </span>
              </div>
            );
          })}
          {sizeMix.length > 0 && ratioBadge(sizeMix.map((s) => s.ratioPct), 'サイズ')}
        </div>
      </div>

      <div className="sub-block">
        <div className="sub-title">使用ラックサイズ割合</div>
        <RackMixEditor mix={config.rackMix} onChange={(rackMix) => update({ rackMix })} />
      </div>

      <ValidationList errors={errors} />
    </div>
  );
}

/** 出荷ゲートの設定。 */
export function OutboundGateInspector({ gate }: { gate: OutboundGateObject }): JSX.Element {
  const updateObject = useEditorStore((s) => s.updateObject);
  const productSizes = useEditorStore((s) => s.productSizes);
  const config = gate.outboundGate;

  const update = (patch: Partial<OutboundGateConfig>): void =>
    updateObject(gate.id, { outboundGate: { ...config, ...patch } } as never);

  const errors = useMemo(() => validateOutboundGateConfig(config), [config]);
  const hourlyPlan = config.dailyVolume / Math.max(1, hoursBetween(config.openFrom, config.openTo));

  const updateVolume = (index: number, patch: Partial<VolumeClassSetting>): void =>
    update({ volumeMix: config.volumeMix.map((v, i) => (i === index ? { ...v, ...patch } : v)) });

  return (
    <div className="panel-block">
      <div className="panel-title">
        <span className="swatch" style={{ background: '#f6c8bf', borderColor: '#a63b28' }} />
        出荷ゲート
      </div>

      <div className="field-grid">
        <label className="field">
          <span>ゲートID</span>
          <input value={config.code} onChange={(e) => update({ code: e.target.value })} />
        </label>
        <label className="field">
          <span>ゲート名</span>
          <input value={gate.name} onChange={(e) => updateObject(gate.id, { name: e.target.value })} />
        </label>
        <label className="field">
          <span>1日の出荷本数</span>
          <input
            type="number"
            min={0}
            step={100}
            value={config.dailyVolume}
            onChange={(e) => update({ dailyVolume: Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>処理能力 (本/時)</span>
          <input
            type="number"
            min={1}
            step={50}
            value={config.capacityPerHour}
            onChange={(e) => update({ capacityPerHour: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>同時処理可能台数</span>
          <input
            type="number"
            min={1}
            value={config.concurrentSlots}
            onChange={(e) => update({ concurrentSlots: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>使用可能時間</span>
          <div className="time-range">
            <input type="time" value={config.openFrom} onChange={(e) => update({ openFrom: e.target.value })} />
            <input type="time" value={config.openTo} onChange={(e) => update({ openTo: e.target.value })} />
          </div>
        </label>
      </div>

      <p className="muted small">
        平均 {Math.round(hourlyPlan).toLocaleString()} 本/時の計画に対し、処理能力は{' '}
        {config.capacityPerHour.toLocaleString()} 本/時
        {hourlyPlan > config.capacityPerHour && <strong className="warn-inline">（能力不足＝滞留が発生します）</strong>}
      </p>

      <div className="sub-block">
        <div className="sub-title">ボリューム区分の割合</div>
        <div className="mix-editor">
          {config.volumeMix.map((volume, index) => (
            <div key={volume.key} className="mix-row">
              <span className="mix-label">{volume.label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={volume.ratioPct}
                onChange={(e) => updateVolume(index, { ratioPct: Number(e.target.value) })}
              />
              <span className="muted small">%</span>
              <input
                type="number"
                min={1}
                value={volume.unitsPerOrder}
                onChange={(e) => updateVolume(index, { unitsPerOrder: Math.max(1, Number(e.target.value)) })}
                title="1オーダーあたりの本数"
              />
              <span className="muted small">
                本/件 ＝ {Math.round((config.dailyVolume * volume.ratioPct) / 100).toLocaleString()} 本
              </span>
            </div>
          ))}
          {ratioBadge(config.volumeMix.map((v) => v.ratioPct), 'ボリューム')}
        </div>
      </div>

      <div className="sub-block">
        <div className="sub-title">時間帯別の出荷割合</div>
        <TimeBandEditor bands={config.timeBands} onChange={(timeBands) => update({ timeBands })} />
      </div>

      <div className="sub-block">
        <div className="sub-title">使用ラックサイズ割合</div>
        <RackMixEditor mix={config.rackMix} onChange={(rackMix) => update({ rackMix })} />
      </div>

      <div className="sub-block">
        <div className="sub-title">出荷対象の商品サイズ</div>
        {productSizes.length === 0 && <p className="muted small">商品サイズマスタが未登録です。</p>}
        {productSizes.map((size) => {
          const checked = config.productSizeIds.length === 0 || config.productSizeIds.includes(size.id);
          return (
            <label key={size.id} className="check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const current =
                    config.productSizeIds.length === 0 ? productSizes.map((p) => p.id) : config.productSizeIds;
                  update({
                    productSizeIds: e.target.checked
                      ? [...new Set([...current, size.id])]
                      : current.filter((id) => id !== size.id),
                  });
                }}
              />
              {size.code}（{size.name}）
            </label>
          );
        })}
        <p className="muted small">すべて選択の場合は全サイズが対象になります。</p>
      </div>

      <ValidationList errors={errors} />
    </div>
  );
}

/** 空ラック置き場の設定。 */
export function EmptyRackYardInspector({ yard }: { yard: EmptyRackYardObject }): JSX.Element {
  const updateObject = useEditorStore((s) => s.updateObject);
  const rackTypes = useEditorStore((s) => s.rackTypes);
  const config = yard.emptyRackYard;

  const update = (patch: Partial<typeof config>): void =>
    updateObject(yard.id, { emptyRackYard: { ...config, ...patch } } as never);

  const stackSlots = config.stackColumns * config.stackRows;
  const capacity = rackTypes.map((type) => ({
    name: type.name,
    // 空ラックは maxStackWhenEmpty 段まで積める
    total: stackSlots * type.maxStackWhenEmpty,
    perStack: type.maxStackWhenEmpty,
  }));

  return (
    <div className="panel-block">
      <div className="panel-title">
        <span className="swatch" style={{ background: '#dfe3e8', borderColor: '#59636e' }} />
        空ラック置き場
      </div>

      <div className="field-grid">
        <label className="field">
          <span>置き場ID</span>
          <input value={config.code} onChange={(e) => update({ code: e.target.value })} />
        </label>
        <label className="field">
          <span>名称</span>
          <input value={yard.name} onChange={(e) => updateObject(yard.id, { name: e.target.value })} />
        </label>
        <label className="field">
          <span>スタック列数</span>
          <input
            type="number"
            min={1}
            value={config.stackColumns}
            onChange={(e) => update({ stackColumns: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>スタック行数</span>
          <input
            type="number"
            min={1}
            value={config.stackRows}
            onChange={(e) => update({ stackRows: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          <span>受入ラック種別</span>
          <select
            value={config.acceptedCategory}
            onChange={(e) => update({ acceptedCategory: e.target.value as typeof config.acceptedCategory })}
          >
            <option value="both">両方</option>
            <option value="small">小型のみ</option>
            <option value="large">大型のみ</option>
          </select>
        </label>
      </div>

      <dl className="stat-grid compact">
        <div>
          <dt>スタック位置</dt>
          <dd>{stackSlots} 箇所</dd>
        </div>
        {capacity.map((c) => (
          <div key={c.name}>
            <dt>{c.name}</dt>
            <dd>
              {c.total} 台（{c.perStack}段積み）
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted small">
        1つのスタックに積める段数はラック種別の「空の場合の最大積み重ね段数」で決まります。
        満杯になると次のスタックへ回されます。
      </p>
    </div>
  );
}

function ValidationList({ errors }: { errors: string[] }): JSX.Element | null {
  if (errors.length === 0) {
    return <p className="muted small">✔ 設定に問題はありません。この値でシミュレーションが実行されます。</p>;
  }
  return (
    <ul className="error-list">
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

/** "08:00" と "17:00" の差を時間で返す。 */
function hoursBetween(from: string, to: string): number {
  const parse = (v: string): number => {
    const [h = 0, m = 0] = v.split(':').map((n) => Number.parseInt(n, 10) || 0);
    return h + m / 60;
  };
  return Math.max(0.5, parse(to) - parse(from));
}

export { validateRatioTotal };
