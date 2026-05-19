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

  it('上限 1000 件を超えると古いものから削除される', async () => {
    const file = path.join(tmpDir, 'posted.json');
    const store = await loadPostedUrls(file);
    for (let i = 0; i < 1005; i++) {
      store.markAsPosted(`https://example.com/${i}`);
    }
    expect(store.size()).toBe(1000);
    // 最も古い 5 件は削除されているはず
    expect(store.has('https://example.com/0')).toBe(false);
    expect(store.has('https://example.com/4')).toBe(false);
    // 最新の 1000 件は残っている
    expect(store.has('https://example.com/5')).toBe(true);
    expect(store.has('https://example.com/1004')).toBe(true);
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
