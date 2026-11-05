# 配色さん デザイン指針

版: 2026-11-05（初版） / 画面案: Claude Design キャンバス「配色さん デザイン指針と画面案」
対象: `index.html`・`styles.css`・`src/app.js` の見た目と情報設計。`src/` のロジックと `tests/` は変えない。

## 1. 原則

1. **主役は配色候補。UI は中立に退く。** UI の色は墨・白・生成り（`--bg`）を基本にし、オレンジは主操作（AI用コピー）の塗りと注意の面だけに使う。選択枠にオレンジを使わない（候補の暖色と競合するため）。
2. **主操作は1つ。** 「AIに渡す配色指示をコピー」を詳細欄の最上部に置き、スマホのシートでも PC の詳細欄でもスクロールで隠れない（`position: sticky`）。
3. **状態は色だけで示さない。** 選択・ロック・エラー・成功・注意は、形（枠・塗り反転・点線）＋文字＋アイコンの3つのうち2つ以上で表す。
4. **見本は見本と書く。** 用途別プレビューには「見本」の札と「仕上がりを保証する表示ではありません」を添える。
5. **失敗は失敗として出す。** コピー失敗・語彙辞書の読み込み失敗は「候補なし」と区別して表示する（開発原則9）。

## 2. 色トークン

edi-tool 共通トークンを土台にし、**小さい文字用のアクセント `--accent-ink` と `--focus`・`--control-border` を新設**する。

| トークン | ライト | ダーク | 用途・コントラスト（実測） |
|---|---|---|---|
| `--bg` | `#f8f6f2` | `#1c1b19` | ページ背景 |
| `--surface` | `#ffffff` | `#26241f` | パネル・カード |
| `--surface-2` | `#f1eee8` | `#2f2c26` | 入れ子の面・選択中の形式ボタン |
| `--border` | `#e0e0e0` | `#46423a` | 区切り線（装飾。情報を持たせない） |
| `--control-border` | `#8c877e` | `#8a8476` | 入力欄・ボタンの輪郭。白地 3.57:1／ダーク面 4.17:1（非文字 3:1 以上） |
| `--text` | `#0f0f0f` | `#f3f1ec` | 本文・選択枠・選択チップの塗り。ダーク 15.25:1 |
| `--text-sub` | `#5f5b54` | `#b9b4a8` | 補足。背景上 6.25:1／ダーク面 7.50:1 |
| `--accent` | `#f28c06` | `#f28c06` | 主操作ボタンの塗り。上の文字は `#1a1100`（7.59:1） |
| `--accent-dark` | `#d97a00` | `#d97a00` | 主操作ボタンの枠・押下 |
| `--accent-soft` | `#fff8f0` | `#33281a` | 注意（印刷向け）の面 |
| `--accent-text` | `#b35f00` | `#ffb24d` | 白地の太字・18px 以上に限る（白地 4.61:1） |
| `--accent-ink` **新設** | `#9a5200` | `#ffb24d` | 小さい文字のアクセント・リンク。背景上 5.43:1／淡色上 5.57:1／ダーク 8.66:1 |
| `--focus` **新設** | `#9a5200` | `#ffb24d` | フォーカス枠 |
| `--danger` | `#c62828` | `#ff8a80` | エラー文字。背景上 5.21:1／ダーク 6.79:1 |
| `--danger-soft` **新設** | `#fdf0ef` | `#3a2120` | エラー行の面（文字 5.06:1／6.49:1） |
| `--ok` | `#2e7d32` | `#81c784` | 基準クリアの印 |

**共通トークンの補正（edi-tool 全体）**: `#b35f00` は背景 `#f8f6f2` 上で 4.27:1、`#fff8f0` 上で 4.38:1 と 4.5:1 に届かない。小さい文字は `--accent-ink`（`#9a5200`）へ移す。フォーカス枠 `#f28c06` は背景上 2.28:1 で非文字の 3:1 に届かないため `--focus` にする。

## 3. 文字・余白・角丸・影

