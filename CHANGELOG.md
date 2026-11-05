# Changelog

このプロジェクトの主な変更を記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

## [0.1.0] - 2026-11-05

試作版（RGB MVP）。語彙・数値は評価前。CMYK数値は未提供。

### Added
- RGB MVP: 印象語（30語・最大3つ）から方向性を分散した24案、追加探索、「この系統を深掘り」
- 5役割（メイン・サブ・差し色・背景・文字）の編集、ロック、ロック以外の再提案、Undo
- AI向けコピー（かんたん／くわしく／HEXのみ／CSS／JSON）、用途5区分
- 文字と背景のコントラスト（WCAG 4.5:1）警告
- URLフラグメントでの状態復帰
- 印刷向けモードの表示（CMYK数値は未提供）
- E2E（Playwright、`tests/e2e/`）と単体テスト（`node:test`）
