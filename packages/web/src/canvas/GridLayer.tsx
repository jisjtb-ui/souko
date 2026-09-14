import { Group, Rect, Shape } from 'react-konva';
import type { Rect as WorldRect, Warehouse } from '@ws/shared';

interface Props {
  warehouse: Warehouse;
  /** 1m あたりの実ピクセル数 (ppm * zoom) */
  scale: number;
  visible: boolean;
  /** 画面に映っている範囲 (m) */
  viewport: WorldRect;
}

/** 表示密度に応じてグリッド間隔を粗くする (線が潰れるのを防ぐ)。 */
function effectiveStep(baseStepM: number, scale: number): number {
  let step = baseStepM;
  while (step * scale < 6) step *= step < 1 ? 2 : 5;
  return step;
}

/**
 * 倉庫の床とグリッド。
 * 実寸ベースなので、グリッド1マス = 設定した m 数を正確に表す。
 *
 * グリッド線は倉庫が大きいほど本数が増えるため、線ごとに Konva ノードを作らず
 * 1つの Shape へまとめて描画し、画面に映る範囲だけを描く。
 */
export function GridLayer({ warehouse, scale, visible, viewport }: Props): JSX.Element {
  const { widthM, depthM, gridSizeM } = warehouse;
  const step = effectiveStep(gridSizeM, scale);
  const major = step < 1 ? 1 : step * 5;
  const hairline = 1 / scale;
  const fontSize = 11 / scale;
  const tickStep = effectiveStep(10, scale);

  // 画面に映る範囲だけを描く（倉庫の外へはみ出さないよう床の内側に丸める）
  const fromX = Math.max(0, Math.floor(viewport.x / step) * step);
  const toX = Math.min(widthM, viewport.x + viewport.widthM + step);
  const fromY = Math.max(0, Math.floor(viewport.y / step) * step);
  const toY = Math.min(depthM, viewport.y + viewport.depthM + step);

  return (
    <Group>
      {/* 敷地（この上にエリア＝建屋の床を重ねる） */}
      <Rect
        x={0}
        y={0}
        width={widthM}
        height={depthM}
        fill="#e8ecf1"
        stroke="#aab4bf"
        strokeWidth={1.5 / scale}
        dash={[1.2, 0.8]}
      />

      {visible && (
        <Shape
          listening={false}
          perfectDrawEnabled={false}
          sceneFunc={(ctx) => {
            const drawLines = (isMajorPass: boolean): void => {
              ctx.beginPath();
              for (let x = fromX; x <= toX + 1e-6; x += step) {
                const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
                if (isMajor !== isMajorPass) continue;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, depthM);
              }
              for (let y = fromY; y <= toY + 1e-6; y += step) {
                const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
                if (isMajor !== isMajorPass) continue;
                ctx.moveTo(0, y);
                ctx.lineTo(widthM, y);
              }
              ctx.setAttr('strokeStyle', isMajorPass ? '#ccd5df' : '#dfe5eb');
              ctx.setAttr('lineWidth', hairline);
              ctx.stroke();
            };
            drawLines(false);
            drawLines(true);
          }}
        />
      )}

      {/* 目盛り (10m ごと) */}
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(ctx) => {
          ctx.setAttr('fillStyle', '#8a949e');
          ctx.setAttr('font', `${fontSize}px sans-serif`);
          ctx.setAttr('textBaseline', 'alphabetic');
          ctx.setAttr('textAlign', 'left');
          for (let x = 0; x <= widthM + 1e-6; x += tickStep) {
            ctx.fillText(`${Math.round(x)}m`, x + 0.2 / scale, -fontSize * 0.4);
          }
          ctx.setAttr('textAlign', 'right');
          for (let y = tickStep; y <= depthM + 1e-6; y += tickStep) {
            ctx.fillText(`${Math.round(y)}m`, -fontSize * 0.5, y + fontSize * 0.35);
          }
        }}
      />
    </Group>
  );
}
