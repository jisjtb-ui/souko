import { forwardRef, useMemo } from 'react';
import type { EvaluatedLane } from '@ws/shared';

/* ============================================================================
 * レーン占有図
 * ----------------------------------------------------------------------------
 * 横棒 1本 = 1レーン。棒の長さは奥行き(深さ)に比例し、
 * 塗り = 在庫、白 = 死にスペース。深さごとにグループ化し、
 * 各レーンについて「現状」と「改善案」を上下に重ねて並べる。
 *
 * 拡大縮小・パン・ドラッグは持たない（印刷と画像保存が目的のため）。
 * 画像保存のため、色はすべて presentation attribute で直接指定する。
 * ========================================================================== */

const COLOR = {
  /** 在庫 */
  stock: '#2a78d6',
  /** 死にスペース (レーンの地) */
  dead: '#ffffff',
  deadStroke: '#c9d4e2',
  /** 収容超過 */
  overflow: '#d03b3b',
  /** 新たに空いたレーン */
  freed: '#0ca30c',
  text: '#1e2732',
  muted: '#6b7785',
  rule: '#dde3ea',
  surface: '#ffffff',
} as const;

const WIDTH = 980;
const LABEL_X = 10;
const BAR_X = 92;
const BAR_W = 600;
const NUM_X = 706;
const NOTE_X = 838;
const BAR_H = 10;
const BAR_GAP = 3;
const ROW_H = 32;
const GROUP_HEAD_H = 30;
const LEGEND_H = 46;
const TOP_PAD = 8;
const BOTTOM_PAD = 16;
/** 溢れを棒からはみ出させて描く最大幅 */
const OVERFLOW_MAX_W = 44;

export interface LaneChartGroup {
  depth: number;
  rows: LaneChartRow[];
}

export interface LaneChartRow {
  laneId: string;
  label: string;
  depth: number;
  current: EvaluatedLane;
  proposal: EvaluatedLane;
  newlyEmpty: boolean;
}

interface Props {
  groups: LaneChartGroup[];
  maxDepth: number;
  sizeLabels: Record<string, string>;
}

interface BarProps {
  y: number;
  lane: EvaluatedLane;
  pxPerDepth: number;
  caption: string;
  sizeLabels: Record<string, string>;
  freed: boolean;
}

function Bar({ y, lane, pxPerDepth, caption, sizeLabels, freed }: BarProps): JSX.Element {
  const barLen = Math.max(6, lane.depth * pxPerDepth);
  const ratio = lane.capacityUnits > 0 ? Math.min(1, lane.units / lane.capacityUnits) : 0;
  const fillLen = Math.round(barLen * ratio);
  const overflowLen =
    lane.overflowUnits > 0 && lane.capacityUnits > 0
      ? Math.min(OVERFLOW_MAX_W, Math.round((lane.overflowUnits / lane.capacityUnits) * barLen) + 6)
      : 0;

  const sizeName = lane.productSizeId ? (sizeLabels[lane.productSizeId] ?? lane.productSizeId) : '空';
  const tooltip =
    `${caption} ${lane.label}（深さ${lane.depth}）\n` +
    (lane.empty
      ? '空レーン'
      : `${sizeName}${lane.yearWeek ? ` / ${lane.yearWeek}` : ''}\n` +
        `在庫 ${lane.units} 本 / 収容 ${lane.capacityUnits} 本\n` +
        `死にポジション ${lane.deadUnits} 本` +
        (lane.overflowUnits > 0 ? `\n溢れ ${lane.overflowUnits} 本` : ''));

  return (
    <g>
      <title>{tooltip}</title>
      <text x={BAR_X - 6} y={y + BAR_H - 1} fontSize={8} fill={COLOR.muted} textAnchor="end">
        {caption}
      </text>
      <rect
        x={BAR_X}
        y={y}
        width={barLen}
        height={BAR_H}
        rx={2}
        fill={COLOR.dead}
        stroke={freed ? COLOR.freed : COLOR.deadStroke}
        strokeWidth={freed ? 1.5 : 1}
        strokeDasharray={freed ? '4 2' : undefined}
      />
      {fillLen > 0 && (
        <rect x={BAR_X} y={y} width={fillLen} height={BAR_H} rx={2} fill={COLOR.stock} />
      )}
      {overflowLen > 0 && (
        <rect
          x={BAR_X + barLen + 2}
          y={y}
          width={overflowLen}
          height={BAR_H}
          rx={2}
          fill={COLOR.overflow}
        />
      )}
    </g>
  );
}

/**
 * レーン占有図。ref は画像保存で SVG を直接読むために使う。
 */
