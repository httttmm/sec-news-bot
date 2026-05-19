import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';

/**
 * SSRF (Server-Side Request Forgery) を防ぐためのユーティリティ。
 *
 * - http/https 以外のスキームを拒否
 * - localhost / プライベート IP / loopback / link-local への接続を
 *   `dns.lookup` レベルで拒否 (=ホスト名でも IP リテラルでも防げる)
 * - axios のレスポンスサイズに上限を設定し、巨大レスポンスによる
 *   DoS / メモリ枯渇を防ぐ
 */

const BLOCKED_HOSTNAMES = new Set<string>([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
]);

/**
 * 与えられた IP 文字列が "プライベート扱い" の範囲に該当するかを判定。
 * - IPv4: 10/8, 127/8, 169.254/16, 172.16-31/12, 192.168/16, 100.64/10, 0/8
 * - IPv6: ::1, fc00::/7 (ULA), fe80::/10 (link-local), IPv4-mapped (::ffff:..)
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  // IPv4 リテラル
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (![a, b, Number(v4[3]), Number(v4[4])].every((n) => n >= 0 && n <= 255)) {
      return true; // 不正な値は安全側に倒す
    }
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  // IPv6 (zone id を除去)
  const lower = ip.toLowerCase().split('%')[0] ?? '';
  if (lower === '::1' || lower === '::') return true;
  // fe80::/10 (link-local)
  if (/^fe[89ab][0-9a-f]?(:|$)/.test(lower)) return true;
  // fc00::/7 (ULA = fc.. or fd..)
  if (/^f[cd][0-9a-f]{0,2}(:|$)/.test(lower)) return true;
  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) return isPrivateIp(mapped[1]);
  return false;
}

/**
 * URL が外部リクエストに使って安全かを判定。
 * - http: または https: のみ許可
 * - localhost 系のホスト名を拒否
 * - ホスト名が IP リテラルの場合はその場で isPrivateIp で判定
 *
 * DNS で解決される場合の最終判定は `safeLookup` (下記) で行う。
 */
export function isSafeUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const hostname = u.hostname.toLowerCase();
  if (!hostname) return false;
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  // IP リテラル
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return !isPrivateIp(hostname);
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return !isPrivateIp(hostname.slice(1, -1));
  }
  // (Node の URL は bare IPv6 を `[...]` に正規化するが、稀に裸のことも)
  if (hostname.includes(':')) {
    return !isPrivateIp(hostname);
  }
  return true;
}

/**
 * dns.lookup のラッパー。解決結果の IP がプライベート範囲だったら接続を拒否する。
 * リダイレクト先の DNS 解決もこのフックを通るので、リダイレクトチェーン経由の
 * SSRF も塞げる。
 *
 * Node 20+ のソケットは `autoSelectFamily` (Happy Eyeballs) がデフォルト ON で、
 * このとき lookup には `all: true` が渡され、コールバックは **配列形式** の結果を
 * 期待する。一方、autoSelectFamily が無効な場合は単一アドレス形式 `(err, ip, family)`
 * を期待する。両方のモードに対応する。
 */
type LookupResultCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

const safeLookup: NonNullable<http.AgentOptions['lookup']> = (
  hostname,
  options,
  callback
) => {
  const cb = callback as LookupResultCallback | undefined;
  if (typeof cb !== 'function') return;

  // Node が all:true を要求しているか (Happy Eyeballs モード)
  const wantsAll =
    options !== null &&
    typeof options === 'object' &&
    (options as dns.LookupOptions).all === true;

  // 内部的には常に全候補を取得し、こちら側でフィルタリングする
  const dnsOpts: dns.LookupAllOptions = {
    family:
      options && typeof options === 'object' && typeof (options as dns.LookupOneOptions).family === 'number'
        ? (options as dns.LookupOneOptions).family
        : 0,
    hints:
      options && typeof options === 'object' && typeof (options as dns.LookupOneOptions).hints === 'number'
        ? (options as dns.LookupOneOptions).hints
        : 0,
    all: true,
  };

  dns.lookup(hostname, dnsOpts, (err, addresses) => {
    if (err) {
      cb(err, wantsAll ? [] : '', 0);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [];
    const safeList = list.filter(
      (entry) =>
        entry &&
        typeof entry.address === 'string' &&
        entry.address.length > 0 &&
        !isPrivateIp(entry.address)
    );
    if (safeList.length === 0) {
      const e: NodeJS.ErrnoException = new Error(
        `Refused to connect to private address for hostname: ${hostname}`
      );
      e.code = 'EFORBIDDEN';
      cb(e, wantsAll ? [] : '', 0);
      return;
    }
    if (wantsAll) {
      cb(null, safeList);
    } else {
      const first = safeList[0]!;
      cb(null, first.address, first.family);
    }
  });
};

export interface SafeAxiosOptions {
  /** リクエストタイムアウト (ms)。既定 15_000 */
  timeoutMs?: number;
  /** レスポンス本文の最大サイズ (バイト)。既定 2_000_000 */
  maxBytes?: number;
  /** リダイレクト最大回数。既定 5 */
  maxRedirects?: number;
  /** User-Agent ヘッダ */
  userAgent?: string;
  /** デフォルトの Accept ヘッダ */
  accept?: string;
}

/**
 * SSRF 対策とサイズ上限を組み込んだ axios インスタンスを生成する。
 */
export function createSafeAxios(options: SafeAxiosOptions = {}): AxiosInstance {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const userAgent = options.userAgent ?? 'sec-news-bot/0.1';

  // keepAlive を切ってリクエストごとに DNS 解決を強制 (DNS リバインディング対策)
  const httpAgent = new http.Agent({ lookup: safeLookup, keepAlive: false });
  const httpsAgent = new https.Agent({ lookup: safeLookup, keepAlive: false });

  const headers: Record<string, string> = { 'User-Agent': userAgent };
  if (options.accept) headers.Accept = options.accept;

  const cfg: CreateAxiosDefaults = {
    timeout: timeoutMs,
    maxRedirects,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    httpAgent,
    httpsAgent,
    headers,
    validateStatus: (status) => status >= 200 && status < 400,
  };

  return axios.create(cfg);
}
