import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadDotenvIfPresent } from '../src/modules/dotenv.js';

describe('loadDotenvIfPresent', () => {
  let tmpDir: string;
  let tmpFile: string;
  const TEST_KEYS = [
    'DOTENV_TEST_BASIC',
    'DOTENV_TEST_DQ',
    'DOTENV_TEST_SQ',
    'DOTENV_TEST_MULTILINE',
    'DOTENV_TEST_TAB',
    'DOTENV_TEST_QUOTE',
    'DOTENV_TEST_BACKSLASH',
    'DOTENV_TEST_PRESERVE',
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-test-'));
    tmpFile = path.join(tmpDir, '.env');
    // テスト前に汚染してないことを保証
    for (const k of TEST_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of TEST_KEYS) delete process.env[k];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('基本: KEY=value をパース', () => {
    fs.writeFileSync(tmpFile, 'DOTENV_TEST_BASIC=hello\n');
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_BASIC).toBe('hello');
  });

  it('ダブルクォート内の \\n を改行に変換', () => {
    fs.writeFileSync(tmpFile, 'DOTENV_TEST_DQ="line1\\nline2"\n');
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_DQ).toBe('line1\nline2');
  });

  it('シングルクォート内では \\n を literal のまま保持', () => {
    fs.writeFileSync(tmpFile, "DOTENV_TEST_SQ='line1\\nline2'\n");
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_SQ).toBe('line1\\nline2');
  });

  it('複数の \\n を含む multiline 値', () => {
    fs.writeFileSync(
      tmpFile,
      'DOTENV_TEST_MULTILINE="a\\n\\nb\\nc"\n'
    );
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_MULTILINE).toBe('a\n\nb\nc');
  });

  it('\\t をタブに変換', () => {
    fs.writeFileSync(tmpFile, 'DOTENV_TEST_TAB="a\\tb"\n');
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_TAB).toBe('a\tb');
  });

  it('\\" を literal クォートに変換', () => {
    fs.writeFileSync(tmpFile, 'DOTENV_TEST_QUOTE="say \\"hi\\""\n');
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_QUOTE).toBe('say "hi"');
  });

  it('\\\\ を 1 つの backslash に', () => {
    fs.writeFileSync(tmpFile, 'DOTENV_TEST_BACKSLASH="a\\\\b"\n');
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_BACKSLASH).toBe('a\\b');
  });

  it('既に process.env に値があれば上書きしない', () => {
    process.env.DOTENV_TEST_PRESERVE = 'original';
    fs.writeFileSync(tmpFile, 'DOTENV_TEST_PRESERVE=overwritten\n');
    loadDotenvIfPresent(tmpFile);
    expect(process.env.DOTENV_TEST_PRESERVE).toBe('original');
  });

  it('ファイルが無ければ何もしない (例外も投げない)', () => {
    const missing = path.join(tmpDir, 'nope.env');
    expect(() => loadDotenvIfPresent(missing)).not.toThrow();
  });
});
