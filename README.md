# sec-news-bot

[![Post security news to Bluesky](https://github.com/httttmm/sec-news-bot/actions/workflows/post-articles.yml/badge.svg)](https://github.com/httttmm/sec-news-bot/actions/workflows/post-articles.yml)

セキュリティ関連ニュースを国内外の RSS から集め、英語記事は Claude (Anthropic) で **日本語に翻訳** して Bluesky に投稿する Bot です。

GitHub Actions の cron で JST 9〜23 時の毎時 1 件ずつ投稿します。

---

## 投稿フォーマット

```
[日本語タイトル]

[2〜3 文の日本語要約 (100〜170 字)]

[#ハッシュタグ1 #ハッシュタグ2 #ハッシュタグ3]
```

リンクカード部分:
- 元記事の URL
- 日本語訳されたタイトルと説明
- 元記事の OGP 画像 (1MB 以内)

ハッシュタグは記事内容に応じて自動選定（最大 3 つ）。`src/modules/hashtagger.ts` の `HASHTAG_RULES` を編集してカスタマイズ可能。

---

## デフォルトのソース

| ソース | URL | 言語 | 内容 |
|---|---|---|---|
| **BleepingComputer** | bleepingcomputer.com | 英 | ランサムウェア・漏洩・侵害の報告ニュース |
| **The Hacker News** | thehackernews.com | 英 | CVE・サプライチェーン攻撃の解説 |
| **ScanNetSecurity** | scan.netsecurity.ne.jp | 日 | 国内インシデント |

追加したいソースがあれば `SEC_FEED_URLS` をカンマ区切りで指定して上書きできます。

## 構成

```
sec-news-bot/
├── src/
│   ├── index.ts                  # オーケストレーター
│   ├── types/index.ts            # 型定義
│   └── modules/
│       ├── config.ts             # 環境変数読込
│       ├── logger.ts             # 構造化ログ
│       ├── dotenv.ts             # .env 読込
│       ├── rssFetcher.ts         # 複数 RSS を並列取得・マージ
│       ├── keywordFilter.ts      # セキュリティキーワード ホワイトリスト
│       ├── hashtagger.ts         # 記事内容に応じたハッシュタグ自動選定 (最大 3)
│       ├── languageDetect.ts     # CJK 比率による簡易言語判定
│       ├── translator.ts         # 言語別の翻訳/要約 (Claude Haiku)
│       ├── postedUrlsStore.ts    # 投稿済み URL の永続化
│       ├── ogpFetcher.ts         # OGP + 本文抽出
│       ├── safeHttp.ts           # SSRF 対策 + サイズ上限
│       └── blueskyPoster.ts      # Bluesky 投稿
├── tests/                        # vitest 単体テスト
├── scripts/
│   └── updateProfile.ts          # Bot bio を更新 (ワンショット)
├── data/posted_urls.json         # 投稿済み URL (Git 管理)
└── .github/workflows/
    └── post-articles.yml         # JST 9〜23時に毎時実行
```

## 必要環境

- Node.js 20 以上
- Bluesky アカウントとアプリパスワード
- Anthropic API キー

## セットアップ (ローカル)

```bash
npm install
cp .env.example .env
# .env を編集して BLUESKY_HANDLE / BLUESKY_APP_PASSWORD / ANTHROPIC_API_KEY を記入

npm run setup:profile   # bio を更新 (初回のみ)
npm run dev              # 動作確認 (実投稿あり・Claude API 課金あり)
```

## 環境変数

| 変数名 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `BLUESKY_HANDLE` | ✅ | — | Bluesky ハンドル名 |
| `BLUESKY_APP_PASSWORD` | ✅ | — | Bluesky アプリパスワード |
| `ANTHROPIC_API_KEY` | ✅ | — | Anthropic API キー |
| `TRANSLATION_MODEL` | — | `claude-haiku-4-5-20251001` | 使用 Claude モデル |
| `SEC_FEED_URLS` | — | (デフォルト 3 ソース) | カンマ区切りで上書き可 |
| `MAX_POSTS_PER_RUN` | — | `1` | 1 実行あたり最大投稿件数 |
| `DISABLE_KEYWORD_FILTER` | — | `false` | `true` でキーワードフィルタを無効化 |
| `POSTED_URLS_FILE` | — | `data/posted_urls.json` | 投稿済み URL 保存先 |
| `MAX_STORED_URLS` | — | `1000` | 投稿済み URL の保持上限 (超えると古いものからバッチ削除) |
| `POST_INTERVAL_MS` | — | `3000` | 投稿間隔 (ms) |
| `BOT_DESCRIPTION` | — | (出典明示文) | `npm run setup:profile` で bio に設定 |
| `DEBUG` | — | — | `true` でデバッグログ |

## キーワードフィルタ

`src/modules/keywordFilter.ts` の `SECURITY_KEYWORDS` で定義。デフォルトでは以下をカバー:

- CVE / 脆弱性 / ゼロデイ
- ランサムウェア / 恐喝
- 漏洩 / 侵入 / 不正アクセス
- サプライチェーン攻撃 / 悪意のあるパッケージ
- マルウェア / フィッシング
- 各種攻撃手法 (RCE, XSS, SQL injection 等)

雑音が多い / 拾いたいキーワードがある場合はリストを直接編集してください。

`DISABLE_KEYWORD_FILTER=true` で一時的にフィルタを切れます (デバッグ用)。

## テスト

```bash
npm test
npm run typecheck
```

## GitHub Actions の設定

1. **Settings → Secrets and variables → Actions** で登録:
   - `BLUESKY_HANDLE`
   - `BLUESKY_APP_PASSWORD`
   - `ANTHROPIC_API_KEY`
2. **Settings → Actions → General → Workflow permissions** で *Read and write permissions* を有効化
3. **Actions** タブから `Post security news to Bluesky` を `workflow_dispatch` で手動実行して動作確認

## 設計上の注意点

- **マルチソース**: 並列取得 (`Promise.allSettled`)、1 ソース落ちても全体は続行
- **重複排除**: 同じ URL は 1 件のみ。複数ソースで取り上げられても 1 回
- **言語判定**: CJK 文字の比率が 15% 以上で日本語と判定
- **翻訳失敗時**: 英語/原文タイトルで投稿 (記事自体は飛ばさない)
- **SSRF 対策**: og:image 経由でプライベート IP へ飛ばない
- **`posted_urls.json` の上限**: デフォルト 1000 件 (`MAX_STORED_URLS` で変更可)。超過時はバッチで 10% 削減 (例: 1000 → 900 件)
