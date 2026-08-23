# scheduler

完全オフライン動作の静的スケジュール管理PWAです。予定、ToDo、設定はブラウザ内に保存されます。同期をONにした場合は、Vercel Serverless API経由で同期サーバーにも保存されます。

## 主な機能

- 話し言葉の入力から予定を追加
- 音声入力による予定作成
- 写真OCRまたは貼り付けテキストから予定候補を一括取込
- 月表示・週表示のカレンダー
- 予定ごとのリマインド通知
- 予定単位・日付単位の共有リンク作成
- 同期コード方式の端末間同期
- カテゴリの名前・色の編集
- ホーム画面追加に対応したPWA
- オフライン起動対応

## 使い方

### ローカル

`index.html` をブラウザで直接開くか、`スケジューラーを起動.bat` を実行してローカルサーバーで開きます。

写真OCRやPWA機能を確認する場合は、ローカルサーバー経由で開いてください。

ローカルの `python http.server` などでは `/api/sync` は動作しません。同期機能はVercelなど、`api/sync.js` をNode serverless functionとして実行できる環境で確認してください。

### Web

公開後のURL: `(デプロイURL)`

## 技術構成

- vanilla JS
- HTML / CSS
- PWA: `manifest.json` / `sw.js`
- Tesseract.jsローカル同梱
- 同期API: `api/sync.js` (Vercel Node serverless)
- データ保存: ブラウザの `localStorage`
- 同期ストレージ: Upstash Redis REST API

## 同期機能

設定画面の「端末間の同期」から同期コードを作ると、予定・ToDo・カテゴリ・既定リマインドがほかの端末と自動で統合されます。通知ON/OFF、ウェルカム表示、同期設定自体は端末ごとのローカル設定です。

Vercelの環境変数には、次のどちらかの組み合わせを設定してください。

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`

どちらも未設定の場合、`/api/sync` は `503 {"error":"storage_not_configured"}` を返し、アプリ側では同期ボタンが無効になります。

## ディレクトリ構成

```text
.
├── index.html
├── app.js
├── api/
│   └── sync.js
├── styles.css
├── nlp.js
├── ocr.js
├── holidays.js
├── manifest.json
├── sw.js
├── assets/
├── vendor/
├── スケジューラーを起動.bat
└── README.md
```
