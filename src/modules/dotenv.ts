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
      if (!isQuoted(value)) {
        const hashIdx = value.indexOf(' #');
        if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
      }
      // クォートが付いていれば外す
      if (isQuoted(value)) {
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

function isQuoted(s: string): boolean {
  return (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'")))
  );
}
