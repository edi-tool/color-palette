// エンジン系テスト共通: 語彙辞書の読み込み（fs 経由）
import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/semantic-model.js';

export const vocab = JSON.parse(readFileSync(new URL('../src/vocab.json', import.meta.url), 'utf8'));
export const seedData = JSON.parse(readFileSync(new URL('../src/seeds.json', import.meta.url), 'utf8'));
export const index = buildIndex(vocab, seedData);
// シード配色を使わない（手続き的な生成だけの）インデックス。生成ロジック自体のテスト用
export const proceduralIndex = buildIndex(vocab);
