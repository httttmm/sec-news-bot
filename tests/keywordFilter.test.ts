import { describe, it, expect } from 'vitest';
import {
  matchesSecurityTopic,
  filterBySecurityTopic,
} from '../src/modules/keywordFilter.js';
import type { SecArticle } from '../src/types/index.js';

function makeArticle(overrides: Partial<SecArticle> = {}): SecArticle {
  return {
    title: 'sample',
    url: 'https://example.com/' + Math.random(),
    contentSnippet: '',
    source: { name: 'test', url: 'https://example.com/feed' },
    language: 'en',
    ...overrides,
  };
}

describe('matchesSecurityTopic', () => {
  it('CVE ID をマッチ', () => {
    expect(
      matchesSecurityTopic(
        makeArticle({ title: 'CVE-2024-12345 affects Apache' })
      )
    ).toBe(true);
  });

  it('ransomware キーワードをマッチ', () => {
    expect(
      matchesSecurityTopic(
        makeArticle({ title: 'New ransomware group targets hospitals' })
      )
    ).toBe(true);
  });

  it('日本語 脆弱性 をマッチ', () => {
    expect(
      matchesSecurityTopic(
        makeArticle({ title: 'OpenSSL に脆弱性、パッチ公開' })
      )
    ).toBe(true);
  });

  it('日本語 ランサムウェア をマッチ', () => {
    expect(
      matchesSecurityTopic(
        makeArticle({ title: '医療機関がランサムウェア被害' })
      )
    ).toBe(true);
  });

  it('contentSnippet の中身もマッチ対象', () => {
    expect(
      matchesSecurityTopic(
        makeArticle({
          title: 'New tech blog post',
          contentSnippet:
            'A malicious package was discovered on npm registry',
        })
      )
    ).toBe(true);
  });

  it('セキュリティと無関係なタイトルは false', () => {
    expect(
      matchesSecurityTopic(
        makeArticle({ title: 'How to bake the perfect bread loaf' })
      )
    ).toBe(false);
    expect(
      matchesSecurityTopic(makeArticle({ title: 'JavaScript framework comparison' }))
    ).toBe(false);
  });

  it('大文字小文字を区別しない', () => {
    expect(
      matchesSecurityTopic(makeArticle({ title: 'RANSOMWARE attack reported' }))
    ).toBe(true);
  });
});

describe('filterBySecurityTopic', () => {
  it('該当記事のみ通す', () => {
    const articles = [
      makeArticle({ title: 'CVE-2024-1 critical bug' }),
      makeArticle({ title: 'New cookie recipe' }),
      makeArticle({ title: 'ransomware hits hospital' }),
    ];
    const filtered = filterBySecurityTopic(articles);
    expect(filtered).toHaveLength(2);
  });

  it('disabled=true なら全件そのまま返す', () => {
    const articles = [
      makeArticle({ title: 'irrelevant' }),
      makeArticle({ title: 'also irrelevant' }),
    ];
    expect(filterBySecurityTopic(articles, /* disabled */ true)).toHaveLength(
      2
    );
  });
});
