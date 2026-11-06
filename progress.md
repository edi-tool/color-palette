# progress.md

## 2026-11-06 セッション（edi-tool 共通デザイン 2026-11-06 版の適用）

- edi-tool/.github の `DESIGN.md` 2026-11-06 版（案C「ソフト面×蛍光オレンジ」）に合わせて配色を置換した。背景 #f8f6f2 → #f5f5f7、アクセント #f28c06 → #ff6a00、文字用アクセントとフォーカス枠 #9a5200・#b35f00 → #c2410c、ダークは無彩の黒（#0b0b0c・#161618 ほか）に。
- 角丸の 6/10/14/20px を 8/12/16/24px に置き換えた（それ以外の値はそのまま）。
- フォーカス枠を `--accent`（白地 2.9:1）から新設の `--focus` に。
- 共通の上部バー（「edi-tool ＞ ツール名」、`.et-bar`）を追加し、旧 `.brand-link` を外した。見出しを左寄せ・太字（800）に。`--accent-soft` を淡オレンジから無彩の薄灰 #f0f0f3（ダーク #222225）に。
- 結果の配色カードを、スマホ幅 389px 以下は2列（375px では 1 列になっていた）、390〜599px は3列に固定。3列では見本の文字と丸を小さくして重なりを防いだ。
- 文字記号（⚠・✓・🔒・▼・↓・←・→・×）を、共通の線のアイコン（`data-icon` 属性と `.et-i`、CSS マスク）に置き換えた。
- コピーの成功はボタンの中だけで示し、トーストは失敗時の説明に限った。E2E を合わせて更新。`ogp.png` を新しい配色に。

最終更新: 2026-11-05。仕様の正本は `REQUIREMENTS.md`、設計判断と決定事項は `DESIGN.md` §9。
- ファビコンを共通の形（蛍光オレンジの角丸＋ツールの線アイコン）に。`favicon.svg`・`favicon.ico`（16/32/48）・`favicon.png`（192）・`apple-touch-icon.png`（180）を置き、`<head>` の指定を3行にそろえた（生成はハブの `scripts/ogp/favicon.js`）。 ファビコンの指定がなかったので追加し、`theme-color` をライト・ダークの2行に。

## 現在の状態

- 試作版 **v0.1.0（Step 2: RGB MVP）** を 2026-11-05 に GitHub（https://github.com/edi-tool/color-palette）へ追加し、GitHub Pages で公開済み。公開URL: https://edi-tool.github.io/color-palette/
- 公開時の注記: 語彙・面積比・距離の閾値は**評価前の目安**。CMYK数値は**未提供**（Step 3 未着手）。
- ポータル（edi-tool.github.io）・組織プロフィール（.github）へ 2026-11-05 に掲載済み（Step 4。詳細は「公開時の記録」）。`og:image` も設定済み。
- デザイン（指針・画面案・用途別プレビュー・OGP画像）は、ユーザーが別途 Claude Design に依頼する。依頼文の下書き: `docs/claude-design-brief.md`。

## 2026-11-05 点検・改善（ブランチ `claude/sonnet-code-review-00d382`、未コミット時点の記録）

