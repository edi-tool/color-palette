const { test, expect } = require('@playwright/test');

const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];
const roleHex = (page, role) => page.locator(`.role[data-role="${role}"] [data-hex]`);

async function pickMood(page, mood = '明るい') {
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`pageerror: ${e}`));
  page.on('requestfailed', (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) log.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto('/index.html');
  try {
    await page.locator('#mood-chips .chip').first().waitFor({ timeout: 8000 });
  } catch (e) {
    throw new Error(`印象語チップが出ません。診断: ${JSON.stringify(log)} / empty=${await page.locator('#empty').textContent()}`);
  }
  await page.locator(`[data-mood="${mood}"]`).click();
  await expect(page.locator('.card')).toHaveCount(24);
}
const isSheet = (page) => page.evaluate(() => !window.matchMedia('(min-width: 960px)').matches);

// --- 代表幅: 24案・横スクロール無し・列数・タップ領域 ---
for (const width of WIDTHS) {
  test(`幅${width}px: 24案、横スクロール無し、列数、主要操作のタップ領域`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await pickMood(page);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      cols: getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    // スマホは 389px 以下で2列、390〜599px（幅の広いスマホ）で3列、それ以上の PC 未満は2〜3列
    if (width < 390) expect(m.cols).toBe(2);
    else if (width < 600) expect(m.cols).toBe(3);
    else if (width < 768) expect(m.cols).toBeLessThanOrEqual(3);
    if (width >= 1024) expect(m.cols).toBeGreaterThanOrEqual(3);
    expect(m.cols).toBeLessThanOrEqual(5);

    // 主要ボタン（チップ・用途・再生成・もっと見る・先頭カード）が 44px 以上
    for (const sel of ['.chip >> nth=0', '#usage', '#btn-regenerate', '#btn-more', '.card >> nth=0']) {
      const box = await page.locator(sel).boundingBox();
      expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(43.5);
      expect(box.width, `${sel} width`).toBeGreaterThanOrEqual(43.5);
    }
    if (width < 960) {
      await page.locator('.card').first().click();
      for (const sel of ['#btn-copy', '#btn-close', '.lock >> nth=0', '[data-hex] >> nth=0', '[data-picker] >> nth=0', '.fmt >> nth=0']) {
        const box = await page.locator(sel).boundingBox();
        expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(43.5);
        expect(box.width, `${sel} width`).toBeGreaterThanOrEqual(43.5);
      }
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sw).toBeLessThanOrEqual(0);
    }
  });
}

test('文字200%拡大でも横スクロールが出ず、コピー操作に届く（390px）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await pickMood(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.locator('.card').first().click();
  await expect(page.locator('#btn-copy')).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});

// --- 方向性の幅 ---
test('初期24案に暖色系・寒色/緑系・無彩色＋差し色の系統が含まれ、系統ラベルが見える', async ({ page }) => {
  await pickMood(page);
  const labels = await page.locator('.card-label').allTextContents();
  for (const t of ['暖色系', '寒色・緑系', '無彩色＋差し色']) expect(labels.some((l) => l.startsWith(t)), t).toBe(true);
});

test('複数語（明るい＋知的）でも24案', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('[data-mood="明るい"]').click();
  await page.locator('[data-mood="知的"]').click();
  await expect(page.locator('.card')).toHaveCount(24);
  await expect(page.locator('#mood-summary')).toContainText('明るい、知的');
});

test('印象語を足すと、カードの系統ラベルも新しい候補に合わせて変わる', async ({ page }) => {
  await pickMood(page);
  await page.locator('[data-mood="知的"]').click();
  // 古いカードの使い回しでラベルが残らないことを、URL の seed から作り直した候補と比べて確かめる
  const expected = await page.evaluate(async () => {
    const seed = Number(new URLSearchParams(location.hash.slice(1)).get('s'));
    const { buildIndex } = await import('/src/semantic-model.js');
    const { generateWide } = await import('/src/palette-engine.js');
    const index = buildIndex(await (await fetch('/src/vocab.json')).json());
    return generateWide({ index, moods: ['明るい', '知的'], seed, page: 0, count: 24 }).map((c) => c.label);
  });
  await expect(page.locator('.card-label')).toHaveText(expected);
});

