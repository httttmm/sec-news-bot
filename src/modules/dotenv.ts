import fs from 'node:fs';
import path from 'node:path';

/**
 * .env をパースして process.env にロードする。
 * 依存追加を避けるため dotenv パッケージは使わずに最小実装。
 *
 * - ファイルが無ければ何もしない (GitHub Actions など想定)
 * - すでに process.env に値がある場合は **上書きしない**
 * - `KEY=VALUE` 形式のみ対応。`export` プレフィックスは無視可
 * - シングル/ダブルクォートで囲われていればクォートを外す
 * - ダブルクォート内では `\n` / `\r` / `\t` / `\"` / `\\` をエスケープ解釈
 *   (シングルクォートは literal なので解釈しない)
 */
export function loadDotenvIfPresent(file = '.env'): void {
  try {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      // `export KEY=value` も許容
      const lineNoExport = line.replace(/^export\s+/i, '');
      const eq = lineNoExport.indexOf('=');
      if (eq <= 0) continue;
      const key = lineNoExport.slice(0, eq).trim();
      let value = lineNoExport.slice(eq + 1).trim();
      // 行末にインラインコメントがあれば落とす (クォート外のみ)
      if (!isDoubleQuoted(value) && !isSingleQuoted(value)) {
        const hashIdx = value.indexOf(' #');
        if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
      }
      // クォートが付いていれば外す
      if (isDoubleQuoted(value)) {
        value = unescapeDoubleQuoted(value.slice(1, -1));
      } else if (isSingleQuoted(value)) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env が壊れていても本処理は止めない
  }
}

function isDoubleQuoted(s: string): boolean {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"');
}

function isSingleQuoted(s: string): boolean {
  return s.length >= 2 && s.startsWith("'") && s.endsWith("'");
}

/**
 * ダブルクォートで囲まれた文字列内のエスケープシーケンスを解釈する。
 * dotenv の de facto 仕様に合わせ、`\n` / `\r` / `\t` / `\"` / `\\` を扱う。
 */
function unescapeDoubleQuoted(s: string): string {
  return s.replace(/\\([nrt"\\])/g, (_m, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return ch;
    }
  });
}
