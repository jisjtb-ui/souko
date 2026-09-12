import { useMemo } from 'react';
import { Shape } from 'react-konva';
import { heatColor, heatOpacity } from '@ws/shared';
import type { Heatmap, HeatmapLayerKey } from '@ws/shared';

interface Props {
  heatmap: Heatmap;
  layer: HeatmapLayerKey;
  /** 描画のしきい値（最大値に対する比率） */
  minRatio?: number;
}

/**
 * フォークリフトの移動データから作ったヒートマップの描画 (要件14)。
 *
 * セル数が多いため、1つの Shape 内でまとめて描く。
 * 値が小さいセルは薄く（床に溶ける）、大きいセルほど濃く表示する。
 */
export function HeatmapOverlay({ heatmap, layer, minRatio = 0.015 }: Props): JSX.Element | null {
  // セル抽出は描画のたびに走らせない
  const cells = useMemo(() => heatmap.cells(layer, minRatio), [heatmap, layer, minRatio]);
  if (cells.length === 0) return null;

  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        for (const cell of cells) {
          // 低い値は緩やかに、高い値は強く出す（平方根で中間を持ち上げる）
          const weight = Math.sqrt(cell.ratio);
          ctx.globalAlpha = heatOpacity(weight);
          ctx.fillStyle = heatColor(layer, weight);
          ctx.fillRect(cell.x, cell.y, cell.sizeM, cell.sizeM);
        }
        ctx.globalAlpha = 1;
      }}
    />
  );
}
