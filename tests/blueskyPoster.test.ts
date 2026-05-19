import { describe, it, expect } from 'vitest';
import {
  buildPostText,
  truncateGraphemes,
} from '../src/modules/blueskyPoster.js';

function countGraphemes(s: string): number {
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let n = 0;
  for (const _ of seg.segment(s)) n++;
  return n;
}

describe('buildPostText', () => {
  it('タイトル + 要約の 2 段構成 (trailer 無し)', () => {
    const text = buildPostText({
      title: 'OpenSSL に深刻な RCE 脆弱性',
      description: '本日公開されたパッチで対処可能。影響範囲は ...',
      fallbackTitle: 'OpenSSL RCE',
    });
    expect(text).toContain('OpenSSL に深刻な RCE 脆弱性');
    expect(text).toContain('本日公開されたパッチで対処可能');
    expect(text.split('\n\n')).toHaveLength(2);
    // HN bot のような 💬 trailer は無いはず
    expect(text).not.toContain('💬');
  });

  it('description が空ならタイトルだけ', () => {
    const text = buildPostText({
      title: 'タイトルのみ',
      description: '',
      fallbackTitle: '',
    });
    expect(text).toBe('タイトルのみ');
    expect(text).not.toContain('\n\n');
  });

  it('翻訳タイトルが空なら fallbackTitle を使う', () => {
    const text = buildPostText({
      title: '',
      description: '',
      fallbackTitle: 'English Original',
    });
    expect(text).toContain('English Original');
  });

  it('300 グラフェム以内に収まる', () => {
    const text = buildPostText({
      title: 'あ'.repeat(100),
      description: 'い'.repeat(500),
      fallbackTitle: '',
    });
    expect(countGraphemes(text)).toBeLessThanOrEqual(300);
  });

  it('タイトル長 > 90 なら切り詰め', () => {
    const text = buildPostText({
      title: 'あ'.repeat(120),
      description: '',
      fallbackTitle: '',
    });
    const titleLine = text.split('\n\n')[0] ?? '';
    expect(countGraphemes(titleLine)).toBeLessThanOrEqual(90);
    expect(titleLine.endsWith('…')).toBe(true);
  });
});

describe('truncateGraphemes', () => {
  it('max 以下はそのまま', () => {
    expect(truncateGraphemes('hello', 10)).toBe('hello');
  });
  it('max 超は … 付き', () => {
    expect(truncateGraphemes('hello world', 5)).toBe('hell…');
  });
  it('空文字は空', () => {
    expect(truncateGraphemes('', 10)).toBe('');
  });
  it('max=0 は空', () => {
    expect(truncateGraphemes('abc', 0)).toBe('');
  });
});
