/**
 * 決定論的な擬似乱数 (mulberry32)。
 *
 * 同じシードなら常に同じイベント列を生成する。
 * レイアウトA/Bを「同じ入出庫データ」で比較するために必須。
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** 0以上1未満 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min以上max未満の実数 */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** min以上max以下の整数 */
  int(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1));
  }

  /** 重み付き抽選。weights の合計が0なら -1 を返す。 */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    if (total <= 0) return -1;
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i]!);
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next() * items.length)];
  }
}