test('色覚の見え方は操作の下のたたんだ補助欄にあり、切り替えても見本・HEX・コピー内容は変わらない', async ({ page }) => {
  await pickMood(page);
  await page.locator('.card').first().click();
  // 補助欄は既定で閉じていて、ロック・再提案より下にある
  await expect(page.locator('#vision-box')).not.toHaveAttribute('open', '');
  const y = async (sel) => (await page.locator(sel).boundingBox()).y;
  expect(await y('#vision-box')).toBeGreaterThan(await y('#btn-repropose'));
  const hex0 = await roleHex(page, 'primary').inputValue();
  const copy0 = await page.locator('#export-preview').textContent();
  const mock0 = await page.locator('#mock').getAttribute('style');
  const strip0 = await page.locator('#vision-strip').innerHTML();
  await page.locator('#vision-summary').click();
  await page.locator('[data-vision="deutan"]').click();
  await expect(page.locator('[data-vision="deutan"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#vision')).toContainText('D型（2型）のシミュレーション');
  expect(await page.locator('#vision-strip').innerHTML()).not.toBe(strip0);
  expect(await page.locator('#mock').getAttribute('style')).toBe(mock0);
  await expect(roleHex(page, 'primary')).toHaveValue(hex0);
  await expect(page.locator('#export-preview')).toHaveText(copy0);
});

test('同じ印象語を押し直すと、別の候補が並ぶ（seed は URL に残る）', async ({ page }) => {
  await pickMood(page);
  const seedOf = () => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('s'));
  const first = await page.locator('.card').first().getAttribute('aria-label');
  const s1 = await seedOf();
  await page.locator('[data-mood="明るい"]').click(); // 解除
  await page.locator('[data-mood="明るい"]').click(); // もう一度
  await expect(page.locator('.card')).toHaveCount(24);
  expect(await seedOf()).not.toBe(s1);
  expect(await page.locator('.card').first().getAttribute('aria-label')).not.toBe(first);
});

test('印象語・色の系統のボタンは同じ大きさにそろい、色の系統を選ぶと URL に残る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pickMood(page);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#mood-chips .chip, #hue-chips .chip')]
    .map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }));
  expect(new Set(sizes).size).toBe(1);
  await page.locator('[data-hue="green"]').click();
  await expect(page.locator('[data-hue="green"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('h'))).toBe('green');
  await expect(page.locator('.card').first()).toBeVisible();
});

test('印象語は3つまで（4つ目は選べない）', async ({ page }) => {
  await page.goto('/index.html');
  for (const m of ['明るい', '知的', '和風']) await page.locator(`[data-mood="${m}"]`).click();
  await expect(page.locator('[data-mood="シック"]')).toBeDisabled();
});

test('追加の24案: 先の候補は消えずに48案になる', async ({ page }) => {
  await pickMood(page);
  const first = await page.locator('.card').evaluateAll((els) => els.map((e) => e.dataset.id));
  await page.locator('#btn-more').click();
  await expect(page.locator('.card')).not.toHaveCount(24);
  await expect.poll(() => page.locator('.card').count()).toBeGreaterThan(40);
  const after = await page.locator('.card').evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(after.slice(0, 24)).toEqual(first);
  expect(new Set(after).size).toBe(after.length);
});

test('未知語は理解したふりをせず、近い候補を示す', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#mood-search').fill('シックな');
  await expect(page.locator('#search-result')).toContainText('辞書にない言葉です');
  await expect(page.locator('#search-result [data-add-mood="シック"]')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
});

