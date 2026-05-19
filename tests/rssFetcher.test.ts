import { describe, it, expect, vi } from 'vitest';
import { createRssFetcher, normalizeUrl } from '../src/modules/rssFetcher.js';
import type { FeedSource } from '../src/types/index.js';

const SRC_A: FeedSource = { url: 'https://a.example/feed', name: 'A' };
const SRC_B: FeedSource = { url: 'https://b.example/feed', name: 'B' };

describe('normalizeUrl', () => {
  it('不正な URL は null', () => {
    expect(normalizeUrl('not-a-url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
  it('フラグメントを除去', () => {
    expect(normalizeUrl('https://example.com/x#a')).toBe(
      'https://example.com/x'
    );
  });
  it('utm_* を除去', () => {
    expect(
      normalizeUrl('https://example.com/?id=1&utm_source=x')
    ).toBe('https://example.com/?id=1');
  });
});

describe('createRssFetcher.fetchAll', () => {
  it('複数フィードをマージして新着順にソート', async () => {
    const parser = {
      parseURL: vi
        .fn()
        .mockImplementationOnce(async () => ({
          items: [
            {
              title: 'A1',
              link: 'https://a.example/1',
              isoDate: '2026-05-19T10:00:00Z',
            },
            {
              title: 'A2',
              link: 'https://a.example/2',
              isoDate: '2026-05-17T10:00:00Z',
            },
          ],
        }))
        .mockImplementationOnce(async () => ({
          items: [
            {
              title: 'B1',
              link: 'https://b.example/1',
              isoDate: '2026-05-18T10:00:00Z',
            },
          ],
        })),
    };
    const fetcher = createRssFetcher({ parser });
    const articles = await fetcher.fetchAll([SRC_A, SRC_B]);
    expect(articles).toHaveLength(3);
    // 新しい順
    expect(articles.map((a) => a.title)).toEqual(['A1', 'B1', 'A2']);
    // source 情報が付く
    expect(articles[0]?.source.name).toBe('A');
    expect(articles[1]?.source.name).toBe('B');
  });

  it('1 ソースが失敗しても他のソースは取れる', async () => {
    const parser = {
      parseURL: vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error('A boom');
        })
        .mockImplementationOnce(async () => ({
          items: [
            { title: 'B only', link: 'https://b.example/x' },
          ],
        })),
    };
    const fetcher = createRssFetcher({ parser });
    const articles = await fetcher.fetchAll([SRC_A, SRC_B]);
    expect(articles).toHaveLength(1);
    expect(articles[0]?.title).toBe('B only');
  });

  it('同じ URL は重複排除', async () => {
    const parser = {
      parseURL: vi
        .fn()
        .mockImplementationOnce(async () => ({
          items: [{ title: 'dup', link: 'https://example.com/x' }],
        }))
        .mockImplementationOnce(async () => ({
          items: [{ title: 'dup', link: 'https://example.com/x' }],
        })),
    };
    const fetcher = createRssFetcher({ parser });
    const articles = await fetcher.fetchAll([SRC_A, SRC_B]);
    expect(articles).toHaveLength(1);
  });

  it('言語判定が記事に付与される', async () => {
    const parser = {
      parseURL: vi.fn().mockResolvedValue({
        items: [
          { title: 'English title', link: 'https://x.example/1' },
          { title: '日本語タイトル', link: 'https://x.example/2' },
        ],
      }),
    };
    const fetcher = createRssFetcher({ parser });
    const articles = await fetcher.fetchAll([SRC_A]);
    expect(articles.find((a) => a.url.endsWith('/1'))?.language).toBe('en');
    expect(articles.find((a) => a.url.endsWith('/2'))?.language).toBe('ja');
  });
});
