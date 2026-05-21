/**
 * 記事の内容にマッチするハッシュタグを優先度順に選定する。
 * 投稿本文に最大 N 個まで含める想定。
 *
 * - 同じタグは重複しない
 * - 高優先度のルールから順にマッチを試す
 * - 指定件数に満たなければ #情報セキュリティ で 1 件だけ補完する
 *   (それでも 3 件に届かない場合は届く分だけ)
 */

interface HashtagRule {
  /** title + description + 英語原文 を対象に照合する正規表現 */
  pattern: RegExp;
  /** 採用するハッシュタグ (# は付けない) */
  tag: string;
}

/** デフォルト最大ハッシュタグ数 */
export const DEFAULT_MAX_HASHTAGS = 3;

/** 件数が満たないときに padding として追加する汎用タグ */
const DEFAULT_TAG = '情報セキュリティ';

/**
 * ハッシュタグ判定ルール (優先度順)。
 * 上にあるルールほど優先される。
 */
export const HASHTAG_RULES: readonly HashtagRule[] = [
  // ─── 影響度の高い攻撃タイプ
  { pattern: /ransomware|ランサムウェア/i, tag: 'ランサムウェア' },
  { pattern: /zero[\s-]?day|0[\s-]?day|ゼロデイ|0day/i, tag: 'ゼロデイ' },
  {
    pattern:
      /supply[\s-]?chain|サプライチェーン|malicious[\s-]?(?:package|npm|pypi)|悪意のあるパッケージ/i,
    tag: 'サプライチェーン攻撃',
  },

  // ─── 漏洩・侵害
  // セキュリティ文脈で「流出」が出るのはほぼ情報流出系なので単独でも拾う
  {
    pattern: /(?:data[\s-]?)?breach|漏洩|漏えい|流出|leaked|data[\s-]?(?:leak|exposure)/i,
    tag: '情報漏洩',
  },
  {
    pattern: /unauthorized[\s-]?access|不正アクセス|侵入(?!検知)|hacked/i,
    tag: '不正アクセス',
  },

  // ─── CVE / 脆弱性
  { pattern: /CVE-\d{4}-\d+/i, tag: 'CVE' },
  { pattern: /vulnerability|vulnerabilities|脆弱性/i, tag: '脆弱性' },

  // ─── マルウェア種別
  { pattern: /phishing|フィッシング/i, tag: 'フィッシング' },
  {
    pattern: /malware|マルウェア|trojan|spyware|backdoor|rootkit/i,
    tag: 'マルウェア',
  },

  // ─── 攻撃グループ
  {
    pattern:
      /apt[\s-]?\d+|threat[\s-]?actor|state[\s-]?sponsored|標的型|攻撃グループ/i,
    tag: '標的型攻撃',
  },
];

/**
 * 与えられたテキストに含まれるキーワードから、最大 maxCount 個の
 * 関連ハッシュタグを返す。各タグは `#xxx` 形式の文字列。
 *
 * @param text 照合対象テキスト (title + description + 英語原文 などを連結したもの)
 * @param maxCount 最大ハッシュタグ数 (デフォルト 3)
 */
export function pickHashtags(
  text: string,
  maxCount = DEFAULT_MAX_HASHTAGS
): string[] {
  if (maxCount <= 0) return [];

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const rule of HASHTAG_RULES) {
    if (rule.pattern.test(text) && !seen.has(rule.tag)) {
      tags.push(rule.tag);
      seen.add(rule.tag);
      if (tags.length >= maxCount) break;
    }
  }

  // maxCount に満たない場合は #情報セキュリティ で補完 (1 件のみ)。
  // 結果として 0→1 / 1→2 / 2→3 / 3→3 となり、最大件数を超えない。
  if (tags.length < maxCount && !seen.has(DEFAULT_TAG)) {
    tags.push(DEFAULT_TAG);
  }

  return tags.map((t) => `#${t}`);
}