- 点検で直した不具合: ①印象語・出力想定を変えるとカードの系統ラベルが古いまま（id が seed・順番だけで決まるため、描画の差分判定を候補オブジェクトで行うよう変更）②スマホのシート表示中に Tab で背後へ出られた（背後を `inert`）③広い画面で詳細欄の role が dialog のまま残る ④「さらに24案」で増えないときに無反応（トースト表示）。
- 性能: 「さらに24案」3回目が約6秒→約0.8秒（`hexToOklab` のキャッシュ。生成結果は不変）。DESIGN.md §3.8。
- 先行ツール比較で追加: 色覚の多様性シミュレーション（`src/vision.js`、DESIGN.md §3.7）。
- トライアドの頻度を下げ（約22%→約8%）、印象語を押すたびに seed を変える（DESIGN.md §3.9）。
- 用途を生成に反映・色の系統の選択・印象語「鮮やか」「カラフル」・ボタンの大きさをそろえる・色覚の補助欄を操作の下へ移す・シートの固定部分を縮める（DESIGN.md §3.10）。
- 検証: `npm test` 57件 pass、`npm run check` エラー0、E2E 33件 pass。
- 先行ツール比較で見送った候補: Adobe スウォッチ（.ase）書き出し（保留。残課題 8a）、近似の色名表示（色名データの出典・ライセンスが課題。nipponcolors 等の複写は不可）、用途別の見本を増やす（デザイン依頼と重なる）、配色技法名（トーン・オン・トーン、カマイユ等）での生成、Redo。
- 表示名を「配色提案さん」に統一（ユーザー判断）。AGENTS.md・REQUIREMENTS.md・DESIGN.md・package.json・styles.css・docs・OGP 原本と `ogp.png`（ヘッドレス Chrome で再撮影、名前は 72px）を更新。過去の作業記録の旧名は残した。**ポータル（edi-tool.github.io）と組織プロフィール（.github）の表記「配色さん」は未変更**（掲載先の変更は合意後）。
- 気づき: 公開後、ブラウザに古いモジュールが残ると新旧が混ざって起動に失敗しうる（ローカル確認で実際に発生）。Pages のキャッシュは約10分。

## 実装済み

- `src/`: color-utils（OKLab/OKLCH・色域マッピング・WCAG）/ rng / semantic-model / vocab.json（32語）/ palette-engine（層別サンプリング・最遠点選抜・深掘り・ロック再提案）/ export（かんたん・くわしく・HEXのみ・CSS・JSON）/ state / url-state / print-profile（CMYK未提供スタブ）/ app.js
- 用途は5区分（一般／書籍カバー／チラシ・ポスター／教材・学級通信／Web・SNS）。
- UI: スマホは下から開くシート、PCは横並び。URLフラグメントで状態復帰。

## 検証結果（2026-11-05）

- `npm test` 43件 pass / `npm run check` エラー0。
- E2E（Playwright 1.64.1、`tests/e2e/`、Windows の Chrome）28件、連続3回以上 全件 pass（約11〜14秒）。内容: 幅320/360/390/430/768/1024/1440の横スクロール無し・列数・44px、文字200%、24案の系統、追加24案、3語上限、未知語、スマホ一連操作（スクロール位置保持）、Escape、Clipboard失敗、不正HEX、ロック不変、Undo、コントラスト、深掘り、5形式コピー、印刷モードでCMYK非表示、URL復帰、外部リクエスト無し、コンソールエラー無し、ダーク、キーボード。
- E2E が見つけた不具合: 文字200%で用途欄・役割行が約123px はみ出す → CSS修正済み。
- 教訓: 古いサーバーの再利用は接続拒否で不安定になる → `reuseExistingServer:false`、Node製の最小サーバー（`server.cjs`）。静的配信ではCSSがキャッシュされ古い見た目が残ることがある（公開後は10分程度のキャッシュに注意）。

## 残課題（優先順）