- **文字**: 系統フォントのみ（外部フォントなし）。h1 1.75rem/800、h2 1.25rem/700、本文・ボタン 1rem、補足・系統ラベル 0.875rem。**0.875rem 未満は使わない**（13px の札は「見本」「印刷向け（参考）」など1〜6字の装飾札だけ）。行間 1.6。HEX は等幅（`ui-monospace, Consolas, monospace`）。
- **余白**: 4 の倍数（4/8/12/16/24/32/48px）。カード内 8、パネル内 16、区画間 16〜24。
- **角丸**: 6（バー）/ 10（入力・ボタン）/ 14（カード・パネル）/ 20（シート上端）/ 999（チップ・トースト）。
- **影**: 浮いている物（シート・トースト・スマホの「選んだ配色を開く」）だけ。カードとパネルは 1px の線で区切り、影を付けない（候補の色に灰色の滲みを混ぜない）。ダークは面の明度差（`--bg` → `--surface` → `--surface-2`）で重なりを示す。

## 4. 配色カード

- **見本面**（スマホ 92px／PC 118px 高）: 背景が一番広く、左にメインの帯（34%）、右に「Aa 見出し」（メイン）と本文の線（文字）、下にサブの帯、差し色は小さなピル。5等分にしない（要件 3.3）。
- **面積バー**: 背景4・メイン3・サブ2・文字1・差し色0.7。`aria-hidden="true"`（色の内容はボタンの `aria-label` で読む。現行どおり）。
- **系統ラベル**: `.card-label` 0.875rem・`--text-sub`。「寒色・緑系 × 中間 × 類似色」。
- 見本面とバーに **1px の内側線**（ライト `rgba(15,15,15,.10)`／ダーク `rgba(255,255,255,.16)`）。白・黒に近い背景の候補でもカードと区別できる。
- **選択中**: 墨色（`--text`）の 3px 枠＋見本面の左上に「✓ 選択中」バッジ＋ `aria-pressed="true"`。現行の `.card-state` 文字は残してよいが、バッジに置き換えるなら `.card-state` を見本面内へ移す。
- 列数: スマホ 1〜2列（`minmax(min(100%, 150px), 1fr)` のまま）、960〜1199px は 2〜3列、1200px 以上は 3〜4列。

## 5. スマホのシートと PC の詳細欄

| 幅 | 構成 | 詳細の出し方 |
|---|---|---|
| 〜959px | 縦積み（ヘッダ → 印象語パネル → 候補） | 候補をタップで**下から開くシート**（上端 76px を残し最大 90dvh、角丸 20、背景を 48% 暗く）。シート上部に見出しと「一覧へ戻る」、その下にコピーと形式を `sticky` で固定。閉じると元のカードへフォーカスを戻し、スクロール位置を維持（現行どおり）。 |
| 960〜1199px | 印象語は上、下段に候補＋詳細（20rem） | 詳細は横並び・`sticky`。シートと背景暗幕は出さない。 |
| 1200px〜 | 左に印象語（17rem・sticky）、中央に候補、右に詳細（23rem・sticky） | HTML は変えず、`.page` を grid にして既存の `.controls` と `.workspace` を並べる（下の CSS 断片）。 |

スマホで選択済みかつシートが閉じているときは、右下に小さな丸ボタン「選んだ配色を開く」（高さ 48px、選択中の3色を丸に表示）を置く。画面を覆う固定バーにはしない（要件 6A）。候補見出しの横に「条件を変える ↑」リンクと、条件の要約（`明るい・知的 ／ 一般 ／ 画面（RGB）`）を置く。

## 6. 状態の表現

| 状態 | 形 | 文字 | アイコン | 実装の要点 |
|---|---|---|---|---|
| 選択中（カード・チップ・形式） | 墨の 3px 枠／塗り反転 | 「選択中」 | ✓ | `aria-pressed` を正とし、CSS は属性セレクタで描く |
| ロック中 | 塗り反転（墨地・白字）＋スウォッチ角の錠バッジ | 「ロック」→「ロック中」 | 開いた錠 → 閉じた錠（SVG） | 絵文字 🔒 をやめ、インライン SVG に。`aria-label` は現行どおり |
| 入力エラー（不正HEX） | 行を淡赤面＋入力欄 2px の `--danger` 枠 | `#msg` の文言（state.js のまま） | ⚠ 三角 | 入力に `aria-invalid="true"` と `aria-describedby="msg"` を付ける |
| コピー成功 | ボタンを墨地に反転（1.6 秒） | 「コピーしました」 | ✓ | トースト（`role="status"`）でも知らせる。現行どおり |
| コピー失敗 | 点線枠（手作業の場所） | 「自動コピーできませんでした。下の文を選んでコピーしてください。」 | ⓘ | `#copy-text` を全選択してフォーカス。テキスト欄に二重のフォーカス枠 |
| 印刷向け（参考） | 淡色面＋アクセント枠。赤は使わない | `PRINT_NOTICE` のまま。カードに「印刷向け（参考）」札 | ⓘ | 誤りではなく注意。CMYK 数値は出さない |
| 深掘り中 | `--surface-2` の帯 | 「深掘り中: 選んだ配色に近い系統だけを表示しています。」 | 拡大鏡 | 帯の中に「幅広く探すに戻る」 |
| フォーカス | 2px の地色リング＋3px の `--focus` | — | — | `box-shadow: 0 0 0 2px var(--surface), 0 0 0 5px var(--focus)` または `outline: 3px solid var(--focus)` |

