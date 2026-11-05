# progress.md

最終更新: 2026-11-05。仕様の正本は `REQUIREMENTS.md`、設計判断と決定事項は `DESIGN.md` §9。

## 現在の状態

- 試作版 **v0.1.0（Step 2: RGB MVP）** を GitHub（edi-tool/color-palette）に追加し、GitHub Pages で公開する作業を 2026-11-05 に実施。公開URL: https://edi-tool.github.io/color-palette/
- 公開時の注記: 語彙・面積比・距離の閾値は**評価前の目安**。CMYK数値は**未提供**（Step 3 未着手）。
- ポータル（edi-tool.github.io）・組織プロフィール（.github）への掲載は**未実施**（ユーザー合意待ち。Step 4）。
- デザイン（指針・画面案・用途別プレビュー・OGP画像）は、ユーザーが別途 Claude Design に依頼する。依頼文の下書き: `docs/claude-design-brief.md`。

## 実装済み

- `src/`: color-utils（OKLab/OKLCH・色域マッピング・WCAG）/ rng / semantic-model / vocab.json（30語）/ palette-engine（層別サンプリング・最遠点選抜・深掘り・ロック再提案）/ export（かんたん・くわしく・HEXのみ・CSS・JSON）/ state / url-state / print-profile（CMYK未提供スタブ）/ app.js
- 用途は5区分（一般／書籍カバー／チラシ・ポスター／教材・学級通信／Web・SNS）。
- UI: スマホは下から開くシート、PCは横並び。URLフラグメントで状態復帰。

## 検証結果（2026-11-05）

- `npm test` 43件 pass / `npm run check` エラー0。
- E2E（Playwright 1.64.1、`tests/e2e/`、Windows の Chrome）28件、連続3回以上 全件 pass（約11〜14秒）。内容: 幅320/360/390/430/768/1024/1440の横スクロール無し・列数・44px、文字200%、24案の系統、追加24案、3語上限、未知語、スマホ一連操作（スクロール位置保持）、Escape、Clipboard失敗、不正HEX、ロック不変、Undo、コントラスト、深掘り、5形式コピー、印刷モードでCMYK非表示、URL復帰、外部リクエスト無し、コンソールエラー無し、ダーク、キーボード。
- E2E が見つけた不具合: 文字200%で用途欄・役割行が約123px はみ出す → CSS修正済み。
- 教訓: 古いサーバーの再利用は接続拒否で不安定になる → `reuseExistingServer:false`、Node製の最小サーバー（`server.cjs`）。静的配信ではCSSがキャッシュされ古い見た目が残ることがある（公開後は10分程度のキャッシュに注意）。

## 残課題（優先順）

1. **公開後の確認**: 公開URLでの動作、CI（e2e ジョブは ubuntu の Chrome で初実行）。結果は下の「公開時の記録」に追記する。
2. **実機確認**: iPhone Safari（基準）・Android Chrome・Mac Safari。E2E は Windows Chrome のみ。スクリーンリーダー未確認。
3. **語彙・数値の評価**: 評価セットの作成と採点（DESIGN.md §7）。語彙辞書・役割重み・面積比・距離閾値の調整。
4. **ポータル掲載（Step 4）**: edi-tool.github.io の index.html / sitemap.xml / README.md / 404.html / OGP、.github の profile/README.md。ユーザー合意後に1コミットで。
5. **OGP画像**: Claude Design の成果を受け取り、`og:image` / `twitter:card` を追加（現在は未設定）。
6. **デザイン取り込み**: Claude Design の成果物を取り込み、既存の `id` / クラス / `data-*`（E2E依存）を保って回帰確認。
7. **Step 3（ICC-CMYK）**: lcms-wasm（同梱は要承認）・Japan Color 2011 Coated の再配布条件の確認・変換実装。完了まで「CMYK対応」と宣伝しない。
8. 未実装機能: シード配色（人の監修が必要）、詳細スライダー、シード色指定、近似色の差し替え、お気に入り保存、画像書き出し。
9. 24案生成の実機計測（Node では約0.3秒）。
10. `tests/helpers.js`（テンプレ複製・CommonJS）は未使用。`type: module` 下では読み込めない。テンプレ同期（check-template-sync）の扱いは要検討。

## 決定事項（詳細は DESIGN.md §9）

- 本体は依存ゼロ・OKLCH自作。Playwright は `tests/e2e/` に分離。lcms-wasm は Step 3 で別途承認。
- 用途5区分（Web・SNS統合）。数値は仮置きで進める。
- 公開時期: 当初は評価・実機確認後だったが、2026-11-05 のユーザー指示で試作版を先行公開。
- 運用: 軽微な修正での push 禁止（複数修正を1コミットに）。ポータル掲載は合意後。

## 公開時の記録

（公開後に追記）
