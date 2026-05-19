import { type AxiosInstance } from 'axios';
import type { OgpData } from '../types/index.js';
import { createSafeAxios, isSafeUrl } from './safeHttp.js';

export interface OgpFetcherOptions {
  /** タイムアウト (ms)。デフォルト 15000 */
  timeoutMs?: number;
  /** 画像ダウンロードサイズの上限 (バイト)。デフォルト 1MB */
  maxImageBytes?: number;
  /** HTTP クライアントを差し替え可能にする (テスト用) */
  http?: Pick<AxiosInstance, 'get'>;
}

export interface OgpFetcher {
  /**
   * ページの HTML を取得して OGP / meta データをパースする。
   * 失敗時は例外を throw する。
   */
  fetchOgp(url: string): Promise<OgpData>;
  /**
   * OGP の image URL から画像バイト列を取得する。
   * - 取得失敗 or サイズ超過の場合は null を返す。
   */
  fetchImage(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null>;
}

// ハイブリッド UA: ブラウザ互換情報 + bot 名 + リポジトリ URL。
// 完全に bot だけを名乗ると一部サイト (例: Visual Capitalist) で 403 になるが、
// 純粋にブラウザを偽装するのも欺瞞なので、末尾に bot 名と連絡先を明示する。
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 sec-news-bot/0.1 (+https://github.com/httttmm/sec-news-bot)';
const DEFAULT_MAX_HTML_BYTES = 2_000_000;

export function createOgpFetcher(options: OgpFetcherOptions = {}): OgpFetcher {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxImageBytes = options.maxImageBytes ?? 1_000_000;
  // HTML 用のサイズ上限は画像用の上限と 2MB のうち大きい方
  const maxHtmlBytes = Math.max(DEFAULT_MAX_HTML_BYTES, maxImageBytes);
  const http: Pick<AxiosInstance, 'get'> =
    options.http ??
    createSafeAxios({
      timeoutMs,
      maxBytes: maxHtmlBytes,
      userAgent: DEFAULT_USER_AGENT,
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/*;q=0.8,*/*;q=0.5',
    });

  return {
    async fetchOgp(url: string): Promise<OgpData> {
      if (!isSafeUrl(url)) {
        throw new Error(`Refused to fetch unsafe URL: ${url}`);
      }
      // axios の utf-8 強制デコードを避けるため、バイト列で取得して
      // 自前で文字コードを検出する (Shift_JIS / EUC-JP のページに対応)
      const res = await http.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
      });
      const buffer = toBuffer(res.data);
      const contentType = getHeaderValue(res.headers, 'content-type');
      const html = decodeHtmlBytes(buffer, contentType);
      return parseOgp(html, url);
    },

    async fetchImage(imageUrl: string) {
      if (!isSafeUrl(imageUrl)) return null;
      try {
        const res = await http.get<ArrayBuffer>(imageUrl, {
          responseType: 'arraybuffer',
          // 念の為画像用にヘッダを上書き
          headers: { Accept: 'image/*' },
          // 画像はより厳しいサイズ上限を per-request で設定
          maxContentLength: maxImageBytes,
          maxBodyLength: maxImageBytes,
        });

        const data = res.data;
        const buffer = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);

        if (buffer.byteLength > maxImageBytes) {
          return null;
        }

        const headers = (res.headers ?? {}) as Record<string, unknown>;
        const ct =
          typeof headers['content-type'] === 'string'
            ? (headers['content-type'] as string)
            : '';
        const mimeType = sanitizeMimeType(ct) ?? guessMimeFromUrl(imageUrl);
        if (!mimeType) return null;

        return { buffer, mimeType };
      } catch {
        return null;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 文字コード検出 & デコード
// ─────────────────────────────────────────────────────────────

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength
    );
  }
  if (typeof data === 'string') return Buffer.from(data, 'utf-8');
  return Buffer.from(String(data ?? ''));
}

function getHeaderValue(headers: unknown, name: string): string {
  if (!headers || typeof headers !== 'object') return '';
  const h = headers as Record<string, unknown>;
  const v = h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(',');
  return '';
}

/**
 * HTML バイト列を、文字コードを検出してデコードした文字列にする。
 */
