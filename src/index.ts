import { loadDotenvIfPresent } from './modules/dotenv.js';
import { loadConfig } from './modules/config.js';
import { createLogger } from './modules/logger.js';
import { createRssFetcher } from './modules/rssFetcher.js';
import { loadPostedUrls } from './modules/postedUrlsStore.js';
import { createOgpFetcher } from './modules/ogpFetcher.js';
import { createBlueskyPoster } from './modules/blueskyPoster.js';
import { createTranslator } from './modules/translator.js';
import { filterBySecurityTopic } from './modules/keywordFilter.js';
import { pickHashtags } from './modules/hashtagger.js';
import type { RunSummary, SecArticle, TranslatedContent } from './types/index.js';

loadDotenvIfPresent();

async function main(): Promise<void> {
  const started = Date.now();

  const config = loadConfig();
  const logger = createLogger({ debug: config.debug });

  logger.info('starting', {
    feeds: config.feedSources.map((s) => s.name),
    translationModel: config.translationModel,
    maxPostsPerRun: config.maxPostsPerRun,
    keywordFilter: !config.disableKeywordFilter,
  });

  // 1. 投稿済み URL の読み込み
  const store = await loadPostedUrls(config.postedUrlsFile, {
    maxStoredUrls: config.maxStoredUrls,
  });
  logger.debug('posted_urls_loaded', {
    size: store.size(),
    maxStoredUrls: config.maxStoredUrls,
  });

  // 2. 全ソースから RSS 取得
  const rss = createRssFetcher();
  let allArticles: SecArticle[];
  try {
    allArticles = await rss.fetchAll(config.feedSources);
  } catch (err) {
    logger.error('rss_fetch_failed', { error: errorMessage(err) });
    throw err;
  }
  logger.info('rss_fetched', {
    count: allArticles.length,
    bySource: countBySource(allArticles),
  });

  // 3. キーワードフィルタ
  const filtered = filterBySecurityTopic(
    allArticles,
    config.disableKeywordFilter
  );
  logger.info('keyword_filtered', {
    matched: filtered.length,
    dropped: allArticles.length - filtered.length,
  });

  // 4. 未投稿のものに絞る
  const candidates = filtered
    .filter((a) => !store.has(a.url))
    .slice(0, config.maxPostsPerRun);
  logger.info('candidates_selected', {
    candidates: candidates.length,
    skipped: filtered.length - candidates.length,
  });

  const summary: RunSummary = {
    fetched: allArticles.length,
    filtered: filtered.length,
    candidates: candidates.length,
    posted: 0,
    failed: 0,
    elapsedMs: 0,
  };

  if (candidates.length === 0) {
    summary.elapsedMs = Date.now() - started;
    logger.summary(summary);
    return;
  }

  // 5. Bluesky / OGP / 翻訳の各クライアントを準備
  const poster = createBlueskyPoster({
    handle: config.blueskyHandle,
    appPassword: config.blueskyAppPassword,
  });
  try {
    await poster.login();
  } catch (err) {
    logger.error('bluesky_login_failed', { error: errorMessage(err) });
    throw err;
  }
  logger.info('bluesky_logged_in', { handle: config.blueskyHandle });

  const ogpFetcher = createOgpFetcher();
  const translator = createTranslator({
    apiKey: config.anthropicApiKey,
    model: config.translationModel,
  });

  // 6. 各記事を投稿
  for (let i = 0; i < candidates.length; i++) {
    const article = candidates[i];
    if (!article) continue;
    logger.info('post_start', {
      index: i + 1,
      total: candidates.length,
      url: article.url,
      source: article.source.name,
      language: article.language,
    });

    try {
      // a. OGP 取得 (失敗してもタイトル/URL だけで投稿可能)
      let ogp;
      try {
        ogp = await ogpFetcher.fetchOgp(article.url);
        // フォールバックチェーン: OGP description → 抽出本文 → RSS snippet
        if (!ogp.description) {
          ogp.description =
            ogp.textExcerpt || article.contentSnippet || '';
        }
      } catch (err) {
        logger.warn('ogp_fetch_failed', {
          url: article.url,
          error: errorMessage(err),
        });
        ogp = {
          title: article.title,
          description: article.contentSnippet ?? '',
          imageUrl: undefined as string | undefined,
        };
      }

      // b. 翻訳 / 要約 (言語に応じて切替)
      let translated: TranslatedContent;
      try {
        translated = await translator.translate({
          title: article.title,
          description: ogp.description,
          language: article.language,
        });
        logger.debug('translated', {
          src_lang: article.language,
          src_title: article.title,
          ja_title: translated.title,
        });
      } catch (err) {
        logger.warn('translation_failed', {
          url: article.url,
          error: errorMessage(err),
        });
        // 失敗時は元のタイトル + 元の description で投稿
        translated = {
          title: article.title,
          description: ogp.description,
        };
      }

      // c. 画像取得 (失敗してもテキストのみで投稿)
      let image: { buffer: Buffer; mimeType: string } | undefined = undefined;
      if (ogp.imageUrl) {
        const img = await ogpFetcher.fetchImage(ogp.imageUrl);
        if (img) image = img;
        else
          logger.debug('image_skipped', {
            url: article.url,
            imageUrl: ogp.imageUrl,
          });
      }

      // d. ハッシュタグ判定 (記事の英語原文 + 翻訳テキストの両方から拾う)
      const hashtagSource = [
        article.title,
        article.contentSnippet ?? '',
        translated.title,
        translated.description,
      ].join(' ');
      const hashtags = pickHashtags(hashtagSource);

      // e. 投稿
      const result = await poster.postArticle({
        article,
        translated,
        image,
        hashtags,
      });

      // f. 投稿済みとして記録
      store.markAsPosted(article.url);
      summary.posted++;
      logger.info('post_success', {
        url: article.url,
        withImage: result.withImage,
        ja_title: translated.title,
        hashtags,
      });
    } catch (err) {
      summary.failed++;
      logger.error('post_failed', {
        url: article.url,
        error: errorMessage(err),
      });
    }

    if (i < candidates.length - 1 && config.postIntervalMs > 0) {
      await sleep(config.postIntervalMs);
    }
  }

  // 7. 投稿済み URL を保存
  try {
    await store.save();
    logger.debug('posted_urls_saved', { size: store.size() });
  } catch (err) {
    logger.error('posted_urls_save_failed', { error: errorMessage(err) });
  }

  summary.elapsedMs = Date.now() - started;
  logger.summary(summary);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function countBySource(articles: SecArticle[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of articles) {
    counts[a.source.name] = (counts[a.source.name] ?? 0) + 1;
  }
  return counts;
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'fatal',
      error: errorMessage(err),
    })
  );
  process.exit(1);
});