// --- スマホ: 選択→編集→AI用コピー→一覧へ戻る ---
test.describe('スマホ(390px)の一連の操作', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('選択→編集→ロック→コピー→閉じる。スクロール位置と選択状態を保つ', async ({ page }) => {
    await pickMood(page);
    await page.evaluate(() => window.scrollTo(0, 1300));
    const y0 = await page.evaluate(() => scrollY);
    const card = page.locator('.card').filter({ has: page.locator('.card-label') }).nth(6);
    await card.scrollIntoViewIfNeeded();
    const y1 = await page.evaluate(() => scrollY);
    await card.click();
    await expect(page.locator('#detail')).toHaveClass(/is-open/);

    await roleHex(page, 'secondary').fill('#123456');
    await roleHex(page, 'secondary').press('Enter');
    await page.locator('.role[data-role="primary"] [data-lock]').click();
    const primary = await roleHex(page, 'primary').inputValue();

    await page.locator('#btn-copy').click();
    await expect(page.locator('#btn-copy')).toContainText('コピーしました');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('#123456');
    expect(clip).toContain(primary);
    expect(clip).toMatch(/正本/);

    await page.locator('#btn-close').click();
    await expect(page.locator('#detail')).not.toHaveClass(/is-open/);
    expect(await page.evaluate(() => scrollY)).toBe(y1);
    expect(y1).toBeGreaterThan(0);
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    // 一覧上のカードにも編集後の色が反映されている
    await expect(card).toHaveAttribute('aria-label', /サブ#123456/);
    expect(y0).toBe(1300);
  });

  test('Escape でシートを閉じる', async ({ page }) => {
    await pickMood(page);
    await page.locator('.card').first().click();
    await expect(page.locator('#detail')).toHaveClass(/is-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail')).not.toHaveClass(/is-open/);
  });

  test('シート表示中は背後が操作対象外（inert）、閉じると戻る', async ({ page }) => {
    await pickMood(page);
    await page.locator('.card').first().click();
    await expect(page.locator('#detail')).toHaveAttribute('role', 'dialog');
    expect(await page.evaluate(() => ['.controls', '.results'].map((s) => document.querySelector(s).inert))).toEqual([true, true]);
    await page.locator('#btn-close').click();
    expect(await page.evaluate(() => document.querySelector('.results').inert)).toBe(false);
    await expect(page.locator('.card').first()).toBeFocused();
  });

  test('Clipboard が使えないとき、選択可能な欄に同じ文を出す', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    });
    await pickMood(page);
    await page.locator('.card').first().click();
    await page.locator('#btn-copy').click();
    await expect(page.locator('#copy-fallback')).toBeVisible();
    const text = await page.locator('#copy-text').inputValue();
    expect(text).toBe(await page.locator('#export-preview').textContent());
  });
});

// --- 編集・ロック ---
test('不正なHEXは破棄してエラーを出し、直前の値を保つ', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('.card').first().click();
  const before = await roleHex(page, 'accent').inputValue();
  await roleHex(page, 'accent').fill('zzz');
  await roleHex(page, 'accent').press('Enter');
  await expect(page.locator('#msg')).toContainText('HEXとして読めません');
  await expect(roleHex(page, 'accent')).toHaveValue(before);
});

test('メインをロックして何度再提案しても、メインのHEXは変わらない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('.card').first().click();
  await page.locator('.role[data-role="primary"] [data-lock]').click();
  const primary = await roleHex(page, 'primary').inputValue();
  const others = async () => [await roleHex(page, 'secondary').inputValue(), await roleHex(page, 'accent').inputValue()].join();
  const o0 = await others();
  let changed = false;
  for (let i = 0; i < 5; i++) {
    await page.locator('#btn-repropose').click();
    expect(await roleHex(page, 'primary').inputValue()).toBe(primary);
    if ((await others()) !== o0) changed = true;
  }
  expect(changed).toBe(true);
});

test('サブだけ変えても他の役割は変わらず、Undo・元に戻すが使える', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('.card').first().click();
  const read = async () => Promise.all(['primary', 'secondary', 'accent', 'background', 'text'].map((r) => roleHex(page, r).inputValue()));
  const before = await read();
  await roleHex(page, 'secondary').fill('#0F0F0F');
  await roleHex(page, 'secondary').press('Enter');
  const after = await read();
  expect(after.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1));
  expect(after[1]).toBe('#0F0F0F');
  await page.locator('#btn-undo').click();
  expect(await read()).toEqual(before);
});

