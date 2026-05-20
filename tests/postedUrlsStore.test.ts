import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPostedUrls } from '../src/modules/postedUrlsStore.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posted-urls-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('postedUrlsStore', () => {
  it('ファイルが存在しない場合は空ストアになる', async () => {
    const file = path.join(tmpDir, 'missing', 'posted.json');
    const store = await loadPostedUrls(file);
    expect(store.size()).toBe(0);
    expect(store.has('https://example.com/x')).toBe(false);
  });

  it('保存 → 再読込で内容が永続化される', async () => {
    const file = path.join(tmpDir, 'posted.json');

    const a = await loadPostedUrls(file);
    a.markAsPosted('https://example.com/1');
    a.markAsPosted('https://example.com/2');
    await a.save();

    const b = await loadPostedUrls(file);
    expect(b.size()).toBe(2);
    expect(b.has('https://example.com/1')).toBe(true);
    expect(b.has('https://example.com/2')).toBe(true);
  });

  it('同じ URL を 2 回登録しても 1 件として扱う', async () => {
    const file = path.join(tmpDir, 'posted.json');
    const store = await loadPostedUrls(file);
    store.markAsPosted('https://example.com/x');
    store.markAsPosted('https://example.com/x');
    expect(store.size()).toBe(1);
  });

  it('上限 1000 件を超えると古いものからバッチ削除される (900 件まで一気に削減)', async () => {
    const file = path.join(tmpDir, 'posted.json');
    const store = await loadPostedUrls(file);
    // 1000 件まで追加
    for (let i = 0; i < 1000; i++) {
      store.markAsPosted(`https://example.com/${i}`);
    }
    expect(store.size()).toBe(1000);
    // 1001 件目を追加 → バッチで 900 件まで削減
    store.markAsPosted('https://example.com/1000');
    expect(store.size()).toBe(900);
    // 最古の 101 件 (0〜100) は消えてる
    expect(store.has('https://example.com/0')).toBe(false);
    expect(store.has('https://example.com/100')).toBe(false);
    // 最新の 900 件 (101〜1000) は残っている
    expect(store.has('https://example.com/101')).toBe(true);
    expect(store.has('https://example.com/1000')).toBe(true);
  });

  it('maxStoredUrls を env で指定すると上限が変わる', async () => {
    const file = path.join(tmpDir, 'posted.json');
    const store = await loadPostedUrls(file, { maxStoredUrls: 100 });
    for (let i = 0; i < 100; i++) {
      store.markAsPosted(`https://example.com/${i}`);
    }
    expect(store.size()).toBe(100);
    // 上限超えで 90 件まで削減
    store.markAsPosted('https://example.com/100');
    expect(store.size()).toBe(90);
    expect(store.has('https://example.com/0')).toBe(false);
    expect(store.has('https://example.com/11')).toBe(true);
    expect(store.has('https://example.com/100')).toBe(true);
  });

  it('既存ファイルが上限超えで読み込まれた場合も即トリムされる', async () => {
    const file = path.join(tmpDir, 'posted.json');
    // 1500 件の URL を持つファイルを事前作成
    const urls = Array.from({ length: 1500 }, (_, i) => `https://example.com/${i}`);
    await fs.writeFile(file, JSON.stringify({ version: 1, urls }), 'utf-8');

    const store = await loadPostedUrls(file, { maxStoredUrls: 1000 });
    // 読み込み時点で max(1000) を超えていたら trimTarget(900) まで削減される
    expect(store.size()).toBe(900);
  });

  it('旧フォーマット (配列のみ) のファイルも読み込める', async () => {
    const file = path.join(tmpDir, 'posted.json');
    await fs.writeFile(
      file,
      JSON.stringify(['https://example.com/legacy']),
      'utf-8'
    );
    const store = await loadPostedUrls(file);
    expect(store.size()).toBe(1);
    expect(store.has('https://example.com/legacy')).toBe(true);
  });

  it('保存先の親ディレクトリが無い場合は自動作成する', async () => {
    const file = path.join(tmpDir, 'nested', 'deep', 'posted.json');
    const store = await loadPostedUrls(file);
    store.markAsPosted('https://example.com/x');
    await store.save();
    const raw = await fs.readFile(file, 'utf-8');
    expect(raw).toMatch(/example\.com/);
  });

  it('壊れた JSON は例外を投げる', async () => {
    const file = path.join(tmpDir, 'broken.json');
    await fs.writeFile(file, '{not json', 'utf-8');
    await expect(loadPostedUrls(file)).rejects.toThrow(/parse/);
  });
});
