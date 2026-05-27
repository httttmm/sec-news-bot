import type { Config, FeedSource } from '../types/index.js';

const DEFAULT_FEED_URLS = [
  'https://www.bleepingcomputer.com/feed/',
  'https://feeds.feedburner.com/TheHackersNews',
  'https://scan.netsecurity.ne.jp/rss/index.rdf',
  'https://krebsonsecurity.com/feed/',
  'https://www.jpcert.or.jp/rss/jpcert.rdf',
];
const DEFAULT_TRANSLATION_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_POSTS_PER_RUN = 2;
const DEFAULT_POSTED_URLS_FILE = 'data/posted_urls.json';
const DEFAULT_MAX_STORED_URLS = 1000;
const DEFAULT_POST_INTERVAL_MS = 3000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const blueskyHandle = requireString(env, 'BLUESKY_HANDLE');
  const blueskyAppPassword = requireString(env, 'BLUESKY_APP_PASSWORD');
  const anthropicApiKey = requireString(env, 'ANTHROPIC_API_KEY');

  const translationModel =
    env.TRANSLATION_MODEL?.trim() || DEFAULT_TRANSLATION_MODEL;

  const feedSources = parseFeedUrls(env.SEC_FEED_URLS);

  const maxPostsPerRun = parsePositiveInt(
    env.MAX_POSTS_PER_RUN,
    DEFAULT_MAX_POSTS_PER_RUN,
    'MAX_POSTS_PER_RUN'
  );

  const postedUrlsFile =
    env.POSTED_URLS_FILE?.trim() || DEFAULT_POSTED_URLS_FILE;

  const maxStoredUrls = parsePositiveInt(
    env.MAX_STORED_URLS,
    DEFAULT_MAX_STORED_URLS,
    'MAX_STORED_URLS'
  );

  const postIntervalMs = parsePositiveInt(
    env.POST_INTERVAL_MS,
    DEFAULT_POST_INTERVAL_MS,
    'POST_INTERVAL_MS',
    /* allowZero */ true
  );

  const disableKeywordFilter = parseBool(env.DISABLE_KEYWORD_FILTER);
  const debug = parseBool(env.DEBUG);

  return {
    blueskyHandle,
    blueskyAppPassword,
    anthropicApiKey,
    translationModel,
    feedSources,
    maxPostsPerRun,
    postedUrlsFile,
    maxStoredUrls,
    postIntervalMs,
    disableKeywordFilter,
    debug,
  };
}

/**
 * SEC_FEED_URLS をカンマ区切りでパースし、URL のホスト名から
 * ソース名を推測する。空・未指定ならデフォルトリストを使う。
 */
export function parseFeedUrls(raw: string | undefined): FeedSource[] {
  const urls = (raw?.trim() ? raw.split(',') : DEFAULT_FEED_URLS)
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    throw new Error('No RSS feed URLs configured (SEC_FEED_URLS is empty)');
  }
  return urls.map((url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid feed URL in SEC_FEED_URLS: "${url}"`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Feed URL must be http(s): "${url}"`);
    }
    // ホスト名から "www." と TLD を除いた部分を name に
    const name = guessSourceName(parsed.hostname);
    return { url, name };
  });
}

function guessSourceName(hostname: string): string {
  const stripped = hostname.replace(/^www\./, '');
  // 一部のフィードは feedburner などにあるので、別マッピングを優先
  const KNOWN: Record<string, string> = {
    'feeds.feedburner.com': 'The Hacker News',
    'www.bleepingcomputer.com': 'BleepingComputer',
    'bleepingcomputer.com': 'BleepingComputer',
    'scan.netsecurity.ne.jp': 'ScanNetSecurity',
    'www.security-next.com': 'Security NEXT',
    'security-next.com': 'Security NEXT',
    'krebsonsecurity.com': 'Krebs on Security',
    'socket.dev': 'Socket',
    'github.com': 'GitHub Advisory',
    'www.jpcert.or.jp': 'JPCERT/CC',
    'jpcert.or.jp': 'JPCERT/CC',
  };
  if (KNOWN[hostname]) return KNOWN[hostname];
  if (KNOWN[stripped]) return KNOWN[stripped];
  return stripped;
}

function requireString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Required env var ${key} is not set`);
  }
  return value;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  key: string,
  allowZero = false
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${key} must be an integer, got: "${raw}"`);
  }
  if (allowZero ? n < 0 : n <= 0) {
    throw new Error(
      `${key} must be ${allowZero ? '>= 0' : '> 0'}, got: ${n}`
    );
  }
  return n;
}

function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