export const LaneChart = forwardRef<SVGSVGElement, Props>(function LaneChart(
  { groups, maxDepth, sizeLabels },
  ref,
): JSX.Element {
  const pxPerDepth = BAR_W / Math.max(1, maxDepth);

  const { height, placed } = useMemo(() => {
    let y = TOP_PAD + LEGEND_H;
    const out: { group: LaneChartGroup; headY: number; rows: { row: LaneChartRow; y: number }[] }[] =
      [];
    for (const group of groups) {
      const headY = y;
      y += GROUP_HEAD_H;
      const rows = group.rows.map((row) => {
        const rowY = y;
        y += ROW_H;
        return { row, y: rowY };
      });
      out.push({ group, headY, rows });
    }
    return { height: y + BOTTOM_PAD, placed: out };
  }, [groups]);

  return (
    <svg
      ref={ref}
      className="lane-chart"
      width={WIDTH}
      height={height}
      viewBox={`0 0 ${WIDTH} ${height}`}
      // 画像として書き出したときにも同じ書体で描かれるよう属性で指定する
      fontFamily='"Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, system-ui, sans-serif'
      role="img"
      aria-label="レーン別の在庫と死にスペース"
    >
      <rect x={0} y={0} width={WIDTH} height={height} fill={COLOR.surface} />

      {/* 凡例。記号は色だけに頼らず必ず文字を添える */}
      <g>
        <text x={LABEL_X} y={16} fontSize={11} fill={COLOR.text} fontWeight={600}>
          レーン占有図（棒の長さ＝奥行き／塗り＝在庫／白＝死にスペース）
        </text>
        <g transform={`translate(${LABEL_X}, 26)`}>
          <rect x={0} y={0} width={14} height={9} rx={2} fill={COLOR.stock} />
          <text x={19} y={8} fontSize={10} fill={COLOR.muted}>
            在庫
          </text>
          <rect
            x={60}
            y={0}
            width={14}
            height={9}
            rx={2}
            fill={COLOR.dead}
            stroke={COLOR.deadStroke}
          />
          <text x={79} y={8} fontSize={10} fill={COLOR.muted}>
            死にスペース
          </text>
          <rect x={168} y={0} width={14} height={9} rx={2} fill={COLOR.overflow} />
          <text x={187} y={8} fontSize={10} fill={COLOR.muted}>
            溢れ（収容超過）
          </text>
          <rect
            x={296}
            y={0}
            width={14}
            height={9}
            rx={2}
            fill={COLOR.dead}
            stroke={COLOR.freed}
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
          <text x={315} y={8} fontSize={10} fill={COLOR.muted}>
            改善案で新たに空いたレーン
          </text>
          <text x={BAR_X - 6} y={8} fontSize={8} fill={COLOR.muted} textAnchor="end">
            現／改
          </text>
          <text x={NUM_X} y={8} fontSize={10} fill={COLOR.muted}>
            在庫 / 収容（現状 → 改善案）
          </text>
        </g>
      </g>

      {placed.map(({ group, headY, rows }) => (
        <g key={group.depth}>
          <line x1={LABEL_X} y1={headY + 18} x2={WIDTH - 10} y2={headY + 18} stroke={COLOR.rule} />
          <text x={LABEL_X} y={headY + 14} fontSize={11} fill={COLOR.text} fontWeight={600}>
            深さ {group.depth}
          </text>
          <text x={LABEL_X + 64} y={headY + 14} fontSize={10} fill={COLOR.muted}>
            {group.rows.length} レーン
          </text>

          {rows.map(({ row, y }) => (
            <g key={row.laneId}>
              <text x={LABEL_X} y={y + 12} fontSize={10} fill={COLOR.text}>
                {row.label}
              </text>
              <Bar
                y={y}
                lane={row.current}
                pxPerDepth={pxPerDepth}
                caption="現"
                sizeLabels={sizeLabels}
                freed={false}
              />
              <Bar
                y={y + BAR_H + BAR_GAP}
                lane={row.proposal}
                pxPerDepth={pxPerDepth}
                caption="改"
                sizeLabels={sizeLabels}
                freed={row.newlyEmpty}
              />
              <text x={NUM_X} y={y + 9} fontSize={9} fill={COLOR.muted}>
                {row.current.empty
                  ? '空'
                  : `${row.current.units} / ${row.current.capacityUnits}`}
                {' → '}
                {row.proposal.empty
                  ? '空'
                  : `${row.proposal.units} / ${row.proposal.capacityUnits}`}
              </text>
              <text x={NOTE_X} y={y + 9} fontSize={9} fill={row.newlyEmpty ? COLOR.freed : COLOR.muted}>
                {row.newlyEmpty
                  ? '新たに空き'
                  : row.proposal.empty
                    ? ''
                    : `死に ${row.proposal.deadUnits} 本`}
              </text>
              <text x={NOTE_X} y={y + 20} fontSize={9} fill={COLOR.muted}>
                {row.proposal.productSizeId
                  ? (sizeLabels[row.proposal.productSizeId] ?? row.proposal.productSizeId)
                  : ''}
              </text>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
});
