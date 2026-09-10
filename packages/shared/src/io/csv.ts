/**
 * 依存ライブラリなしの CSV パーサ / シリアライザ。
 * Excel から保存した CSV (BOM付き・CRLF・引用符入り) を想定している。
 */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // CRLF の CR は無視
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function escapeField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(escapeField).join(',')).join('\r\n');
}

export interface CsvColumn<T> {
  /** ヘッダ名 (日本語可) */
  header: string;
  /** 値の取り出し */
  get: (row: T) => unknown;
  /** インポート時に対応するキー */
  key?: string;
}

export function objectsToCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => c.get(row)));
  // Excel が UTF-8 と判定できるように BOM を付ける
  return `﻿${toCsv([header, ...body])}`;
}

/** ヘッダ行を使って CSV をレコードの配列に変換する。 */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = (row[i] ?? '').trim();
    });
    return rec;
  });
}

export function parseNumber(value: string | undefined, fallback = 0): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
