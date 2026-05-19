import { describe, it, expect } from 'vitest';
import {
  decodeHtmlBytes,
  detectCharset,
  normalizeCharset,
  parseOgp,
  decodeEntities,
  extractTextExcerpt,
} from '../src/modules/ogpFetcher.js';

describe('normalizeCharset', () => {
  it('UTF-8 のバリエーションを正規化', () => {
    expect(normalizeCharset('UTF-8')).toBe('utf-8');
    expect(normalizeCharset('utf8')).toBe('utf-8');
    expect(normalizeCharset('UTF_8')).toBe('utf-8');
  });

  it('Shift_JIS の各種表記を正規化', () => {
    for (const name of [
      'Shift_JIS',
      'Shift-JIS',
      'SJIS',
      'x-sjis',
      'Windows-31J',
      'CP932',
      'MS932',
    ]) {
      expect(normalizeCharset(name)).toBe('shift_jis');
    }
  });

  it('EUC-JP / ISO-2022-JP を正規化', () => {
    expect(normalizeCharset('EUC-JP')).toBe('euc-jp');
    expect(normalizeCharset('euc_jp')).toBe('euc-jp');
    expect(normalizeCharset('ISO-2022-JP')).toBe('iso-2022-jp');
  });

  it('不明な文字コードは小文字でそのまま', () => {
    expect(normalizeCharset('big5')).toBe('big5');
  });
});

describe('detectCharset', () => {
  it('Content-Type ヘッダから検出', () => {
    const bytes = Buffer.from('<html></html>', 'utf-8');
    expect(
      detectCharset(bytes, 'text/html; charset=Shift_JIS')
    ).toBe('shift_jis');
    expect(detectCharset(bytes, 'text/html; charset=UTF-8')).toBe('utf-8');
  });

  it('HTML の <meta charset="..."> から検出', () => {
    const html = '<!doctype html><html><head><meta charset="Shift_JIS"></head></html>';
    const bytes = Buffer.from(html, 'utf-8');
    expect(detectCharset(bytes)).toBe('shift_jis');
  });

  it('HTML の <meta http-equiv="Content-Type" ...> から検出', () => {
    const html =
      '<!doctype html><html><head>' +
      '<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">' +
      '</head></html>';
    const bytes = Buffer.from(html, 'utf-8');
    expect(detectCharset(bytes)).toBe('euc-jp');
  });

  it('検出できなければ utf-8 にフォールバック', () => {
    const bytes = Buffer.from('<html><body>foo</body></html>', 'utf-8');
    expect(detectCharset(bytes)).toBe('utf-8');
  });

  it('Content-Type ヘッダが <meta> より優先', () => {
    const html = '<meta charset="UTF-8">';
    const bytes = Buffer.from(html, 'utf-8');
    expect(detectCharset(bytes, 'text/html; charset=Shift_JIS')).toBe(
      'shift_jis'
    );
  });
});

describe('decodeHtmlBytes', () => {
  it('UTF-8 のバイト列を正しくデコード', () => {
    const html = '<meta charset="UTF-8"><title>こんにちは</title>';
    const bytes = Buffer.from(html, 'utf-8');
    const decoded = decodeHtmlBytes(bytes, 'text/html; charset=UTF-8');
    expect(decoded).toContain('こんにちは');
  });

  it('Shift_JIS のバイト列を <meta> 経由で検出してデコード', () => {
    // <meta> までは ASCII。本文は Shift_JIS バイト列
    const head = '<!doctype html><html><head><meta charset="Shift_JIS"></head><body>';
    const tail = '</body></html>';
    // "テスト" を Shift_JIS でエンコード
    const sjisBody = Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]); // テスト
    const bytes = Buffer.concat([
      Buffer.from(head, 'ascii'),
      sjisBody,
      Buffer.from(tail, 'ascii'),
    ]);
    const decoded = decodeHtmlBytes(bytes);
    expect(decoded).toContain('テスト');
  });
});

