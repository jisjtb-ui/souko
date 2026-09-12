import { HEATMAP_LAYER_META, HEAT_RAMPS } from '@ws/shared';
import type { Heatmap, HeatmapLayerKey } from '@ws/shared';

/**
 * ヒートマップの凡例。
 * 単一色相の連続スケールなので、薄い＝少ない / 濃い＝多い の一次元で読める。
 */
export function HeatmapLegend({
  layer,
  heatmap,
}: {
  layer: HeatmapLayerKey;
  heatmap: Heatmap;
}): JSX.Element {
  const meta = HEATMAP_LAYER_META[layer];
  const max = heatmap.maxOf(layer);
  const total = heatmap.totalOf(layer);
  const hotCells = heatmap.cells(layer, 0.02).length;
  const format = (value: number): string =>
    meta.unit === '秒'
      ? value >= 3600
        ? `${(value / 3600).toFixed(1)}時間`
        : value >= 60
          ? `${Math.round(value / 60)}分`
          : `${Math.round(value)}秒`
      : `${Math.round(value).toLocaleString()}${meta.unit}`;

  return (
    <div className="heat-legend">
      <div className="heat-legend-title">{meta.label}</div>
      <div className="heat-legend-scale">
        {HEAT_RAMPS[layer].map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </div>
      <div className="heat-legend-axis">
        <span>少ない</span>
        <span>1マスあたり最大 {format(max)}</span>
      </div>
      <div className="heat-legend-axis">
        <span>全体 {format(total)}</span>
        <span>{hotCells.toLocaleString()} マス</span>
      </div>
    </div>
  );
}