## 7. 用途別プレビューの見本

詳細欄の `#mock` に `data-usage` で切り替える（キャンバス「用途別プレビューの見本」）。すべてに「見本」の札と「見本（用途名）— 仕上がりを保証する表示ではありません」のキャプションを付ける。サンプル文は架空で、固有の情報は `[著者名]` `[日付]` のような角括弧の仮置きにする。

- **一般**: 帯＝サブ、見出し＝メイン、ピル＝差し色。
- **書籍カバー**（縦長）: 上半分＝メインの面、題字＝メイン、帯＝サブ、差し色は帯の小さな丸だけ。
- **チラシ・ポスター**（A判縦）: 大見出し＝メイン、図版の置き場＝サブ、目を引く丸＝差し色1か所。
- **教材・学級通信**（A4縦）: 罫と題字＝メイン、小見出しの下地＝サブ、差し色は記号程度。本文の線が主役。
- **Web・SNS**: バナー（1200×630比）は面＝メイン・文字＝背景色・ボタン＝差し色。Web カードは背景地に見出し＝メイン。

## 8. OGP 画像

`ogp.png`（1200×630）。edi-tool 共通の型（白いカード・左のオレンジ帯・「edi-tool」・アイコン・ツール名・一文・3つの札）に、右側へ配色カードを4枚重ねる。一文は「印象語から配色を見比べて、AIに渡す指示文までコピー」。札の文字は `--accent-ink`（`#9a5200`）。

## 9. 文言

- 平易に。「HEX」は入力欄のラベル内だけで使い、見出しや説明では「色の番号」と言い換えてよい。
- 書かない: 「印刷色を保証」「画像生成AIで同じ色になる」「CMYK対応」。
- 数値・語彙は評価前の仮置き。フッターの「目安」表記を残す。

## 10. 実装メモ（CSS 断片）

既存のクラス名・`id`・`data-*` は**変更しない**（E2E が `#btn-copy` `.card` `.fmt` `.role[data-role] [data-lock]` `#msg` `#copy-fallback` などに依存）。追加は次のとおり。

| 種別 | 名前 | 用途 | 変更箇所 |
|---|---|---|---|
| 追加 id | `#results-summary` | 候補見出し横の条件要約 | index.html・app.js（`renderControls`） |
| 追加 id | `#btn-open-detail` | スマホの「選んだ配色を開く」 | index.html・app.js（`openSheet` を呼ぶだけ） |
| 追加属性 | `[data-hex]` に `aria-invalid`・`aria-describedby="msg"` | エラーの関連付け | app.js（`renderDetail`） |
| 文言 | `.lock` の「🔒 ロック中」→ SVG＋「ロック中」 | 絵文字をやめる | app.js（`renderDetail`） |

