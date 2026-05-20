import { AtpAgent, RichText } from '@atproto/api';
import type { SecArticle, TranslatedContent } from '../types/index.js';

/** Bluesky のテキスト最大グラフェム数 */
const MAX_GRAPHEMES = 300;
/** OGP description の最大長 (リンクカード用) */
const MAX_DESCRIPTION = 300;

export interface BlueskyPosterOptions {
  service?: string;
  agent?: AtpAgent;
}

export interface BlueskyPosterDeps {
  handle: string;
  appPassword: string;
}

export interface PostArticleArgs {
  article: SecArticle;
  translated: TranslatedContent;
  image?: { buffer: Buffer; mimeType: string };
  /** 投稿本文末尾に付与するハッシュタグ (例: ["#セキュリティ", "#ランサムウェア"]) */
  hashtags?: string[];
}

export interface BlueskyPoster {
  login(): Promise<void>;
  postArticle(args: PostArticleArgs): Promise<{ withImage: boolean }>;
}

export function createBlueskyPoster(
  deps: BlueskyPosterDeps,
  options: BlueskyPosterOptions = {}
): BlueskyPoster {
  const service = options.service ?? 'https://bsky.social';
  const agent = options.agent ?? new AtpAgent({ service });

  return {
    async login(): Promise<void> {
      await agent.login({
        identifier: deps.handle,
        password: deps.appPassword,
      });
    },

    async postArticle({ article, translated, image, hashtags = [] }) {
      // 投稿本文: タイトル + 要約 + ハッシュタグ (3 段構成、tags が空なら 2 段)
      const text = buildPostText({
        title: translated.title,
        description: translated.description,
        hashtags,
        fallbackTitle: article.title,
      });

      const rt = new RichText({ text });
      await rt.detectFacets(agent);

      let thumb: unknown = undefined;
      let withImage = false;
      if (image) {
        try {
          const uploaded = await agent.uploadBlob(image.buffer, {
            encoding: image.mimeType,
          });
          thumb = uploaded.data.blob;
          withImage = true;
        } catch {
          thumb = undefined;
          withImage = false;
        }
      }

      const external: Record<string, unknown> = {
        uri: article.url,
        title: truncateGraphemes(
          translated.title || article.title,
          MAX_GRAPHEMES
        ),
        description: truncateGraphemes(translated.description, MAX_DESCRIPTION),
      };
      if (thumb) {
        external.thumb = thumb;
      }

      await agent.post({
        text: rt.text,
        facets: rt.facets,
        embed: {
          $type: 'app.bsky.embed.external',
          external,
        },
        createdAt: new Date().toISOString(),
      });

      return { withImage };
    },
  };
}

export interface PostTextArgs {
  title: string;
  description: string;
  /** 投稿末尾に付ける `#xxx` 形式のハッシュタグ配列。空なら省略される */
  hashtags?: string[];
  fallbackTitle: string;
}

const MIN_DESCRIPTION_BUDGET = 30;
const MAX_TITLE_GRAPHEMES = 90;

/**
 * Bluesky 投稿本文を組み立てる。
 *
 * フォーマット (description / hashtags の有無で 1〜3 段):
 *   <タイトル>
 *
 *   <要約>           ← description があるとき
 *
 *   <#tag1 #tag2 …>  ← hashtags があるとき
 *
 * 全体で 300 グラフェムを超えないよう、ハッシュタグの予算を先に確保し、
 * 残りでタイトルと要約を配分する。
 */
export function buildPostText(args: PostTextArgs): string {
  const titleSource = (args.title || args.fallbackTitle || '').trim();
  const descriptionSource = args.description.trim();
  const hashtagsLine = (args.hashtags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ');

  // 0. hashtag 行のグラフェム数 (\n\n 込み)
  const hashtagsBudget = hashtagsLine
    ? countGraphemes(hashtagsLine) + 2
    : 0;

  // 1. タイトル
  const titleMax = Math.max(
    0,
    Math.min(MAX_TITLE_GRAPHEMES, MAX_GRAPHEMES - hashtagsBudget)
  );
  const title = truncateGraphemes(titleSource, titleMax);
  const titleGraphemes = countGraphemes(title);

  // 2. 要約 (タイトルと hashtags を引いた残り予算)
  const descriptionBudget =
    MAX_GRAPHEMES - hashtagsBudget - titleGraphemes - 2; // -2 は description 前の \n\n

  let body = title;
  if (descriptionSource && descriptionBudget >= MIN_DESCRIPTION_BUDGET) {
    const description = truncateGraphemes(descriptionSource, descriptionBudget);
    body = `${title}\n\n${description}`;
  }

  // 3. ハッシュタグ行を末尾に付加
  return hashtagsLine ? `${body}\n\n${hashtagsLine}` : body;
}

export function truncateGraphemes(input: string, max: number): string {
  if (!input) return '';
  if (max <= 0) return '';

  const SegmenterCtor = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter })
    .Segmenter;
  if (typeof SegmenterCtor === 'function') {
    const segmenter = new SegmenterCtor('en', { granularity: 'grapheme' });
    const segments: string[] = [];
    for (const s of segmenter.segment(input)) {
      segments.push(s.segment);
    }
    if (segments.length <= max) return input;
    return segments.slice(0, Math.max(0, max - 1)).join('') + '…';
  }

  const arr = Array.from(input);
  if (arr.length <= max) return input;
  return arr.slice(0, Math.max(0, max - 1)).join('') + '…';
}

function countGraphemes(input: string): number {
  if (!input) return 0;
  const SegmenterCtor = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter })
    .Segmenter;
  if (typeof SegmenterCtor === 'function') {
    const segmenter = new SegmenterCtor('en', { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(input)) count++;
    return count;
  }
  return Array.from(input).length;
}
