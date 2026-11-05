// エンジン系テスト共通: 語彙辞書の読み込み（fs 経由）
import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/semantic-model.js';

export const vocab = JSON.parse(readFileSync(new URL('../src/vocab.json', import.meta.url), 'utf8'));
export const index = buildIndex(vocab);
