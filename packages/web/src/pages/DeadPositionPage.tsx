import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ALLOCATION_ORDER_LABELS,
  LANE_DEPTHS,
  SAMPLE_SIZES,
  allocateDepthUnaware,
  analyzeDeadPositions,
  createDefaultCapacityTable,
  createSampleCapacityTable,
  createSampleLanes,
  createSampleCurrentAssignments,
  isRackObject,
  laneDepthOf,
} from '@ws/shared';
import type {
  DeadPositionMetrics,
  DeadPositionStock,
  Lane,
  LaneCapacityEntry,
  LayoutObject,
  ProductSize,
} from '@ws/shared';
import { useEditorStore } from '../store/editorStore';
import { LaneChart } from './LaneChart';
import type { LaneChartGroup, LaneChartRow } from './LaneChart';

/* ============================================================================
 * 死にポジション分析ページ
 * ----------------------------------------------------------------------------
 * 平面図エディタとは独立した画面。計算は @ws/shared の純関数に任せ、
 * ここでは入力の受け渡しと表示だけを行う。
 * 既存の移動距離評価・ヒートマップ・出荷口機能には一切触れない。
 * ========================================================================== */

type Source = 'sample' | 'layout';

interface StockRow {
  key: string;
  productSizeId: string;
  yearWeek?: string;
  units: number;
}

const num = (value: number): string => value.toLocaleString('ja-JP');
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const signed = (value: number): string => (value > 0 ? `+${num(value)}` : num(value));
const signedPt = (value: number): string => {
  const pt = value * 100;
  return `${pt > 0 ? '+' : ''}${pt.toFixed(1)}pt`;
};

/** ラック定義からレーン（＝列）を作る。奥行きは laneDepth（未設定は1）。 */
function lanesFromLayout(objects: readonly LayoutObject[]): Lane[] {
  const lanes: Lane[] = [];
  for (const object of objects) {
    if (!isRackObject(object)) continue;
    const { columns, naming } = object.rack;
    const depth = laneDepthOf(object.rack);
    for (let c = 0; c < columns; c++) {
      const columnNo =
        naming.columnOrder === 'asc'
          ? naming.columnStart + c
          : naming.columnStart + (columns - 1 - c);
      lanes.push({
        id: `${object.id}:${columnNo}`,
        label: `${naming.area}-${String(columnNo).padStart(naming.columnDigits, '0')}`,
        depth,
        groupLabel: object.name,
      });
    }
  }
  return lanes;
}

function sampleStockRows(): StockRow[] {
  const rows: StockRow[] = [];
  for (const size of SAMPLE_SIZES) {
    for (const cohort of size.cohorts) {
      rows.push({
        key: `${size.id}|${cohort.yearWeek}`,
        productSizeId: size.id,
        yearWeek: cohort.yearWeek,
        units: cohort.units,
      });
    }
  }
  return rows;
}

function layoutStockRows(sizes: readonly ProductSize[]): StockRow[] {
  return sizes.map((size) => ({ key: size.id, productSizeId: size.id, units: 0 }));
}

function toStock(rows: readonly StockRow[]): DeadPositionStock[] {
  const bySize = new Map<string, DeadPositionStock>();
  for (const row of rows) {
    if (row.units <= 0) continue;
    const entry = bySize.get(row.productSizeId) ?? {
      productSizeId: row.productSizeId,
      peakUnits: 0,
      cohorts: [],
    };
    entry.peakUnits += row.units;
    entry.cohorts!.push({
      ...(row.yearWeek !== undefined ? { yearWeek: row.yearWeek } : {}),
      units: row.units,
    });
    bySize.set(row.productSizeId, entry);
  }
  return [...bySize.values()];
}

