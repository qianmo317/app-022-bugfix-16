import { describe, expect, it } from 'vitest';
import type { Worksheet } from '../../src/types';
import { baseName, pageSvgMarkup } from '../../src/lib/exportImage';
import { PAGE, clampLayout, defaultLayout, paginate } from '../../src/lib/layout';
import { strokeCountOf } from '../../src/lib/data';
import { ROW_FACTOR } from '../../src/components/paint';

const PX_MM = 96 / 25.4;

function makeWs(overrides: Partial<Worksheet> = {}): Worksheet {
  return {
    id: 't1',
    title: '测试字帖',
    chars: ['春', '花'],
    layout: { ...defaultLayout },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Worksheet;
}

describe('单页导出 SVG 与预览一致', () => {
  it('行区从页眉之下开始（不压标题）', () => {
    const ws = makeWs();
    const markup = pageSvgMarkup(ws, 0);
    const firstRowY = Number(/<g transform="translate\([\d.]+ ([\d.]+)\)/.exec(markup)?.[1]);
    const headerBottom = (PAGE.marginTMm + PAGE.headerMm) * PX_MM;
    expect(firstRowY).toBeGreaterThanOrEqual(headerBottom - 0.001);
  });

  it('格子的缩放与预览一致（unit→px 含 PX_MM）', () => {
    const ws = makeWs();
    const layout = clampLayout(ws.layout);
    const markup = pageSvgMarkup(ws, 0);
    const scale = Number(/scale\(([\d.]+)\)/.exec(markup)?.[1]);
    expect(scale).toBeCloseTo((layout.cellMm * PX_MM) / 100, 3);
    // 一行实际宽度 ≈ perLine × cellMm（mm），不超过可用纸宽
    const rowWidthMm = layout.perLine * 100 * (scale / PX_MM);
    expect(rowWidthMm).toBeCloseTo(layout.perLine * layout.cellMm, 1);
    expect(rowWidthMm).toBeLessThanOrEqual(PAGE.wMm - PAGE.marginLMm - PAGE.marginRMm + 0.01);
  });

  it('页脚包含当前页与总页数', () => {
    // 足够多的字 → 多页
    const chars = Array.from({ length: 60 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    const ws = makeWs({ chars });
    const layout = clampLayout(ws.layout);
    const pages = paginate(ws.chars, layout, strokeCountOf);
    expect(pages.length).toBeGreaterThan(1);
    const markup = pageSvgMarkup(ws, 0);
    expect(markup).toContain(`第 1 页 / 共 ${pages.length} 页`);
  });

  it('行间距与行高换算正确（行不重叠、不出纸面）', () => {
    const ws = makeWs({ chars: Array.from({ length: 60 }, (_, i) => String.fromCodePoint(0x4e00 + i)) });
    const layout = clampLayout(ws.layout);
    const markup = pageSvgMarkup(ws, 0);
    const ys = [...markup.matchAll(/<g transform="translate\([\d.]+ ([\d.]+)\)/g)].map((m) => Number(m[1]));
    const pitch = (layout.cellMm * ROW_FACTOR + layout.lineGapMm) * PX_MM;
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeCloseTo(pitch, 1);
    }
    const lastBottom = ys[ys.length - 1] + layout.cellMm * ROW_FACTOR * PX_MM;
    expect(lastBottom).toBeLessThanOrEqual((PAGE.hMm - PAGE.marginBMm) * PX_MM + 0.01);
  });

  it('标题中的 XML 特殊字符被转义', () => {
    const ws = makeWs({ title: 'a<b&"c"' });
    const markup = pageSvgMarkup(ws, 0);
    expect(markup).toContain('a&lt;b&amp;&quot;c&quot;');
    expect(markup).not.toContain('a<b');
  });
});

describe('导出文件名安全化', () => {
  it('斜杠/冒号等保留字替换为全角，不截断', () => {
    const ws = makeWs({ title: '语文/数学:练习' });
    expect(baseName(ws)).toBe('语文／数学：练习');
  });

  it('Windows 保留字全部替换', () => {
    const ws = makeWs({ title: 'a/b\\c:d*e?f"g<h>i|j' });
    expect(baseName(ws)).toBe('a／b＼c：d＊e？f＂g＜h＞i｜j');
  });

  it('空标题或全是非法字符时回退「字帖」', () => {
    expect(baseName(makeWs({ title: '' }))).toBe('字帖');
    expect(baseName(makeWs({ title: '???' }))).not.toBe('');
  });

  it('去掉结尾的点和空格（Windows 限制）', () => {
    expect(baseName(makeWs({ title: '练习. ' }))).toBe('练习');
  });
});
