// 印刷プロファイル（ICC）変換。Step 3 で実装するまで「未提供」を返す。
// 一般式による裸の CMYK 近似値は、印刷用の値として誤解されるため出さない。

export function rgbToCmyk() {
  return { ok: false, reason: 'ICC変換は未実装のため、CMYK数値は提供していません。' };
}

export const PRINT_NOTICE = '印刷向け配色（参考）です。CMYK数値は未提供です。印刷色は用紙・インキ・ICCプロファイルで変わるため、実際の入稿前に校正刷りで確認してください。';
