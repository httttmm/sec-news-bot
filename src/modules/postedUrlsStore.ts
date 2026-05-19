import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_STORED_URLS = 1000;

interface StoreFileFormat {
  /** スキーマバージョン (将来の移行に備える) */
  version: 1;
  /** 投稿済み URL を新しい順に保持する */
  urls: string[];
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
 */
export async function loadPostedUrls(filePath: string): Promise<PostedUrlsStore> {
  const urls = await readUrlsFile(filePath);
  return createStore(filePath, urls);
}

function createStore(filePath: string, initialUrls: string[]): PostedUrlsStore {
  // 内部表現は "新しい順" の配列 + 高速検索用 Set
  const urls: string[] = [...initialUrls];
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
      // 上限を超えたら古いものから削除
      while (urls.length > MAX_STORED_URLS) {
        const removed = urls.pop();
        if (removed !== undefined) {
          set.delete(removed);
        }
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

export const __testing = { MAX_STORED_URLS };
