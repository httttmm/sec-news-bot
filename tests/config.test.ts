import { describe, it, expect } from 'vitest';
import { loadConfig, parseFeedUrls } from '../src/modules/config.js';

const VALID = {
  BLUESKY_HANDLE: 'bot.bsky.social',
  BLUESKY_APP_PASSWORD: 'xxxx-xxxx-xxxx-xxxx',
  ANTHROPIC_API_KEY: 'sk-ant-test-xxx',
} as const;

describe('loadConfig', () => {
  it('必須 env が無いと例外', () => {
    expect(() => loadConfig({})).toThrowError(/BLUESKY_HANDLE/);
  });

  it('ANTHROPIC_API_KEY が無いと例外', () => {
    expect(() =>
      loadConfig({ BLUESKY_HANDLE: 'a', BLUESKY_APP_PASSWORD: 'b' })
    ).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it('デフォルトのフィードリストが適用される', () => {
    const c = loadConfig({ ...VALID });
    expect(c.feedSources.length).toBeGreaterThanOrEqual(5);
    expect(c.feedSources.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'BleepingComputer',
        'The Hacker News',
        'ScanNetSecurity',
        'Krebs on Security',
        'JPCERT/CC',
      ])
    );
    expect(c.maxPostsPerRun).toBe(1);
    expect(c.disableKeywordFilter).toBe(false);
  });

  it('SEC_FEED_URLS を上書きできる', () => {
    const c = loadConfig({
      ...VALID,
      SEC_FEED_URLS:
        'https://krebsonsecurity.com/feed/,https://socket.dev/blog/rss',
    });
    expect(c.feedSources).toHaveLength(2);
    expect(c.feedSources[0]?.name).toBe('Krebs on Security');
    expect(c.feedSources[1]?.name).toBe('Socket');
  });

  it('DISABLE_KEYWORD_FILTER=true でフィルタ無効化', () => {
    const c = loadConfig({ ...VALID, DISABLE_KEYWORD_FILTER: 'true' });
    expect(c.disableKeywordFilter).toBe(true);
  });

  it('MAX_STORED_URLS のデフォルトは 1000', () => {
    const c = loadConfig({ ...VALID });
    expect(c.maxStoredUrls).toBe(1000);
  });

  it('MAX_STORED_URLS を上書きできる', () => {
    const c = loadConfig({ ...VALID, MAX_STORED_URLS: '500' });
    expect(c.maxStoredUrls).toBe(500);
  });

  it('MAX_STORED_URLS が不正なら例外', () => {
    expect(() =>
      loadConfig({ ...VALID, MAX_STORED_URLS: 'abc' })
    ).toThrowError(/MAX_STORED_URLS/);
    expect(() =>
      loadConfig({ ...VALID, MAX_STORED_URLS: '0' })
    ).toThrowError(/MAX_STORED_URLS/);
  });
});

describe('parseFeedUrls', () => {
  it('未指定ならデフォルトを使う', () => {
    const sources = parseFeedUrls(undefined);
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });

  it('カンマ区切りでパース', () => {
    const sources = parseFeedUrls(
      'https://example.com/a.rss,https://example.com/b.rss'
    );
    expect(sources).toHaveLength(2);
    expect(sources[0]?.url).toBe('https://example.com/a.rss');
  });

  it('不正な URL は例外', () => {
    expect(() => parseFeedUrls('not a url')).toThrowError(/Invalid/);
  });

  it('http(s) 以外は例外', () => {
    expect(() => parseFeedUrls('ftp://example.com/')).toThrowError(/http/);
  });

  it('既知ホストはきれいな名前にマップ', () => {
    expect(
      parseFeedUrls('https://www.bleepingcomputer.com/feed/')[0]?.name
    ).toBe('BleepingComputer');
    expect(
      parseFeedUrls('https://feeds.feedburner.com/TheHackersNews')[0]?.name
    ).toBe('The Hacker News');
    expect(
      parseFeedUrls('https://krebsonsecurity.com/feed/')[0]?.name
    ).toBe('Krebs on Security');
    expect(
      parseFeedUrls('https://www.jpcert.or.jp/rss/jpcert.rdf')[0]?.name
    ).toBe('JPCERT/CC');
  });

  it('未知ホストは hostname をそのまま使う', () => {
    expect(parseFeedUrls('https://random.example.com/feed')[0]?.name).toBe(
      'random.example.com'
    );
  });
});
