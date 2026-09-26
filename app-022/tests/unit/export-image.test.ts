import { describe, expect, it } from 'vitest';
import type { Worksheet } from '../../src/types';
import { defaultLayout } from '../../src/lib/layout';
import { pageSvgMarkup, safeBaseName } from '../../src/lib/exportImage';

const PX_MM = 96 / 25.4;
const mm = (v: number) => Math.round(v * PX_MM * 1000) / 1000;

function makeWorksheet(title: string, chars: string[]): Worksheet {
  return {
    id: 'w1',
    title,
    chars,
    layout: defaultLayout,
    pages: 0,
    updatedAt: 0,
  };
}

/** 每个 ASCII 字 7 个小格（例字+描红×2+空白×4），每行 10 格 → 一字一行；20 字 = 2 页 */
const ws2 = makeWorksheet('字帖标题', Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i)));

describe('safeBaseName 文件名清洗', () => {
  it('去掉斜杠冒号等非法字符而不是截断', () => {
    expect(safeBaseName('春/天:字*帖?一"<二>|三')).toBe('春天字帖一二三');
  });

  it('正常标题保留（含空格折叠）', () => {
    expect(safeBaseName('  一年级   上册 ')).toBe('一年级 上册');
  });

  it('清洗后为空或只剩点号时回退字帖', () => {
    expect(safeBaseName('///:::')).toBe('字帖');
    expect(safeBaseName('...')).toBe('字帖');
  });

  it('去掉末尾点号（Windows 会吞掉）', () => {
    expect(safeBaseName('练习..')).toBe('练习');
  });
});

describe('pageSvgMarkup 与预览一致的几何', () => {
  it('矢量导出：width/height 用 mm、viewBox 用 CSS px', () => {
    const svg = pageSvgMarkup(ws2, 0);
    expect(svg).toContain('width="210mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain(`viewBox="0 0 ${mm(210)} ${mm(297)}"`);
  });

  it('行缩放包含 mm→px 系数（默认 20mm 格 → 0.756），不再缩成一小块', () => {
    const svg = pageSvgMarkup(ws2, 0);
    const scale = Math.round((20 / 100) * PX_MM * 1000) / 1000;
    expect(svg).toContain(`scale(${scale})`);
    expect(svg).not.toContain('scale(0.2)');
  });

  it('首行从「上边距+信息带」开始，不压标题', () => {
    const svg = pageSvgMarkup(ws2, 0);
    const rowsTop = mm(8 + 12); // 20mm
    const titleBaseline = mm(8) + 16; // 46.24px
    expect(svg).toContain(`<g transform="translate(${mm(5)} ${rowsTop}) scale(`);
    expect(titleBaseline).toBeLessThan(rowsTop);
  });

  it('页脚写「第 X 页 / 共 N 页」且位于右下', () => {
    expect(pageSvgMarkup(ws2, 0)).toContain('第 1 页 / 共 2 页');
    expect(pageSvgMarkup(ws2, 1)).toContain('第 2 页 / 共 2 页');
    const svg = pageSvgMarkup(ws2, 0);
    expect(svg).toContain(`y="${mm(297 - 8)}" text-anchor="end"`);
  });

  it('标题含 XML 特殊字符时被转义', () => {
    const svg = pageSvgMarkup(makeWorksheet('A<B>&"C', Array(3).fill('A')), 0);
    expect(svg).toContain('A&lt;B&gt;&amp;&quot;C');
  });

  it('PNG 栅格化模式：width/height 为 scale 倍物理像素，viewBox 不变', () => {
    const svg = pageSvgMarkup(ws2, 0, 4);
    expect(svg).toContain(`width="${Math.round(mm(210) * 4)}"`);
    expect(svg).toContain(`height="${Math.round(mm(297) * 4)}"`);
    expect(svg).toContain(`viewBox="0 0 ${mm(210)} ${mm(297)}"`);
  });
});