1. （完了）公開後の確認。結果は「公開時の記録」。
2. **実機確認**: iPhone Safari（基準）・Android Chrome・Mac Safari。E2E は Windows Chrome のみ。スクリーンリーダー未確認。
3. **語彙・数値の評価**: 評価セットの作成と採点（DESIGN.md §7）。語彙辞書・役割重み・面積比・距離閾値の調整。
4. （完了）ポータル掲載（Step 4）。
5. **OGP画像**: 2026-11-05 に、ポータル共通スクリプトの暫定版を Claude Design の成果（配色カード入り。原本 `docs/design/ogp.html`）に差し替えた。ハブの ogp.png と同じ型（白カード・左のオレンジ帯・アイコン・札）を保っている。SNS側のキャッシュで反映が遅れる。
6. **デザイン取り込み**: 指針 `docs/design-guidelines.md` と画面案（Claude Design キャンバス「配色さん デザイン指針と画面案」）ができた。次は §10 の CSS を `styles.css` に反映し、`#results-summary`・`#btn-open-detail` を追加して回帰確認。既存の `id` / クラス / `data-*` は変えない。
6a. **配色エンジン刷新（2026-11-05）**: 役割ごとの明度の型＋品質の足切りに変更（docs/palette-analysis.md）。問題案 47% → 5%、npm test 44件（品質テスト追加）・E2E 28件合格。PR #1。
7. **Step 3（ICC-CMYK）**: lcms-wasm（同梱は要承認）・Japan Color 2011 Coated の再配布条件の確認・変換実装。完了まで「CMYK対応」と宣伝しない。
8. 未実装機能: シード配色（人の監修が必要）、詳細スライダー、シード色指定、近似色の差し替え、お気に入り保存、画像書き出し。
8a. **保留（2026-11-05 ユーザー判断）: Adobe スウォッチ（.ase）書き出し。** InDesign・Illustrator に色見本として読み込める形式（Paletton 等にある）。実装する場合は RGB のみ（CMYK は ICC 変換まで出さない）、ブラウザ内でファイルを生成してダウンロード（外部送信なし・依存なし）。着手はユーザーの指示を待つ。
9. 24案生成の実機計測（Node では約0.3秒）。
10. `tests/helpers.js`（テンプレ複製・CommonJS）は未使用。`type: module` 下では読み込めない。テンプレ同期（check-template-sync）の扱いは要検討。

## 決定事項（詳細は DESIGN.md §9）

- 本体は依存ゼロ・OKLCH自作。Playwright は `tests/e2e/` に分離。lcms-wasm は Step 3 で別途承認。
- 用途5区分（Web・SNS統合）。数値は仮置きで進める。
- 公開時期: 当初は評価・実機確認後だったが、2026-11-05 のユーザー指示で試作版を先行公開。
- 運用: 軽微な修正での push 禁止（複数修正を1コミットに）。ポータル掲載は合意後。

## 公開時の記録

2026-11-05 の公開作業:
- リポジトリ **`edi-tool/color-palette`**（public、main）を作成して push（初回コミット `a62ad29`）。Pages は legacy・main・`/`（zukei-drafter と同じ設定）。
- Pages ビルド `built`。公開URLは 200（HTML/CSS/JS/vocab.json）。開発用ファイル（REQUIREMENTS.md・AGENTS.md・DESIGN.md・progress.md・tests/・docs/・package.json）は 404（`_config.yml` の exclude が効いている）。
- 公開ページ（Chromium）: 「明るい」→24案（暖色系／寒色・緑系／無彩色＋差し色）→詳細のコピー文プレビュー表示、横スクロール無し、コンソールエラー無し。
- CI（push 時）: `test` と `e2e` の両ジョブ success（e2e は ubuntu の Chrome で初実行・成功）。
- この時点では未実施: ポータル掲載、og:image、実機確認。

2026-11-05 のポータル掲載（Step 4）:
- `edi-tool/edi-tool.github.io`: index.html にカード（配色さん・タグ「配色・AI指示文」）、sitemap.xml、README の掲載ツール表、404.html の一覧、ハブの meta description、`ogp.png`（ハブ画像を再生成。全ツールのアイコン一覧に配色さんを追加）、`scripts/ogp/gen.js` と README（7ツール・8枚出力）を更新。`npm test` 5件 pass、`npm run check` エラー0（警告1件は変更前からある 404.html の meta description）。
- `edi-tool/.github`: `profile/README.md` の「出版・編集実務」に配色さんを追記（試作版と明記）。
- 配色さん側: `ogp.png`（scripts/ogp の標準テンプレートで生成）と `og:image` / `twitter:card` / JSON-LD の image を追加。
- 教訓: 生成物の `scripts/ogp/node_modules` と `out/` はコミットしない（ポータルには .gitignore が無いので、生成後に削除した）。
- 未実施: Search Console の登録・サイトマップ送信などの運用設定。
