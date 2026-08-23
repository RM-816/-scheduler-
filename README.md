# scheduler

完全オフライン動作の静的スケジュール管理PWAです。予定、ToDo、設定はブラウザ内に保存されます。同期をONにした場合は、Vercel Serverless API経由で同期サーバーにも保存されます。

## 主な機能

- 話し言葉の入力から予定を追加
- 音声入力による予定作成
- 写真OCRまたは貼り付けテキストから予定候補を一括取込
- 月表示・週表示のカレンダー
- 予定ごとのリマインド通知
- LINE公式アカウントからのリマインド通知
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

## LINEミニアプリ（LIFF）対応

`line-config.js` の `window.LINE_CONFIG.liffId` に LIFF ID を設定すると、LINEアプリ内で開いたときだけ LINE 共有と連携表示が有効になります。初期値は空文字のため、未設定では LIFF SDK の読み込みや初期化は行われません。

LINE Developers では LINEログインチャネルを作成し、チャネル内で LIFF アプリを追加してください。LIFF のエンドポイントURLには、Vercelで公開したこのアプリのURLを設定します。LIFF経由の同期招待・予定共有は URL フラグメントが保持されないため、`?sync=ID.KEY` と `?share=BASE64` のクエリ形式でも受け取れるようにしています。

## 技術構成

- vanilla JS
- HTML / CSS
- PWA: `manifest.json` / `sw.js`
- LINEミニアプリ対応: `line-config.js` / `line.js`
- Tesseract.jsローカル同梱
- 同期API: `api/sync.js` (Vercel Node serverless)
- LINE通知API: `api/line-link.js` / `api/line-push.js`
- データ保存: ブラウザの `localStorage`
- 同期ストレージ: Upstash Redis REST API

## 同期機能

設定画面の「端末間の同期」から同期コードを作ると、予定・ToDo・カテゴリ・既定リマインドがほかの端末と自動で統合されます。通知ON/OFF、ウェルカム表示、同期設定自体は端末ごとのローカル設定です。

Vercelの環境変数には、次のどちらかの組み合わせを設定してください。

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`

どちらも未設定の場合、`/api/sync` は `503 {"error":"storage_not_configured"}` を返し、アプリ側では同期ボタンが無効になります。

## フェーズB: LINEリマインド通知

LINE通知は、LIFF内でログイン中のLINEユーザーと同期グループを `/api/line-link` で紐付け、cronから `/api/line-push` を5分間隔で呼び出して送信します。予定データは同期ストレージの `sync:{id}` を参照するため、先に「端末間の同期」を開始してください。

追加で必要なVercel環境変数:

- `LINE_CHANNEL_ACCESS_TOKEN`: Messaging APIの長期チャネルアクセストークン
- `CRON_SECRET`: cron呼び出し保護用の任意の長い文字列

Upstash Redis RESTの環境変数は同期機能と同じものを使います。LINE通知API側の設定が不足している場合、対象APIは `503 {"error":"line_not_configured"}` を返し、アプリ側では「LINE通知は現在準備中です」と表示します。

cronはQStash、Vercel Cron、GitHub Actionsなどから5分間隔で次のURLを叩いてください。

```text
https://<your-domain>/api/line-push?key=<CRON_SECRET>
```

QStashのcron例:

```text
*/5 * * * *  GET https://<your-domain>/api/line-push?key=<CRON_SECRET>
```

通知を受け取るには、ユーザーがLINE公式アカウントを友だち追加している必要があります。友だち未追加などでMessaging APIのpushが4xxを返した場合でも、cron処理はほかのユーザーに対して継続します。

## ディレクトリ構成

```text
.
├── index.html
├── app.js
├── line-config.js
├── line.js
├── api/
│   ├── sync.js
│   ├── line-link.js
│   └── line-push.js
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
