# color-palette（配色さん）

日本語の印象語から、方向性の異なる多数の配色を比較し、AIに渡す配色指示文までコピーできるブラウザツール。公開URL: https://edi-tool.github.io/color-palette/（2026-11-05 公開・試作版）
`CLAUDE.md` はこのファイルを取り込むだけなので、エージェント共通の規則はここに書く。
仕様の正本は `REQUIREMENTS.md`、設計判断は `DESIGN.md`。

## 実行コマンド

- プレビュー: `python -m http.server 8000`
- テスト: `npm test`（Node.js 22 以上、`node:test`、依存なし）
- HTML 静的チェック: `npm run check`
- E2E: `cd tests/e2e && npm ci && npx playwright test`（システムの Chrome を使用。本体の依存には含めない）

## 守ること

- [edi-tool 開発原則](https://github.com/edi-tool/.github/blob/main/PRINCIPLES.md) に従う。
- 表示名は「配色さん」、リポジトリ・URLスラッグは `color-palette`。旧案 `haishoku-san` は使わない。
- 外部送信なし。ログイン・分析タグ・広告なし。実行時のCDN・外部API依存を作らない。
- 色の正本は「役割付きHEX＋生成シード」。CMYK数値はICC変換が成功したときだけ出し、一般式の近似値を出さない。失敗は「該当なし」でなく失敗として表示する。
- 画像生成AIの色再現を保証する表現、印刷結果を保証する表現を書かない。
- 色演算・生成・コピー文生成は純粋関数（`src/` 配下）に分け、UIから独立してテストする。
- 依存を足す前に、必要性・ライセンス・バージョン・容量を `DESIGN.md` に記録し、ユーザーの合意を取る。
- 語彙辞書・シード配色は独自作成。外部の色見本（日本カラーデザイン研究所のスケール等）を複写しない。作者とライセンスを記録する。
- `scripts/check-static.mjs` と `tests/helpers.js` は edi-tool/.github の原本からのコピー。直すときは原本も直す。
- ポータル（edi-tool.github.io）・組織プロフィール（.github）への掲載は、ユーザーの合意を得てから行う。軽微な修正での push 禁止。複数修正を1コミットに集約する。
- セッション終了時に `progress.md` を更新。
