// コピー用テキストの生成。固定テンプレート＋現在の色データから、ローカルで決定的に作る（外部LLM不使用）。
// 必ず「コピー直前の最新の state」から呼ぶこと。キャッシュしない。
//
// 注意: 画像生成AIの色再現は保証されない。印刷結果も保証しない（本文にも注記する）。
// CMYK 数値は ICC 変換が実装されるまで出力しない（mode='print' でも HEX のみ）。

import { ROLES, contrastRatio, AA_NORMAL } from './color-utils.js';
import { visionIssues, VISION_TYPES } from './vision.js';

export const SCHEMA_VERSION = 1;

export const ROLE_LABEL = { primary: 'メイン', secondary: 'サブ', accent: '差し色', background: '背景', text: '文字' };
export const ROLE_KEY = { primary: 'primary', secondary: 'secondary', accent: 'accent', background: 'background', text: 'text' };

export const USAGES = {
  general: {
    label: '一般', task: 'デザイン',
    use: { primary: '主要な見出し・目立たせたい面', secondary: '補助的な図形・小見出し', accent: '重要箇所のワンポイント（少量）', background: '全体の地色', text: '本文' },
    ratio: '背景 約60% / メイン 約20% / サブ 約10% / 文字 約5% / 差し色 約5%',
  },
  'book-cover': {
    label: '書籍カバー', task: '書籍のカバー（表紙）デザイン',
    use: { primary: 'タイトル・主要な帯や面', secondary: 'サブタイトル・図形・装飾', accent: '帯のキャッチ・小さな強調（少量）', background: 'カバーの地色', text: '著者名・補足の文字' },
    ratio: '背景 約55% / メイン 約25% / サブ 約10% / 文字 約5% / 差し色 約5%',
  },
  flyer: {
    label: 'チラシ・ポスター', task: 'チラシ（ポスター）',
    use: { primary: 'タイトル・主要見出し', secondary: '補助情報・図形', accent: '重要箇所・申込み案内（少量）', background: '地色', text: '本文' },
    ratio: '背景 約60% / メイン 約20% / サブ 約10% / 文字 約5% / 差し色 約5%',
  },
  'teaching-material': {
    label: '教材・学級通信', task: '教材・学級通信のレイアウト',
    use: { primary: '見出し・枠線', secondary: '囲み・補助の図', accent: '注意・重要語の強調（少量）', background: '紙面の地色（淡く）', text: '本文（読みやすさ最優先）' },
    ratio: '背景 約65% / メイン 約15% / サブ 約10% / 文字 約5% / 差し色 約5%',
  },
  web: {
    label: 'Web・SNS', task: 'Webサイト・SNS用バナーなど、画面で見せるデザイン',
    use: { primary: 'ヘッダー・キャッチコピー・主要ボタン', secondary: 'セクション背景・装飾・補助要素', accent: 'ボタン風の要素・通知・強調（少量）', background: 'ページ／バナーの地色', text: '本文・説明文' },
    ratio: '背景 約60% / メイン 約15% / サブ 約15% / 差し色 約5% / 文字 約5%',
  },
};

export const FORMATS = {
  simple: 'かんたん',
  detailed: 'くわしく',
  codes: 'HEXのみ',
  css: 'CSS',
  json: 'JSON',
};

const NOTE_NO_GUARANTEE = '※ 画像生成AIなどでは、指定したHEXどおりの色にならない場合があります。実際の制作ソフトでの色指定とは異なる点に注意してください。';

function usageOf(state) {
  return USAGES[state.usage] ?? USAGES.general;
}

function moodText(state) {
  return state.moods?.length ? state.moods.join('、') : '指定なし';
}

function modeLine(state) {
  return state.mode === 'print'
    ? '想定: 印刷向け（参考）。CMYK数値は未提供のため、HEX（sRGB）を基準にしてください。印刷色は用紙・インキ・プロファイルで変わります。'
    : '想定: 画面表示（RGB / sRGB）';
}

export function contrastNote(colors) {
  const ratio = contrastRatio(colors.text, colors.background);
  return { ratio, ok: ratio >= AA_NORMAL };
}

/** 色覚の多様性の注意文（問題が無ければ null）。見え方を保証しない目安の表現にする。 */
export function visionNote(colors) {
  const issues = visionIssues(colors);
  if (!issues.length) return null;
  const types = issues.map((i) => VISION_TYPES[i.type].label).join('・');
  const pairs = [...new Set(issues.flatMap((i) => i.pairs.map(([a, b]) => `${ROLE_LABEL[a]}と${ROLE_LABEL[b]}`)))].join('、');
  return { types, pairs, text: `${types}の色覚では、${pairs}が見分けにくい可能性があります（シミュレーションによる目安）` };
}

