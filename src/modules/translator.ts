import Anthropic from '@anthropic-ai/sdk';
import type { Language, TranslatedContent } from '../types/index.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT_EN_TO_JA = `You translate cybersecurity news from English to natural Japanese for a security-focused Bluesky bot aimed at Japanese security professionals and developers.

Output format: Respond ONLY with a single JSON object, no markdown, no extra prose:
{"title": "...", "description": "..."}

Translation requirements:
- Produce natural, idiomatic Japanese for security headlines
- Preserve security-specific identifiers exactly: CVE IDs (e.g. "CVE-2024-12345"), CVSS scores, software/vendor names, threat actor names, country names
- Keep widely-known security terms in English when commonly used in Japanese (e.g., "ランサムウェア", "フィッシング", but "DDoS", "XSS", "RCE" stay in English)
- Date / version numbers: keep numeric form

Title:
- Concise, under 70 Japanese characters, headline style
- No filler ("について" / "という話")

Description (BODY of the post — readers see it directly):
- 2-3 sentences, 100-170 Japanese characters
- State specifically: what was found / breached / patched / attacked, who is affected, urgency if relevant
- Avoid fluff like "この記事では〜について解説します"`;

const SYSTEM_PROMPT_JA_SUMMARIZE = `You summarize Japanese cybersecurity news for a Bluesky bot. Input is already in Japanese.

Output format: Respond ONLY with a single JSON object, no markdown:
{"title": "...", "description": "..."}

Rules:
- Title: return the input title as-is, but truncate to under 70 Japanese characters if longer
- Description: 2-3 sentences, 100-170 Japanese characters, summarizing the article body. Be specific (who, what, when, severity). Avoid filler like "本記事では〜"
- Preserve product names, CVE IDs, version numbers, vendor names exactly
- If the description input is empty or just metadata, return an empty string for description`;

export interface TranslatorOptions {
  apiKey: string;
  model?: string;
  client?: Pick<Anthropic, 'messages'>;
  timeoutMs?: number;
}

export interface Translator {
  /**
   * 言語に応じて翻訳または要約する。
   * - 入力が英語 (en) なら日本語に翻訳 + 要約
   * - 入力が日本語 (ja) なら日本語のまま要約
   * - 失敗時は例外 throw
   */
  translate(input: {
    title: string;
    description: string;
    language: Language;
  }): Promise<TranslatedContent>;
}

export function createTranslator(options: TranslatorOptions): Translator {
  const model = options.model?.trim() || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const client: Pick<Anthropic, 'messages'> =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      timeout: timeoutMs,
      // 529 / 429 / 5xx を SDK が自動リトライ。デフォルト 2 → 5 に増やす
      maxRetries: 5,
    });

  return {
    async translate({ title, description, language }) {
      const systemPrompt =
        language === 'ja' ? SYSTEM_PROMPT_JA_SUMMARIZE : SYSTEM_PROMPT_EN_TO_JA;
      const userText = [
        `Title: ${title}`,
        '',
        `Description: ${description.trim() || '(no description available)'}`,
      ].join('\n');

      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }],
      });

      const block = response.content?.[0];
      if (!block || block.type !== 'text') {
        throw new Error('Unexpected response from Claude: no text content');
      }
      const parsed = parseJsonResponse(block.text);
      if (!parsed) {
        throw new Error(
          `Failed to parse JSON from Claude response: ${truncate(block.text, 200)}`
        );
      }
      return {
        title: pickString(parsed.title, title),
        description: pickString(parsed.description, ''),
      };
    },
  };
}

export function parseJsonResponse(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');

  try {
    const parsed = JSON.parse(cleaned);
    if (isPlainObject(parsed)) return parsed;
  } catch {
    // fall through
  }

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickString(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed || fallback;
  }
  return fallback;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