describe('parseOgp', () => {
  it('og:title / og:description / og:image を抽出', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="記事タイトル">
        <meta property="og:description" content="記事の説明">
        <meta property="og:image" content="https://example.com/img.png">
      </head><body></body></html>
    `;
    const ogp = parseOgp(html, 'https://example.com/article');
    expect(ogp.title).toBe('記事タイトル');
    expect(ogp.description).toBe('記事の説明');
    expect(ogp.imageUrl).toBe('https://example.com/img.png');
  });

  it('og:title が無ければ <title> をフォールバック', () => {
    const html =
      '<html><head><title>Title fallback</title></head><body></body></html>';
    const ogp = parseOgp(html, 'https://example.com/');
    expect(ogp.title).toBe('Title fallback');
  });

  it('og:image が相対パスなら baseUrl で解決', () => {
    const html = '<meta property="og:image" content="/static/img.png">';
    const ogp = parseOgp(html, 'https://example.com/article/1');
    expect(ogp.imageUrl).toBe('https://example.com/static/img.png');
  });

  it('content と property の順序が逆でも抽出できる', () => {
    const html =
      '<meta content="逆順タイトル" property="og:title">';
    const ogp = parseOgp(html, 'https://example.com/');
    expect(ogp.title).toBe('逆順タイトル');
  });

  it('HTML エンティティをデコードする', () => {
    const html =
      '<meta property="og:title" content="A &amp; B &lt;test&gt;">';
    const ogp = parseOgp(html, 'https://example.com/');
    expect(ogp.title).toBe('A & B <test>');
  });

  it('本文の <p> から textExcerpt を抽出する', () => {
    const html = `
      <html><head>
        <title>An article</title>
      </head><body>
        <header><nav>menu menu menu</nav></header>
        <article>
          <h1>Title here</h1>
          <p>This is the first substantial paragraph of the article body.</p>
          <p>Second paragraph adds more context to what the article discusses.</p>
        </article>
        <footer>copyright</footer>
      </body></html>
    `;
    const ogp = parseOgp(html, 'https://example.com/');
    expect(ogp.textExcerpt).toContain('first substantial paragraph');
    expect(ogp.textExcerpt).toContain('Second paragraph');
    expect(ogp.textExcerpt).not.toContain('menu menu');
    expect(ogp.textExcerpt).not.toContain('copyright');
  });
});

describe('extractTextExcerpt', () => {
  it('script / style / nav を除去する', () => {
    const html = `
      <body>
        <nav>navigation here for sure</nav>
        <script>alert('xss script content');</script>
        <style>.a { color: red; }</style>
        <p>This is the actual article content paragraph.</p>
      </body>
    `;
    const text = extractTextExcerpt(html);
    expect(text).toContain('actual article content paragraph');
    expect(text).not.toContain('navigation here');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color: red');
  });

  it('30 文字未満の <p> はスキップする (noise 扱い)', () => {
    const html = `
      <p>short</p>
      <p>also short</p>
      <p>This is a sufficiently long paragraph to be considered actual content.</p>
    `;
    const text = extractTextExcerpt(html);
    expect(text).toContain('sufficiently long paragraph');
    expect(text).not.toContain('short');
  });

  it('<p> が見つからなければ全テキストの先頭を返す', () => {
    const html = '<div>Hello world this is the only text in this page.</div>';
    const text = extractTextExcerpt(html);
    expect(text).toContain('Hello world');
  });

  it('maxChars を超えたら切る', () => {
    const long = 'a'.repeat(100);
    const html = `<p>${long} ${long} ${long} ${long} ${long}</p>`;
    const text = extractTextExcerpt(html, 100);
    expect(text.length).toBeLessThanOrEqual(100);
  });

  it('空 HTML は空文字', () => {
    expect(extractTextExcerpt('')).toBe('');
  });

  it('HTML エンティティはデコードする', () => {
    const html = '<p>A &amp; B is sufficient as a long paragraph here.</p>';
    const text = extractTextExcerpt(html);
    expect(text).toContain('A & B');
  });
});

describe('decodeEntities', () => {
  it('基本的な実体参照をデコード', () => {
    expect(decodeEntities('&amp;')).toBe('&');
    expect(decodeEntities('&lt;')).toBe('<');
    expect(decodeEntities('&gt;')).toBe('>');
    expect(decodeEntities('&quot;')).toBe('"');
    expect(decodeEntities('&#39;')).toBe("'");
    expect(decodeEntities('&nbsp;')).toBe(' ');
  });

  it('数値文字参照をデコード', () => {
    expect(decodeEntities('&#12354;')).toBe('あ');
    expect(decodeEntities('&#x3042;')).toBe('あ');
  });
});