function colorLines(state, withUse) {
  const u = usageOf(state);
  return ROLES.map((r) => `- ${ROLE_LABEL[r]}: ${state.colors[r]}${withUse ? `（${u.use[r]}）` : ''}`).join('\n');
}

export function formatSimple(state) {
  const u = usageOf(state);
  const c = contrastNote(state.colors);
  const lines = [
    `以下の配色を使って、${u.task}を制作してください。`,
    `印象: ${moodText(state)}。`,
    modeLine(state),
    '色指定:',
    colorLines(state, true),
    `面積比の目安: ${u.ratio}`,
    '注意: 上記のHEXを色指定の正本として扱い、印象語から配色を再解釈・変更しないでください。差し色は多用しないでください。',
  ];
  if (!c.ok) lines.push(`可読性: 文字と背景のコントラスト比は ${c.ratio.toFixed(1)}:1 です（目安 4.5:1 以上）。小さな文字は避けるか、太さ・大きさで補ってください。`);
  lines.push(NOTE_NO_GUARANTEE);
  return lines.join('\n');
}

export function formatDetailed(state) {
  const u = usageOf(state);
  const c = contrastNote(state.colors);
  const out = [
    `【依頼】以下の配色を使って、${u.task}を制作してください。`,
    '',
    '■ 印象',
    `${moodText(state)}。この印象を、下記の色で表現してください。`,
    '',
    '■ 色指定（この HEX を正本とします）',
    colorLines(state, true),
    '',
    '■ 面積比・強弱',
    `${u.ratio}`,
    '背景を最も広く使い、メインで全体の軸をつくり、サブで補助し、差し色は目的のある少数の箇所に限定してください。',
    '',
    '■ 背景・文字の扱い',
    `- 背景は ${state.colors.background}、本文・見出し以外の小さな文字は ${state.colors.text} を基本にしてください。`,
    `- 文字と背景のコントラスト比: ${c.ratio.toFixed(1)}:1（${c.ok ? '目安の 4.5:1 以上を満たしています' : '目安の 4.5:1 に届きません。小さな文字を避け、太さ・大きさで補ってください'}）。`,
    '- 明るい色の上に明るい色の文字を重ねないでください。',
    ...visionLines(state.colors),
    '',
    '■ 守ってほしいこと',
    '- 指定したHEXを優先し、印象語（形容詞）だけから別の配色に置き換えないでください。',
    '- 指定した5色以外の色を大きな面積で足さないでください（写真・イラスト内の色は除く）。',
    '- 差し色を多用しないでください。',
    '',
    '■ 出力条件',
    modeLine(state),
    '',
    NOTE_NO_GUARANTEE,
  ];
  return out.join('\n');
}

function visionLines(colors) {
  const v = visionNote(colors);
  if (!v) return [];
  return [`- ${v.text}。色だけで区別させず、形・太さ・位置・文字でも区別できるようにしてください。`];
}

export function formatCodes(state) {
  return ROLES.map((r) => `${ROLE_LABEL[r]}（${r}）: ${state.colors[r]}`).join('\n');
}

export function formatCss(state) {
  return `:root {\n${ROLES.map((r) => `  --color-${r}: ${state.colors[r]};`).join('\n')}\n}`;
}

export function formatJson(state) {
  const c = contrastNote(state.colors);
  const obj = {
    schemaVersion: SCHEMA_VERSION,
    moods: state.moods ?? [],
    usage: state.usage,
    mode: state.mode,
    seed: state.seed,
    colors: Object.fromEntries(ROLES.map((r) => [r, state.colors[r]])),
    locks: state.locks ?? [],
    contrast: { textOnBackground: Math.round(c.ratio * 100) / 100, passesAA: c.ok },
    visionSimulation: visionIssues(state.colors).map((i) => ({ type: i.type, hardToDistinguish: i.pairs })),
  };
  if (state.mode === 'print') obj.print = { cmyk: null, status: 'not-provided', reason: 'ICC変換が未実装のためCMYK数値は提供しません' };
  return JSON.stringify(obj, null, 2);
}

const FORMATTERS = { simple: formatSimple, detailed: formatDetailed, codes: formatCodes, css: formatCss, json: formatJson };

export function formatFor(format, state) {
  const f = FORMATTERS[format];
  if (!f) throw new Error(`未知の形式: ${format}`);
  return f(state);
}
