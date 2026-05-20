import { promises as fs } from 'node:fs';
import path from 'node:path';

/** デフォルトの保持上限件数 */
export const DEFAULT_MAX_STORED_URLS = 1000;
/** 上限到達時のバッチ削減率 (デフォルト 10%)。
 *  max=1000, ratio=0.1 → 1001 件になったら 900 件まで一気に削減 */
const TRIM_RATIO = 0.1;

interface StoreFileFormat {
  /** スキーマバージョン (将来の移行に備える) */
  version: 1;
  /** 投稿済み URL を新しい順に保持する */
  urls: string[];
}

export interface LoadPostedUrlsOptions {
  /**
   * 保持する最大件数。これを超えると古いものから削除される。
   * デフォルト 1000。
   */
  maxStoredUrls?: number;
}

export interface PostedUrlsStore {
  /** URL がすでに投稿済みかどうか */
  has(url: string): boolean;
  /** URL を投稿済みとして記録する (メモリ内のみ。永続化は save 時) */
  markAsPosted(url: string): void;
  /** 現在保持している URL 件数 */
  size(): number;
  /** ファイルに保存する */
  save(): Promise<void>;
}

/**
 * 指定パスから投稿済み URL のストアを読み込む。
 * - ファイルが存在しない場合は空のストアを返す
 * - 古いバージョン (配列のみ) のフォーマットも読み込み可能
 * - `maxStoredUrls` を指定すると、その件数を上限として古いものから削除する
 *   (バッチ削減方式: 上限到達時に 10% 分を一気にトリム)
 */
export async function loadPostedUrls(
  filePath: string,
  options: LoadPostedUrlsOptions = {}
): Promise<PostedUrlsStore> {
  const max = normalizeMax(options.maxStoredUrls);
  const urls = await readUrlsFile(filePath);
  return createStore(filePath, urls, max);
}

function createStore(
  filePath: string,
  initialUrls: string[],
  max: number
): PostedUrlsStore {
  // 上限を超えた時に削減する目標サイズ (max の 90%)
  const trimTarget = Math.max(1, Math.floor(max * (1 - TRIM_RATIO)));

  // 内部表現は "新しい順" の配列 + 高速検索用 Set
  // 読み込み時点で上限を超えていれば即トリム (既存ファイルの肥大化対策)
  let urls: string[] = [...initialUrls];
  if (urls.length > max) {
    urls = urls.slice(0, trimTarget);
  }
  const set = new Set<string>(urls);

  return {
    has(url: string): boolean {
      return set.has(url);
    },
    markAsPosted(url: string): void {
      if (set.has(url)) return;
      // 新しいものを先頭に挿入
      urls.unshift(url);
      set.add(url);
      // 上限を超えたら trimTarget までバッチ削減
      if (urls.length > max) {
        const removed = urls.splice(trimTarget);
        for (const r of removed) set.delete(r);
      }
    },
    size(): number {
      return urls.length;
    },
    async save(): Promise<void> {
      await ensureParentDir(filePath);
      const payload: StoreFileFormat = { version: 1, urls };
      const json = JSON.stringify(payload, null, 2) + '\n';
      await fs.writeFile(filePath, json, 'utf-8');
    },
  };
}

function normalizeMax(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_STORED_URLS;
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_MAX_STORED_URLS;
  return Math.floor(raw);
}

async function readUrlsFile(filePath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if (isFileNotFound(err)) return [];
    throw err;
  }

  const trimmed = raw.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Failed to parse posted_urls file: ${filePath}`);
  }

  // 新フォーマット { version, urls }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as StoreFileFormat).urls)
  ) {
    return ((parsed as StoreFileFormat).urls ?? []).filter(
      (u): u is string => typeof u === 'string'
    );
  }

  // 旧フォーマット (配列のみ)
  if (Array.isArray(parsed)) {
    return parsed.filter((u): u is string => typeof u === 'string');
  }

  return [];
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!dir || dir === '.' || dir === path.sep) return;
  await fs.mkdir(dir, { recursive: true });
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export const __testing = { DEFAULT_MAX_STORED_URLS, TRIM_RATIO };
