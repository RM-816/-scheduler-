# scheduler

完全オフライン動作の静的スケジュール管理PWAです。予定、ToDo、設定はブラウザ内に保存され、外部APIは使用しません。

## 主な機能

- 話し言葉の入力から予定を追加
- 音声入力による予定作成
- 写真OCRまたは貼り付けテキストから予定候補を一括取込
- 月表示・週表示のカレンダー
- 予定ごとのリマインド通知
- 予定単位・日付単位の共有リンク作成
- カテゴリの名前・色の編集
- ホーム画面追加に対応したPWA
- オフライン起動対応

## 使い方

### ローカル

`index.html` をブラウザで直接開くか、`スケジューラーを起動.bat` を実行してローカルサーバーで開きます。

写真OCRやPWA機能を確認する場合は、ローカルサーバー経由で開いてください。

### Web

公開後のURL: `(デプロイURL)`

## 技術構成

- vanilla JS
- HTML / CSS
- PWA: `manifest.json` / `sw.js`
- Tesseract.jsローカル同梱
- 外部API不使用
- データ保存: ブラウザの `localStorage`

## ディレクトリ構成

```text
.
├── index.html
├── app.js
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
