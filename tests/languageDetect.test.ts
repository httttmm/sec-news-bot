import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../src/modules/languageDetect.js';

describe('detectLanguage', () => {
  it('英語タイトルは en', () => {
    expect(
      detectLanguage('Critical RCE in OpenSSL discovered, patch released')
    ).toBe('en');
    expect(detectLanguage('CVE-2024-12345: Apache HTTP Server bug')).toBe('en');
  });

  it('日本語タイトルは ja', () => {
    expect(detectLanguage('OpenSSL に深刻な RCE 脆弱性、パッチ公開')).toBe('ja');
    expect(detectLanguage('企業内サーバから個人情報10万件が流出')).toBe('ja');
  });

  it('日本語混じり (英単語多め) でも ja と判定', () => {
    expect(
      detectLanguage(
        'GitHub Actions に新たな脆弱性、CVE-2024-9999 として発行'
      )
    ).toBe('ja');
  });

  it('空文字は en', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('記号だけは en', () => {
    expect(detectLanguage('!!! ???')).toBe('en');
  });
});