export function decodeHtmlBytes(bytes: Buffer, contentType = ''): string {
  const charset = detectCharset(bytes, contentType);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

/**
 * 優先順位:
 *  1. Content-Type ヘッダの charset
 *  2. HTML 内の <meta charset="..."> または <meta http-equiv="content-type" content="...; charset=...">
 *  3. デフォルト utf-8
 *
 * メタタグは ASCII 範囲で記述されている前提で、先頭 8KB だけ走査する。
 */
export function detectCharset(bytes: Buffer, contentType = ''): string {
  // 1. Content-Type ヘッダ
  const headerMatch = contentType.match(/charset\s*=\s*["']?([^"';\s]+)/i);
  if (headerMatch?.[1]) return normalizeCharset(headerMatch[1]);

  // 2. HTML の <meta> タグ
  const sampleLen = Math.min(bytes.length, 8192);
  // 'binary' エンコーディングは 1 バイト = 1 文字なので ASCII 範囲のマッチに使える
  const sample = bytes.subarray(0, sampleLen).toString('binary');

  const metaMatch = sample.match(
    /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_\-]+)/i
  );
  if (metaMatch?.[1]) return normalizeCharset(metaMatch[1]);

  const httpEquivMatch = sample.match(
    /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([A-Za-z0-9_\-]+)/i
  );
  if (httpEquivMatch?.[1]) return normalizeCharset(httpEquivMatch[1]);

  return 'utf-8';
}

/**
 * よくある charset 文字列を TextDecoder が受け付ける形に正規化する。
 */
export function normalizeCharset(raw: string): string {
  const c = raw.toLowerCase().replace(/[-_]/g, '');
  if (c === 'utf8') return 'utf-8';
  if (
    c === 'shiftjis' ||
    c === 'sjis' ||
    c === 'xsjis' ||
    c === 'windows31j' ||
    c === 'cp932' ||
    c === 'ms932'
  ) {
    return 'shift_jis';
  }
  if (c === 'eucjp' || c === 'xeucjp' || c === 'eucjpms') return 'euc-jp';
  if (c === 'iso2022jp' || c === 'csiso2022jp') return 'iso-2022-jp';
  return raw.toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// パース系: 正規表現ベース。jsdom は使わない。
// ─────────────────────────────────────────────────────────────

export function parseOgp(html: string, baseUrl: string): OgpData {
  const title =
    extractMeta(html, 'og:title', 'property') ||
    extractMeta(html, 'twitter:title', 'name') ||
    extractTitleTag(html) ||
    baseUrl;

  const description =
    extractMeta(html, 'og:description', 'property') ||
    extractMeta(html, 'twitter:description', 'name') ||
    extractMeta(html, 'description', 'name') ||
    '';

  const rawImage =
    extractMeta(html, 'og:image', 'property') ||
    extractMeta(html, 'twitter:image', 'name') ||
    extractMeta(html, 'twitter:image:src', 'name') ||
    '';

  const imageUrl = rawImage ? resolveUrl(rawImage, baseUrl) : undefined;

  // 翻訳ソース用のフォールバック: OGP description が空でも記事本文から要約できるよう、
  // <article> / <main> / <p> から最初のまとまった文章を取り出す
  const textExcerpt = extractTextExcerpt(html);

  return {
    title: decodeEntities(title).trim(),
    description: decodeEntities(description).trim(),
    imageUrl,
    textExcerpt: textExcerpt || undefined,
  };
}

/**
 * HTML 本文から最初のまとまった段落を取り出す。
 * OGP description が空のサイト用のフォールバックとして使う。
 *
 * - script / style / noscript / nav / header / footer / aside は除去
 * - <article> または <main> があれば優先
 * - <p> タグから本文を抽出 (短すぎる p は noise 扱いでスキップ)
 * - 最大 maxChars 文字まで
 */
export function extractTextExcerpt(html: string, maxChars = 1200): string {
  if (!html) return '';

  // ノイズになりやすい要素を除去
  let cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');

  // article / main があればそこに限定
  const articleMatch = cleaned.match(
    /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i
  );
  if (articleMatch?.[2]) {
    cleaned = articleMatch[2];
  } else {
    const bodyMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch?.[1]) cleaned = bodyMatch[1];
  }

  // <p> 要素から本文を集める
  const paragraphs: string[] = [];
  const pMatcher = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pMatcher.exec(cleaned)) !== null) {
    const text = stripHtmlTags(match[1] ?? '').trim();
    if (text.length >= 30) {
      // 30 文字未満は noise (キャプションやメニュー等) として除外
      paragraphs.push(text);
    }
    if (paragraphs.join(' ').length >= maxChars) break;
  }

  let result = paragraphs.join(' ').trim();

  // <p> が見つからなければ全テキストの最初の方を取る
  if (!result) {
    result = stripHtmlTags(cleaned).replace(/\s+/g, ' ').trim();
  }

  if (result.length > maxChars) {
    result = result.slice(0, maxChars);
  }
  return result;
}

function stripHtmlTags(html: string): string {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

/**
 * <meta property="og:xxx" content="..."> もしくは
 * <meta name="xxx" content="..."> から content 値を抽出する。
 * 属性の順番が逆転していても拾えるよう、2 通りの正規表現でマッチさせる。
 */
function extractMeta(
  html: string,
  key: string,
  attr: 'property' | 'name'
): string {
  const k = escapeForRegex(key);
  // 1) <meta property="x" content="y">
  const pat1 = new RegExp(
    `<meta[^>]+${attr}=["']${k}["'][^>]*?content=["']([^"']*)["'][^>]*>`,
    'i'
  );
  const m1 = html.match(pat1);
  if (m1?.[1]) return m1[1];

  // 2) <meta content="y" property="x">
  const pat2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*?${attr}=["']${k}["'][^>]*>`,
    'i'
  );
  const m2 = html.match(pat2);
  if (m2?.[1]) return m2[1];
  return '';
}

function extractTitleTag(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1]?.trim() ?? '';
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveUrl(href: string, baseUrl: string): string | undefined {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * HTML entities の最低限のデコード。
 * （&amp; &lt; &gt; &quot; &#39; &nbsp; と数値文字参照）
 */
export function decodeEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function sanitizeMimeType(raw: string): string | null {
  const m = raw.match(/^([^;]+)/);
  const mime = m?.[1]?.trim().toLowerCase();
  if (!mime) return null;
  if (!mime.startsWith('image/')) return null;
  return mime;
}

function guessMimeFromUrl(url: string): string | null {
  const m = url.toLowerCase().match(/\.(jpe?g|png|gif|webp)(\?|#|$)/);
  const ext = m?.[1];
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}
