/**
 * 言語コード (簡易判定)
 */
export type Language = 'ja' | 'en';

/**
 * 監視対象の RSS フィード設定
 */
export interface FeedSource {
  /** フィード URL */
  url: string;
  /** フィードの名前 (host から自動推測される) */
  name: string;
}

/**
 * アプリケーション全体の設定
 */
export interface Config {
  blueskyHandle: string;
  blueskyAppPassword: string;
  anthropicApiKey: string;
  translationModel: string;
  /** 監視する RSS フィード一覧 */
  feedSources: FeedSource[];
  maxPostsPerRun: number;
  postedUrlsFile: string;
  /** 投稿済み URL の保持上限件数。これを超えると古いものから削除される */
  maxStoredUrls: number;
  postIntervalMs: number;
  /** キーワードフィルタを無効化するか */
  disableKeywordFilter: boolean;
  debug: boolean;
}

/**
 * セキュリティニュース記事 (正規化済み)
 */
export interface SecArticle {
  /** 元記事のタイトル */
  title: string;
  /** 元記事の URL */
  url: string;
  /** RSS の description / contentSnippet (取得できれば) */
  contentSnippet?: string;
  /** 公開日時 (ISO 文字列) */
  isoDate?: string;
  /** ソース情報 (どのフィードから来たか) */
  source: FeedSource;
  /** 簡易言語判定結果 (タイトルと snippet から判定) */
  language: Language;
}

/**
 * 翻訳結果
 */
export interface TranslatedContent {
  title: string;
  description: string;
}

/**
 * OGP / メタデータ取得結果
 */
export interface OgpData {
  title: string;
  description: string;
  imageUrl?: string;
  textExcerpt?: string;
}

/**
 * 1 記事の投稿結果
 */
export interface PostResult {
  article: SecArticle;
  success: boolean;
  error?: string;
  withImage: boolean;
}

/**
 * 実行サマリー
 */
export interface RunSummary {
  fetched: number;
  filtered: number;
  candidates: number;
  posted: number;
  failed: number;
  elapsedMs: number;
}
