import { distance, kmhToMps } from '../geometry/index.js';
import type { Vec2 } from '../domain/types.js';

export interface TravelProfile {
  /** 最大速度 (km/h) */
  maxSpeedKmh: number;
  /** 加速度 (m/s^2) */
  accelMps2: number;
  /** 減速度 (m/s^2) */
  decelMps2: number;
  /** 倉庫内制限速度 (km/h)。超過分は違反として記録する。 */
  speedLimitKmh?: number;
  /** 方向転換1回あたりのロス時間 (秒) */
  turnPenaltySeconds?: number;
}

export interface TravelEstimate {
  /** 走行時間 (秒) */
  seconds: number;
  /** 走行距離 (m) */
  distanceM: number;
  /** 制限速度を超過して走った時間 (秒) */
  violationSeconds: number;
  /** 制限速度を超過して走った距離 (m) */
  violationMeters: number;
  /** 方向転換回数 */
  turns: number;
}

/**
 * 台形速度プロファイル (加速 -> 定速 -> 減速) で1区間の走行時間を求める。
 * 距離が短く最大速度に達しない場合は三角プロファイルになる。
 */
export function segmentTravelSeconds(
  distanceM: number,
  cruiseMps: number,
  accel: number,
  decel: number,
): number {
  if (distanceM <= 0) return 0;
  const a = Math.max(0.01, accel);
  const d = Math.max(0.01, decel);
  const accelDist = (cruiseMps * cruiseMps) / (2 * a);
  const decelDist = (cruiseMps * cruiseMps) / (2 * d);

  if (accelDist + decelDist <= distanceM) {
    const cruiseDist = distanceM - accelDist - decelDist;
    return cruiseMps / a + cruiseDist / cruiseMps + cruiseMps / d;
  }
  // 三角プロファイル: 到達可能な最高速度を求める
  const peak = Math.sqrt((2 * distanceM * a * d) / (a + d));
  return peak / a + peak / d;
}

/**
 * 経路全体の走行時間を見積もる。
 * 各頂点で一旦減速する前提（現実のフォークリフトは曲がる際に減速する）。
 */
export function estimateTravel(points: readonly Vec2[], profile: TravelProfile): TravelEstimate {
  const cruise = kmhToMps(profile.maxSpeedKmh);
  const limit = profile.speedLimitKmh ? kmhToMps(profile.speedLimitKmh) : Number.POSITIVE_INFINITY;
  const turnPenalty = profile.turnPenaltySeconds ?? 0;

  let seconds = 0;
  let total = 0;
  let violationSeconds = 0;
  let violationMeters = 0;
  let turns = 0;

  for (let i = 1; i < points.length; i++) {
    const segLen = distance(points[i - 1]!, points[i]!);
    if (segLen <= 0) continue;
    total += segLen;
    const segSeconds = segmentTravelSeconds(segLen, cruise, profile.accelMps2, profile.decelMps2);
    seconds += segSeconds;

    if (cruise > limit) {
      // 制限速度を超えて巡航している区間 (加減速部分を除いた概算)
      const overDist = Math.max(0, segLen - (cruise * cruise) / (2 * profile.accelMps2) - (cruise * cruise) / (2 * profile.decelMps2));
      violationMeters += overDist;
      violationSeconds += overDist / cruise;
    }
    if (i >= 2) {
      const prev = points[i - 2]!;
      const mid = points[i - 1]!;
      const next = points[i]!;
      const a1 = Math.atan2(mid.y - prev.y, mid.x - prev.x);
      const a2 = Math.atan2(next.y - mid.y, next.x - mid.x);
      let diff = Math.abs(a2 - a1);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > 0.2) {
        turns += 1;
        seconds += turnPenalty;
      }
    }
  }

  return { seconds, distanceM: total, violationSeconds, violationMeters, turns };
}

export interface AdvanceResult {
  position: Vec2;
  /** 次に目指す点のインデックス */
  index: number;
  headingDeg: number;
  /** 実際に進んだ距離 (m) */
  movedM: number;
  /** 経路の終端に到達したか */
  finished: boolean;
}

/**
 * 経路上を指定距離だけ前進させる。アニメーション/シミュレーションの1ステップ。
 */
export function advanceAlongPath(
  points: readonly Vec2[],
  position: Vec2,
  index: number,
  distanceM: number,
): AdvanceResult {
  let remaining = distanceM;
  let pos = { ...position };
  let idx = index;
  let heading = 0;
  let moved = 0;

  while (remaining > 1e-9 && idx < points.length) {
    const target = points[idx]!;
    const segLen = distance(pos, target);
    heading = (Math.atan2(target.y - pos.y, target.x - pos.x) * 180) / Math.PI;
    if (segLen <= remaining) {
      pos = { ...target };
      moved += segLen;
      remaining -= segLen;
      idx += 1;
    } else {
      const t = remaining / segLen;
      pos = { x: pos.x + (target.x - pos.x) * t, y: pos.y + (target.y - pos.y) * t };
      moved += remaining;
      remaining = 0;
    }
  }

  return {
    position: pos,
    index: idx,
    headingDeg: heading,
    movedM: moved,
    finished: idx >= points.length,
  };
}
