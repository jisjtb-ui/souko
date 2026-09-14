import { useMemo } from 'react';
import { Shape } from 'react-konva';
import { isRackObject } from '@ws/shared';
import type { LayoutObject, Location, Rect } from '@ws/shared';

interface Props {
  objects: LayoutObject[];
  locations: Location[];
  scale: number;
  showCodes: boolean;
  highlightRackId?: string | undefined;
  /** 画面に映っている範囲 (m)。範囲外は描画しない。 */
  viewport: Rect;
}

interface RackInfo {
  rotationDeg: number;
  /** その列の代表として描く段（最下段） */
  baseLevel: number;
}

const NORMAL_STROKE = '#8fa6c4';
const HIGHLIGHT_STROKE = '#1668dc';
const HIGHLIGHT_FILL = 'rgba(22,104,220,0.12)';
const TEXT_COLOR = '#33465e';

/**
 * ラック内のロケーションを平面図に描く。
 *
 * 2D では同じ列の各段が重なるため、列ごとに1マスとしてまとめて表示する
 * (段数は在庫パネル側で確認する)。
 *
 * ロケーションは数万件になり得るため、1件ずつ Konva ノードを作らず
 * 1つの Shape にまとめて描画し、画面外のマスは描かない。
 */
export function LocationLayer({
  objects,
  locations,
  scale,
  showCodes,
  highlightRackId,
  viewport,
}: Props): JSX.Element {
  // ラックの回転と「代表として描く段」はラック定義から決まる（ロケーション数に依存しない）
  const rackInfo = useMemo(() => {
    const map = new Map<string, RackInfo>();
    for (const object of objects) {
      if (!isRackObject(object)) continue;
      map.set(object.id, {
        rotationDeg: object.rotationDeg,
        baseLevel: object.rack.naming.levelStart,
      });
    }
    return map;
  }, [objects]);

  const showText = showCodes && scale > 5;
  const fontSize = 9 / scale;
  const hairline = 0.6 / scale;

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        const minX = viewport.x;
        const minY = viewport.y;
        const maxX = viewport.x + viewport.widthM;
        const maxY = viewport.y + viewport.depthM;

        // 枠線は色ごとにまとめて1回だけ stroke する（マスごとの stroke は重い）
        ctx.beginPath();
        let highlighted: Location[] | null = null;
        let textTargets: Location[] | null = null;

        for (const location of locations) {
          const rack = rackInfo.get(location.rackId);
          if (!rack) continue;
          // 同じ列の各段は重なるため、最下段だけを代表として描く
          if (location.level !== rack.baseLevel) continue;

          // 画面外のマスは描かない（ビューポートカリング）
          const reach = Math.max(location.widthM, location.depthM);
          if (
            location.x + reach < minX ||
            location.x - reach > maxX ||
            location.y + reach < minY ||
            location.y - reach > maxY
          ) {
            continue;
          }

          if (location.rackId === highlightRackId) {
            (highlighted ??= []).push(location);
          } else {
            addCellPath(ctx, location, rack.rotationDeg);
          }
          if (showText) (textTargets ??= []).push(location);
        }

        ctx.setAttr('strokeStyle', NORMAL_STROKE);
        ctx.setAttr('lineWidth', hairline);
        ctx.stroke();

        // 選択中のラックは塗りつぶし＋濃い枠で強調する
        if (highlighted) {
          ctx.beginPath();
          for (const location of highlighted) {
            addCellPath(ctx, location, rackInfo.get(location.rackId)!.rotationDeg);
          }
          ctx.setAttr('fillStyle', HIGHLIGHT_FILL);
          ctx.fill();
          ctx.setAttr('strokeStyle', HIGHLIGHT_STROKE);
          ctx.setAttr('lineWidth', hairline);
          ctx.stroke();
        }

        if (textTargets) {
          ctx.setAttr('fillStyle', TEXT_COLOR);
          ctx.setAttr('font', `${fontSize}px sans-serif`);
          ctx.setAttr('textAlign', 'center');
          ctx.setAttr('textBaseline', 'middle');
          for (const location of textTargets) {
            const rotation = rackInfo.get(location.rackId)!.rotationDeg;
            if (rotation === 0) {
              ctx.fillText(location.code, location.x, location.y);
            } else {
              ctx.save();
              ctx.translate(location.x, location.y);
              ctx.rotate((rotation * Math.PI) / 180);
              ctx.fillText(location.code, 0, 0);
              ctx.restore();
            }
          }
        }
      }}
    />
  );
}

/** 1マス分の矩形を現在のパスへ追加する。 */
function addCellPath(
  ctx: {
    rect: (x: number, y: number, w: number, h: number) => void;
    save: () => void;
    restore: () => void;
    translate: (x: number, y: number) => void;
    rotate: (rad: number) => void;
    moveTo: (x: number, y: number) => void;
    lineTo: (x: number, y: number) => void;
    closePath: () => void;
  },
  location: Location,
  rotationDeg: number,
): void {
  const halfW = location.widthM / 2;
  const halfD = location.depthM / 2;

  if (rotationDeg === 0) {
    ctx.rect(location.x - halfW, location.y - halfD, location.widthM, location.depthM);
    return;
  }

  // 回転したラックは四隅を計算してパスに追加する（save/restore を挟まない）
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: [number, number][] = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ];
  for (const [index, [lx, ly]] of corners.entries()) {
    const x = location.x + lx * cos - ly * sin;
    const y = location.y + lx * sin + ly * cos;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
