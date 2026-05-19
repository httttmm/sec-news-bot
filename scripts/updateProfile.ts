/**
 * Bot アカウントのプロフィール (bio) を更新するワンショットスクリプト。
 *   npm run setup:profile
 *
 * 環境変数:
 *   BLUESKY_HANDLE        必須
 *   BLUESKY_APP_PASSWORD  必須
 *   BOT_DESCRIPTION       任意。未指定なら出典明示のデフォルト文を使用。
 *
 * 既存のプロフィール値 (displayName, avatar, banner 等) は維持し、
 * description のみを上書きする。
 */
import { AtpAgent } from '@atproto/api';
import { loadConfig } from '../src/modules/config.js';
import { loadDotenvIfPresent } from '../src/modules/dotenv.js';

const DEFAULT_DESCRIPTION =
  'セキュリティニュース (脆弱性 / ランサムウェア / 漏洩 / サプライチェーン) を国内外から拾って投稿します。英語記事は Claude (AI) で日本語訳。';

const PROFILE_COLLECTION = 'app.bsky.actor.profile';
const PROFILE_RKEY = 'self';

async function main(): Promise<void> {
  loadDotenvIfPresent();

  // ANTHROPIC_API_KEY と SEC_FEED_URLS のバリデーションを通すためダミーを差し込む
  // (このスクリプトでは実際には使わない)
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = 'dummy-for-setup-profile';
  }

  const config = loadConfig();
  const description =
    (process.env.BOT_DESCRIPTION ?? '').trim() || DEFAULT_DESCRIPTION;

  if (description.length > 256) {
    throw new Error(
      `BOT_DESCRIPTION is too long (${description.length} chars). Bluesky の description は最大 256 文字です。`
    );
  }

  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({
    identifier: config.blueskyHandle,
    password: config.blueskyAppPassword,
  });
  const did = agent.session?.did;
  if (!did) {
    throw new Error('Login succeeded but DID is missing — unexpected');
  }

  let existing: Record<string, unknown> = { $type: PROFILE_COLLECTION };
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: PROFILE_COLLECTION,
      rkey: PROFILE_RKEY,
    });
    if (res.data.value && typeof res.data.value === 'object') {
      existing = { ...(res.data.value as Record<string, unknown>) };
    }
  } catch (err) {
    if (!isRecordNotFound(err)) throw err;
  }

  const updated: Record<string, unknown> = {
    ...existing,
    $type: PROFILE_COLLECTION,
    description,
  };

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: PROFILE_COLLECTION,
    rkey: PROFILE_RKEY,
    record: updated,
  });

  log('profile_updated', {
    handle: config.blueskyHandle,
    description,
    descriptionLength: description.length,
  });
}

function isRecordNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; error?: string; message?: string };
  if (e.status === 400 && e.error === 'RecordNotFound') return true;
  if (
    typeof e.message === 'string' &&
    /RecordNotFound|Could not locate record/i.test(e.message)
  ) {
    return true;
  }
  return false;
}

function log(msg: string, meta?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg,
      ...meta,
    })
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'profile_update_failed',
      error: message,
    })
  );
  process.exit(1);
});
