import type { Language } from '../types/index.js';

/**
 * 入力テキストの言語を簡易判定する。
 * - ひらがな / カタカナ / CJK 統合漢字の文字数が
 *   全文字数の THRESHOLD 以上なら 'ja'
 * - それ以外は 'en' (実際は英語以外を全部 'en' 扱い)
 *
 * 100% 正確ではないが、英日の振り分けには十分。
 */
const JA_RATIO_THRESHOLD = 0.15;

export function detectLanguage(text: string): Language {
  if (!text) return 'en';
  const cjkMatch = text.match(/[぀-ヿ㐀-䶿一-鿿]/g);
  const cjkCount = cjkMatch ? cjkMatch.length : 0;
  // 半角空白や記号は分母から除外
  const meaningful = text.replace(/[\s\p{P}\p{S}]/gu, '');
  if (meaningful.length === 0) return 'en';
  const ratio = cjkCount / meaningful.length;
  return ratio >= JA_RATIO_THRESHOLD ? 'ja' : 'en';
}