export function DeadPositionPage(): JSX.Element {
  const objects = useEditorStore((s) => s.objects);
  const productSizes = useEditorStore((s) => s.productSizes);

  const [source, setSource] = useState<Source>('sample');
  const [showInputs, setShowInputs] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [sampleRows, setSampleRows] = useState<StockRow[]>(sampleStockRows);
  const [layoutRows, setLayoutRows] = useState<StockRow[]>(() => layoutStockRows(productSizes));
  const [sampleCapacity, setSampleCapacity] = useState<LaneCapacityEntry[]>(() =>
    createSampleCapacityTable(),
  );
  const [layoutCapacity, setLayoutCapacity] = useState<LaneCapacityEntry[] | null>(null);

  const stockRows = source === 'sample' ? sampleRows : layoutRows;
  const setStockRows = source === 'sample' ? setSampleRows : setLayoutRows;

  const capacity = useMemo<LaneCapacityEntry[]>(() => {
    if (source === 'sample') return sampleCapacity;
    return layoutCapacity ?? createDefaultCapacityTable(productSizes);
  }, [source, sampleCapacity, layoutCapacity, productSizes]);

  const setCapacity = useCallback(
    (next: LaneCapacityEntry[]) => {
      if (source === 'sample') setSampleCapacity(next);
      else setLayoutCapacity(next);
    },
    [source],
  );

  const lanes = useMemo<Lane[]>(
    () => (source === 'sample' ? createSampleLanes() : lanesFromLayout(objects)),
    [source, objects],
  );

  const sizeLabels = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const size of SAMPLE_SIZES) map[size.id] = size.code;
    for (const size of productSizes) map[size.id] = size.code;
    return map;
  }, [productSizes]);

  const stock = useMemo(() => toStock(stockRows), [stockRows]);

  const current = useMemo(() => {
    if (source === 'sample') return createSampleCurrentAssignments(lanes, stock, capacity);
    return allocateDepthUnaware(lanes, stock, capacity);
  }, [source, lanes, stock, capacity]);

  const result = useMemo(
    () => analyzeDeadPositions({ lanes, current, stock, capacity }),
    [lanes, current, stock, capacity],
  );

  const newlyEmpty = useMemo(() => new Set(result.newlyEmptyLaneIds), [result]);

  const groups = useMemo<LaneChartGroup[]>(() => {
    const currentById = new Map(result.current.lanes.map((l) => [l.laneId, l]));
    const byDepth = new Map<number, LaneChartRow[]>();
    for (const proposal of result.proposal.lanes) {
      const currentLane = currentById.get(proposal.laneId);
      if (!currentLane) continue;
      const rows = byDepth.get(proposal.depth) ?? [];
      rows.push({
        laneId: proposal.laneId,
        label: proposal.label,
        depth: proposal.depth,
        current: currentLane,
        proposal,
        newlyEmpty: newlyEmpty.has(proposal.laneId),
      });
      byDepth.set(proposal.depth, rows);
    }
    return [...byDepth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, rows]) => ({
        depth,
        rows: rows.sort((a, b) => a.label.localeCompare(b.label, 'ja')),
      }));
  }, [result, newlyEmpty]);

  const maxDepth = useMemo(
    () => lanes.reduce((max, lane) => Math.max(max, lane.depth), 1),
    [lanes],
  );

  const depthsInUse = useMemo(() => {
    const set = new Set(lanes.map((l) => l.depth));
    return LANE_DEPTHS.filter((d) => set.has(d));
  }, [lanes]);

  const sizeIdsInUse = useMemo(() => {
    const ids = new Set(stockRows.map((r) => r.productSizeId));
    return [...ids];
  }, [stockRows]);

  /* ------------------------------------------------------------ 書き出し */

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const [exporting, setExporting] = useState(false);

  const handleExportPng = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    setExporting(true);

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const width = Number(svg.getAttribute('width') ?? 980);
    const height = Number(svg.getAttribute('height') ?? 600);
    const serialized = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(
      new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }),
    );

    const image = new Image();
    const finish = (): void => {
      URL.revokeObjectURL(url);
      setExporting(false);
    };

    image.onload = () => {
      const scale = 2; // 印刷に耐える解像度
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        finish();
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          // ブラウザが blob の非ASCIIファイル名を落とすため、英数字で付ける
          link.download = `dead-position-${new Date().toISOString().slice(0, 10)}.png`;
          // ファイル名を効かせるには一度DOMに入れる必要がある
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
        }
        finish();
      }, 'image/png');
    };
    image.onerror = finish;
    image.src = url;
  }, []);

  /* -------------------------------------------------------------- 表示 */

  const metricRows: { label: string; get: (m: DeadPositionMetrics) => string; delta: string }[] = [
    {
      label: '総在庫本数',
      get: (m) => `${num(m.totalUnits)} 本`,
      delta: `${signed(result.proposal.metrics.totalUnits - result.current.metrics.totalUnits)} 本`,
    },
    {
      label: '使用レーン数',
      get: (m) => `${num(m.usedLanes)} レーン`,
      delta: `${signed(result.delta.usedLanes)} レーン`,
    },
    {
      label: '総収容能力',
      get: (m) => `${num(m.capacityUnits)} 本`,
      delta: `${signed(result.proposal.metrics.capacityUnits - result.current.metrics.capacityUnits)} 本`,
    },
    {
      label: '死にポジション本数',
      get: (m) => `${num(m.deadUnits)} 本`,
      delta: `${signed(result.delta.deadUnits)} 本`,
    },
    {
      label: '死にポジション率',
      get: (m) => pct(m.deadRate),
      delta: signedPt(result.delta.deadRate),
    },
    {
      label: '完全空きレーン数',
      get: (m) => `${num(m.emptyLanes)} レーン`,
      delta: `${signed(result.delta.emptyLanes)} レーン`,
    },
    {
      label: '収容溢れ本数',
      get: (m) => `${num(m.overflowUnits)} 本`,
      delta: `${signed(result.delta.overflowUnits)} 本`,
    },
  ];

  const hasData = lanes.length > 0 && stock.length > 0;

  return (
    <div className="dead-position">
      <div className="dp-toolbar no-print">
        <div className="dp-toolbar-group">
          <label>
            データ
            <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="sample">サンプルデータ</option>
              <option value="layout">現在のレイアウト</option>
            </select>
          </label>
          <span className="dp-hint">
            {source === 'sample'
              ? 'タイヤ倉庫を想定した架空データ'
              : 'ラックの列をレーンとして扱います（奥行きはラックの laneDepth、未設定は1）'}
          </span>
        </div>
        <div className="dp-toolbar-group">
          <button type="button" onClick={() => setShowInputs((v) => !v)}>
            {showInputs ? '入力データを隠す' : '入力データを表示'}
          </button>
          <button type="button" onClick={handlePrint} disabled={!hasData}>
            印刷
          </button>
          <button type="button" onClick={handleExportPng} disabled={!hasData || exporting}>
            {exporting ? '書き出し中…' : '画像として保存'}
          </button>
        </div>
      </div>

      {!hasData && (
        <p className="dp-empty">
          {lanes.length === 0
            ? 'レーンがありません。平面図にラックを配置するか、データを「サンプルデータ」に切り替えてください。'
            : 'ピーク在庫が未入力です。「入力データを表示」から在庫本数を入力してください。'}
        </p>
      )}

      {hasData && (
        <>
          <div className="dp-hero">
            <div className="dp-hero-main">
              <span className="dp-hero-label">死にポジション率</span>
              <span className="dp-hero-value">{pct(result.current.metrics.deadRate)}</span>
              <span className="dp-hero-arrow">→</span>
              <span className="dp-hero-value dp-hero-after">
                {pct(result.proposal.metrics.deadRate)}
              </span>
              <span
                className={`dp-hero-delta ${result.delta.deadRate <= 0 ? 'good' : 'bad'}`}
              >
                {signedPt(result.delta.deadRate)}
              </span>
            </div>
            <div className="dp-hero-sub">
              死にポジション {num(result.current.metrics.deadUnits)} 本 →{' '}
              {num(result.proposal.metrics.deadUnits)} 本（{signed(result.delta.deadUnits)} 本） ／
              完全空きレーン {num(result.current.metrics.emptyLanes)} →{' '}
              {num(result.proposal.metrics.emptyLanes)} レーン
            </div>
          </div>

          <section className="dp-section">
            <h2>指標</h2>
            <table className="dp-table dp-metrics">
              <thead>
                <tr>
                  <th>指標</th>
                  <th>現状</th>
                  <th>改善案</th>
                  <th>差分</th>
                </tr>
              </thead>
              <tbody>
                {metricRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.get(result.current.metrics)}</td>
                    <td>{row.get(result.proposal.metrics)}</td>
                    <td>{row.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dp-note">
              現状の割り当ては
              {source === 'sample'
                ? '「入荷順に手前のレーンへ詰めてきた」運用を再現したもの'
                : '「深さを考慮せずレーン順に手前から詰める」現行ルール'}
              。改善案は貪欲法（{ALLOCATION_ORDER_LABELS[result.strategy]}）で組み直した結果。
            </p>
          </section>

          {(result.warnings.length > 0 || result.unplaced.length > 0) && (
            <section className="dp-section">
              <h2>注意</h2>
              <ul className="dp-warnings">
                {result.warnings.map((warning) => (
                  <li key={warning}>▲ {warning}</li>
                ))}
                {result.unplaced.map((u) => (
                  <li key={`${u.productSizeId}-${u.yearWeek ?? ''}`}>
                    ■ {sizeLabels[u.productSizeId] ?? u.productSizeId}
                    {u.yearWeek ? `（${u.yearWeek}）` : ''} の {num(u.units)} 本が置き切れません：
                    {u.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="dp-section">
            <h2>レーン占有図</h2>
            <div className="dp-chart">
              <LaneChart ref={svgRef} groups={groups} maxDepth={maxDepth} sizeLabels={sizeLabels} />
            </div>
          </section>

          <section className="dp-section dp-columns">
            <div>
              <h2>深さ別</h2>
              <table className="dp-table">
                <thead>
                  <tr>
                    <th>深さ</th>
                    <th>レーン</th>
                    <th>使用（現→改）</th>
                    <th>空き（現→改）</th>
                    <th>死に（現→改）</th>
                  </tr>
                </thead>
                <tbody>
                  {result.proposal.byDepth.map((d) => {
                    const before = result.current.byDepth.find((x) => x.depth === d.depth);
                    return (
                      <tr key={d.depth}>
                        <th scope="row">{d.depth}</th>
                        <td>{d.lanes}</td>
                        <td>
                          {before?.usedLanes ?? 0} → {d.usedLanes}
                        </td>
                        <td>
                          {before?.emptyLanes ?? 0} → {d.emptyLanes}
                        </td>
                        <td>
                          {num(before?.deadUnits ?? 0)} → {num(d.deadUnits)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <h2>サイズ別（改善案）</h2>
              <table className="dp-table">
                <thead>
                  <tr>
                    <th>サイズ</th>
                    <th>在庫</th>
                    <th>レーン</th>
                    <th>収容</th>
                    <th>死に</th>
                  </tr>
                </thead>
                <tbody>
                  {result.proposal.bySize.map((s) => (
                    <tr key={s.productSizeId}>
                      <th scope="row">{sizeLabels[s.productSizeId] ?? s.productSizeId}</th>
                      <td>{num(s.units)}</td>
                      <td>{s.lanes}</td>
                      <td>{num(s.capacityUnits)}</td>
                      <td>{num(s.deadUnits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="dp-section">
            <h2>貪欲法の試行</h2>
            <table className="dp-table">
              <thead>
                <tr>
                  <th>並び順</th>
                  <th>死にポジション</th>
                  <th>溢れ</th>
                  <th>使用レーン</th>
                  <th>空きレーン</th>
                  <th>採用</th>
                </tr>
              </thead>
              <tbody>
                {result.attempts.map((a) => (
                  <tr key={a.order} className={a.selected ? 'dp-selected' : undefined}>
                    <th scope="row">{ALLOCATION_ORDER_LABELS[a.order]}</th>
                    <td>{num(a.deadUnits)} 本</td>
                    <td>{num(a.overflowUnits)} 本</td>
                    <td>{a.usedLanes}</td>
                    <td>{a.emptyLanes}</td>
                    <td>{a.selected ? '★' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dp-note">
              9種類の深さをすべて試し、死にポジションが最小になる深さを選ぶ。並び順を変えて
              {result.attempts.length}通り計算し、最良のものを採用する（焼きなまし・遺伝的
              アルゴリズムは使わない）。
            </p>
          </section>
        </>
      )}

      {showInputs && (
        <section className="dp-section no-print">
          <h2>入力データ</h2>

          <h3>ピーク在庫</h3>
          <table className="dp-table dp-input-table">
            <thead>
              <tr>
                <th>サイズ</th>
                <th>製造年週</th>
                <th>ピーク在庫本数</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{sizeLabels[row.productSizeId] ?? row.productSizeId}</th>
                  <td>{row.yearWeek ?? '—'}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={row.units}
                      onChange={(e) => {
                        const units = Math.max(0, Number(e.target.value));
                        setStockRows((rows) =>
                          rows.map((r) => (r.key === row.key ? { ...r, units } : r)),
                        );
                      }}
                    />
                  </td>
                </tr>
              ))}
              {stockRows.length === 0 && (
                <tr>
                  <td colSpan={3}>商品サイズマスタが未登録です。</td>
                </tr>
              )}
            </tbody>
          </table>

          <h3>収容本数マスタ（1レーンあたりの本数）</h3>
          <div className="dp-scroll">
            <table className="dp-table dp-input-table">
              <thead>
                <tr>
                  <th>サイズ \ 深さ</th>
                  {depthsInUse.map((depth) => (
                    <th key={depth}>{depth}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sizeIdsInUse.map((sizeId) => (
                  <tr key={sizeId}>
                    <th scope="row">{sizeLabels[sizeId] ?? sizeId}</th>
                    {depthsInUse.map((depth) => {
                      const entry = capacity.find(
                        (c) => c.depth === depth && c.productSizeId === sizeId,
                      );
                      return (
                        <td key={depth}>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={entry?.unitsPerLane ?? 0}
                            onChange={(e) => {
                              const unitsPerLane = Math.max(0, Number(e.target.value));
                              const next = capacity.filter(
                                (c) => !(c.depth === depth && c.productSizeId === sizeId),
                              );
                              next.push({ depth, productSizeId: sizeId, unitsPerLane });
                              setCapacity(next);
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dp-note">
            深さ {LANE_DEPTHS.join(' / ')} の9種類を対象にする。現在のレーンに存在する深さのみ
            表示している。
          </p>
        </section>
      )}
    </div>
  );
}