test('コントラスト不足なら警告し、提案ボタンで直せる（強制変更はしない）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('.card').first().click();
  await roleHex(page, 'text').fill('#E0E0E0');
  await roleHex(page, 'text').press('Enter');
  await roleHex(page, 'background').fill('#F0F0F0');
  await roleHex(page, 'background').press('Enter');
  await expect(page.locator('#contrast')).toContainText('届きません');
  await expect(roleHex(page, 'text')).toHaveValue('#E0E0E0'); // 勝手に変えない
  await page.locator('#contrast .fix').click();
  await expect(page.locator('#contrast')).not.toContainText('届きません');
});

test('深掘り→幅広くに戻る', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('.card').nth(3).click();
  await page.locator('#btn-deep').click();
  await expect(page.locator('#deep-banner')).toBeVisible();
  await expect(page.locator('.card').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#btn-wide').click();
  await expect(page.locator('#deep-banner')).toBeHidden();
  await expect(page.locator('.card')).toHaveCount(24);
});

// --- コピー形式・用途・モード ---
test('5形式すべてで最新のHEXをコピーでき、用途で文面が変わる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('.card').first().click();
  await roleHex(page, 'accent').fill('#ABCDEF');
  await roleHex(page, 'accent').press('Enter');
  for (const label of ['かんたん', 'くわしく', 'HEXのみ', 'CSS', 'JSON']) {
    await page.locator('.fmt', { hasText: label }).click();
    await page.locator('#btn-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText()), label).toContain('#ABCDEF');
  }
  await page.locator('.fmt', { hasText: 'かんたん' }).click();
  await page.selectOption('#usage', 'book-cover');
  expect(await page.locator('#export-preview').textContent()).toContain('書籍のカバー');
  await page.selectOption('#usage', 'flyer');
  expect(await page.locator('#export-preview').textContent()).toContain('チラシ');
});

test('印刷向けモード: 注意表示があり、コピー文にCMYK数値が無く「未提供」と書く', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('input[name="mode"][value="print"]').check();
  await expect(page.locator('#print-notice')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(24);
  await page.locator('.card').first().click();
  await page.locator('.fmt', { hasText: 'くわしく' }).click();
  const text = await page.locator('#export-preview').textContent();
  expect(text).toContain('CMYK数値は未提供');
  expect(text).not.toMatch(/cmyk\(|\bC\s*\d+\s*M\s*\d+/i);
});

// --- URL 復帰・プライバシー ---
test('リロードしても選択した配色と編集内容が復帰する', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pickMood(page);
  await page.locator('.card').nth(2).click();
  await roleHex(page, 'secondary').fill('#13579B');
  await roleHex(page, 'secondary').press('Enter');
  await page.locator('.role[data-role="accent"] [data-lock]').click();
  const ids = await page.locator('.card').evaluateAll((els) => els.map((e) => e.dataset.id));
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(24);
  expect(await page.locator('.card').evaluateAll((els) => els.map((e) => e.dataset.id))).toEqual(ids);
  await page.locator('.card[aria-pressed="true"]').click();
  await expect(roleHex(page, 'secondary')).toHaveValue('#13579B');
  await expect(page.locator('.role[data-role="accent"] [data-lock]')).toHaveAttribute('aria-pressed', 'true');
});

test('外部へのリクエストが無い（同一オリジンのみ）', async ({ page }) => {
  const external = [];
  page.on('request', (r) => { if (!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url())) external.push(r.url()); });
  await pickMood(page);
  await page.locator('.card').first().click();
  await page.locator('#btn-copy').click();
  expect(external).toEqual([]);
});

test('コンソールエラーが出ない', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await pickMood(page);
  await page.locator('.card').first().click();
  expect(errors).toEqual([]);
});

test('ダークモードでも操作できる', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await pickMood(page);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 11, 12)');
});

test('キーボードだけで印象語を選び、候補を選択できる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/index.html');
  await page.locator('[data-mood="明るい"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.locator('.card').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.card').first()).toHaveAttribute('aria-pressed', 'true');
});
