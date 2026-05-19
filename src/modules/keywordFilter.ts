import type { SecArticle } from '../types/index.js';

/**
 * セキュリティ関連のホワイトリストキーワード。
 * 大文字小文字を区別せず、title + contentSnippet に含まれていれば
 * 投稿候補とする。
 *
 * 「広く拾う」方針なので false negative より false positive 寄りに調整。
 * 雑音が多すぎたら個別に削除する。
 */
export const SECURITY_KEYWORDS: readonly (string | RegExp)[] = [
  // ─── CVE / 脆弱性
  /CVE-\d{4}-\d+/i,
  'vulnerability',
  'vulnerabilities',
  '脆弱性',
  'zero-day',
  '0-day',
  'zero day',
  '0day',
  'ゼロデイ',

  // ─── ランサムウェア・恐喝
  'ransomware',
  'ランサムウェア',
  '身代金',
  'extortion',
  'double extortion',

  // ─── 漏洩・侵入
  'data breach',
  'breach',
  'leak',
  'leaked',
  'hacked',
  'compromised',
  'stolen',
  '漏洩',
  '漏えい',
  '流出',
  '情報流出',
  '不正アクセス',
  '侵入',
  'unauthorized access',
  'data exposed',

  // ─── サプライチェーン攻撃
  'supply chain',
  'malicious package',
  'malicious npm',
  'malicious pypi',
  'typosquat',
  'typosquatting',
  'dependency confusion',
  'サプライチェーン',
  '悪意のあるパッケージ',
  '悪意ある',

  // ─── マルウェア
  'malware',
  'マルウェア',
  'trojan',
  'spyware',
  'backdoor',
  'rootkit',
  'rat',
  'infostealer',
  'cryptominer',

  // ─── 攻撃手法・脅威
  'exploit',
  'exploited',
  'phishing',
  'フィッシング',
  'cyberattack',
  'cyber attack',
  'サイバー攻撃',
  'targeted attack',
  '標的型',
  'standard型攻撃',
  'apt',
  'threat actor',
  '攻撃グループ',
  'state-sponsored',

  // ─── 認証・アクセス
  'credentials stolen',
  'credential theft',
  'session hijack',
  'mfa bypass',
  '2fa bypass',
  'token theft',

  // ─── プラットフォーム / インシデント
  'github',
  'gitlab',
  'npm',
  'pypi',
  'docker hub',
  'cisa',
  'patch tuesday',
  'security advisory',
  'セキュリティアドバイザリ',
  '緊急パッチ',
  '緊急セキュリティ',

  // ─── 暗号 / プロトコル
  'tls',
  'rce',
  'sql injection',
  'xss',
  'csrf',
  'ssrf',
  'remote code execution',
  'privilege escalation',
];

/**
 * 記事がキーワードホワイトリストに該当するか判定する。
 */
export function matchesSecurityTopic(article: SecArticle): boolean {
  const haystack = `${article.title} ${article.contentSnippet ?? ''}`.toLowerCase();
  for (const kw of SECURITY_KEYWORDS) {
    if (typeof kw === 'string') {
      if (haystack.includes(kw.toLowerCase())) return true;
    } else if (kw.test(haystack)) {
      return true;
    }
  }
  return false;
}

/**
 * 記事配列を「セキュリティ関連と判定されたもの」だけに絞る。
 * disabled = true なら全件そのまま返す (フィルタ無効化)。
 */
export function filterBySecurityTopic(
  articles: SecArticle[],
  disabled = false
): SecArticle[] {
  if (disabled) return articles;
  return articles.filter(matchesSecurityTopic);
}
