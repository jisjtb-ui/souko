import { Group, Line, Rect, Text } from 'react-konva';
import type { Warehouse } from '@ws/shared';

interface Props {
  warehouse: Warehouse;
  /** 1m あたりの実ピクセル数 (ppm * zoom) */
  scale: number;
  visible: boolean;
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
 */
export function GridLayer({ warehouse, scale, visible }: Props): JSX.Element {
  const { widthM, depthM, gridSizeM } = warehouse;
  const step = effectiveStep(gridSizeM, scale);
  const major = step < 1 ? 1 : step * 5;
  const hairline = 1 / scale;

  const lines: JSX.Element[] = [];
  if (visible) {
    for (let x = 0; x <= widthM + 1e-6; x += step) {
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      lines.push(
        <Line
          key={`v${x.toFixed(3)}`}
          points={[x, 0, x, depthM]}
          stroke={isMajor ? '#c3ccd6' : '#e4e9ee'}
          strokeWidth={hairline}
          listening={false}
        />,
      );
    }
    for (let y = 0; y <= depthM + 1e-6; y += step) {
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      lines.push(
        <Line
          key={`h${y.toFixed(3)}`}
          points={[0, y, widthM, y]}
          stroke={isMajor ? '#c3ccd6' : '#e4e9ee'}
          strokeWidth={hairline}
          listening={false}
        />,
      );
    }
  }

  // 目盛り (10m ごと)
  const ticks: JSX.Element[] = [];
  const tickStep = effectiveStep(10, scale);
  const fontSize = 11 / scale;
  for (let x = 0; x <= widthM + 1e-6; x += tickStep) {
    ticks.push(
      <Text
        key={`tx${x}`}
        x={x + 0.2 / scale}
        y={-fontSize * 1.4}
        text={`${Math.round(x)}m`}
        fontSize={fontSize}
        fill="#8a949e"
        listening={false}
      />,
    );
  }
  for (let y = tickStep; y <= depthM + 1e-6; y += tickStep) {
    ticks.push(
      <Text
        key={`ty${y}`}
        x={-fontSize * 2.6}
        y={y - fontSize / 2}
        text={`${Math.round(y)}m`}
        fontSize={fontSize}
        fill="#8a949e"
        listening={false}
      />,
    );
  }

  return (
    <Group>
      <Rect x={0} y={0} width={widthM} height={depthM} fill="#ffffff" stroke="#5a646e" strokeWidth={2 / scale} />
      {lines}
      {ticks}
    </Group>
  );
}
