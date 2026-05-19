import { describe, it, expect, vi } from 'vitest';
import {
  createTranslator,
  parseJsonResponse,
} from '../src/modules/translator.js';

describe('parseJsonResponse', () => {
  it('素直な JSON', () => {
    expect(parseJsonResponse('{"title":"a","description":"b"}')).toEqual({
      title: 'a',
      description: 'b',
    });
  });
  it('Markdown コードブロックを剥がす', () => {
    expect(parseJsonResponse('```json\n{"title":"a"}\n```')).toEqual({
      title: 'a',
    });
  });
  it('前後に文字があっても抽出', () => {
    expect(
      parseJsonResponse('Sure: {"title":"x"} thanks')
    ).toEqual({ title: 'x' });
  });
  it('壊れていれば null', () => {
    expect(parseJsonResponse('not json')).toBeNull();
  });
});

describe('createTranslator', () => {
  function makeClient(text: string) {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text }],
        }),
      },
    };
  }

  it('英語入力 → 英→日 プロンプト経由で翻訳', async () => {
    const client = makeClient(
      JSON.stringify({
        title: 'CVE-2024-1: 深刻な RCE 脆弱性',
        description: 'パッチが本日公開。',
      })
    );
    const translator = createTranslator({
      apiKey: 'sk-test',
      client: client as never,
    });

    const result = await translator.translate({
      title: 'CVE-2024-1: Critical RCE',
      description: 'Patch released today.',
      language: 'en',
    });
    expect(result.title).toContain('CVE-2024-1');
    // システムプロンプトに「Japanese」が入っているはず
    const callArgs = client.messages.create.mock.calls[0]?.[0];
    expect(callArgs?.system).toMatch(/English to natural Japanese/);
  });

  it('日本語入力 → 要約プロンプト経由で要約', async () => {
    const client = makeClient(
      JSON.stringify({
        title: 'OpenSSL に脆弱性',
        description: '本日パッチ公開。',
      })
    );
    const translator = createTranslator({
      apiKey: 'sk-test',
      client: client as never,
    });

    await translator.translate({
      title: 'OpenSSL に深刻な脆弱性',
      description: '詳細は...',
      language: 'ja',
    });

    const callArgs = client.messages.create.mock.calls[0]?.[0];
    expect(callArgs?.system).toMatch(/summarize Japanese cybersecurity/);
  });

  it('JSON 解析失敗で例外', async () => {
    const client = makeClient('not json');
    const translator = createTranslator({
      apiKey: 'sk-test',
      client: client as never,
    });
    await expect(
      translator.translate({ title: 'a', description: 'b', language: 'en' })
    ).rejects.toThrow(/Failed to parse/);
  });
});