```css
:root {
  --bg: #f8f6f2; --surface: #fff; --surface-2: #f1eee8;
  --border: #e0e0e0; --control-border: #8c877e;
  --text: #0f0f0f; --text-sub: #5f5b54;
  --accent: #f28c06; --accent-dark: #d97a00; --accent-soft: #fff8f0;
  --accent-text: #b35f00; --accent-ink: #9a5200; --focus: #9a5200;
  --danger: #c62828; --danger-soft: #fdf0ef; --ok: #2e7d32;
  --on-accent: #1a1100; --inner-line: rgba(15,15,15,.10);
  --radius: 14px; color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1b19; --surface: #26241f; --surface-2: #2f2c26;
    --border: #46423a; --control-border: #8a8476;
    --text: #f3f1ec; --text-sub: #b9b4a8;
    --accent-soft: #33281a; --accent-text: #ffb24d; --accent-ink: #ffb24d; --focus: #ffb24d;
    --danger: #ff8a80; --danger-soft: #3a2120; --ok: #81c784; --inner-line: rgba(255,255,255,.16);
  }
}
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.brand-link, .site-footer a { color: var(--accent-ink); }

/* 選択は墨、オレンジは主操作だけ */
.card { border: 1px solid var(--border); border-radius: var(--radius); }
.card[aria-pressed="true"] { border-color: var(--text); box-shadow: 0 0 0 3px var(--text); }
.card-prev, .card-sw { border: 0; box-shadow: inset 0 0 0 1px var(--inner-line); }
.chip, .fmt, .lock, .btn, input, select, textarea { border-color: var(--control-border); }
.chip[aria-pressed="true"], .lock[aria-pressed="true"] { background: var(--text); color: var(--surface); border-color: var(--text); }
.chip[aria-pressed="true"]::before { content: none; } /* ✓ は SVG かテキストで前置 */
.fmt[aria-pressed="true"] { background: var(--surface-2); border: 2px solid var(--text); }
.btn-primary { background: var(--accent); border-color: var(--accent-dark); color: var(--on-accent); }
.btn-copy { min-height: 52px; font-size: 1.0625rem; font-weight: 800; }
.btn-copy[data-flash] { background: var(--text); border-color: var(--text); color: var(--surface); }
.role:has([aria-invalid="true"]) { border-color: var(--danger); background: var(--danger-soft); }
[data-hex][aria-invalid="true"] { border: 2px solid var(--danger); }
.copy-fallback { border: 2px dashed var(--control-border); border-radius: 12px; padding: 12px; }
.detail.is-open { border-radius: 20px 20px 0 0; }

/* 1200px 以上: 左に印象語、中央に候補、右に詳細（HTML は変えない） */
@media (min-width: 1200px) {
  .page { display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: 0 1.5rem; }
  .site-header, .site-footer, noscript { grid-column: 1 / -1; }
  .controls { position: sticky; top: .5rem; align-self: start; margin: 0; }
  .workspace { grid-template-columns: minmax(0, 1fr) 23rem; }
  .controls .grid-2 { grid-template-columns: 1fr; }
}
```

スマホの丸ボタン（追加分）:

```html
<button type="button" id="btn-open-detail" class="open-detail" hidden>
  <span class="open-detail-sw" aria-hidden="true"></span>選んだ配色を開く
</button>
```

```css
.open-detail { position: fixed; right: 1rem; bottom: 1.25rem; z-index: 30; min-height: 48px;
  display: inline-flex; align-items: center; gap: .5rem; padding: 0 1.1rem 0 .5rem;
  border: 0; border-radius: 999px; background: var(--text); color: var(--surface);
  font: inherit; font-weight: 700; box-shadow: 0 6px 18px rgba(0,0,0,.28); }
.open-detail-sw { width: 32px; height: 32px; border-radius: 50%;
  background: linear-gradient(90deg, var(--p) 0 33%, var(--s) 0 66%, var(--a) 0); box-shadow: inset 0 0 0 2px var(--surface); }
@media (min-width: 960px) { .open-detail { display: none !important; } }
```

## 11. アクセシビリティの受け入れ条件と確認方法

| 条件 | 確認方法 |
|---|---|
| タップ領域 44×44 CSS px 以上 | DevTools で `.chip` `.btn` `.fmt` `.lock` `[data-picker]` `summary` の算出サイズを確認。E2E に `boundingBox()` の検査を足す案あり（tests/ は提案のみ） |
| 通常文字 4.5:1 以上（ライト／ダーク） | 本書 §2 の表（WCAG 2.x の相対輝度式で算出）。実装後は Chrome DevTools の「コントラスト比」、Lighthouse のユーザー補助で両モードを確認（DevTools の Rendering → `prefers-color-scheme: dark`） |
| 非文字 3:1 以上（入力の輪郭・フォーカス） | `--control-border` 3.57:1／4.17:1、`--focus` 5.43:1／8.66:1 |
| 色だけで区別しない | §6 の表。グレースケール表示（Rendering → Emulate vision deficiencies → Achromatopsia）で選択・ロック・エラーが判別できること |
| 文字 200% で横スクロール・欠けなし（320〜1440px） | ブラウザ拡大 200% と、OS 文字サイズ最大（iPhone Safari の「ページの文字サイズ」）で 320/390/1024/1440px を確認。`document.documentElement.scrollWidth <= innerWidth` を E2E で検査する案あり |
| キーボード操作とフォーカスの可視化 | Tab で印象語 → 検索 → 用途 → 出力想定 → 候補 → コピー → 形式 → 役割の順に移動できること。Esc でシートを閉じ元のカードへ戻ること（現行 E2E あり） |
