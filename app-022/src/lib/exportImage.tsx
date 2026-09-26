/**
 * 单页导出：SVG（矢量）与 PNG（4x 位图）。
 * 与预览/打印共用 RowContent 渲染，所见即所得。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { Worksheet } from '../types';
import { PAGE, clampLayout, paginate } from './layout';
import { RowContent, ROW_FACTOR } from '../components/paint';
import { pinyinResolver } from '../components/PageView';
import { strokeCountOf } from './data';

const PX_MM = 96 / 25.4; // 1mm = 3.7795px（CSS 参考）
/** 手工拼 SVG 属性用的字体串（不能带引号，否则破坏 XML 属性） */
const FONT_ATTR = 'Noto Sans SC,PingFang SC,Microsoft YaHei,sans-serif';

function mm(v: number): number {
  return Math.round(v * PX_MM * 1000) / 1000;
}

/** 像素坐标同样保留 3 位小数，避免浮点噪声写进标记 */
function px(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 组合单页 SVG 标记（width/height 用 mm，viewBox 用 px） */
export function pageSvgMarkup(worksheet: Worksheet, pageIndex: number): string {
  const layout = clampLayout(worksheet.layout);
  const pages = paginate(worksheet.chars, layout, strokeCountOf);
  const pi = pageIndex;
  const rows = pages[pi] ?? [];
  const pinyinFor = pinyinResolver(worksheet);

  const mL = mm(PAGE.marginLMm);
  const mR = mm(PAGE.wMm - PAGE.marginRMm);
  const headerTop = mm(PAGE.marginTMm);
  // 与预览一致：行区从「上边距 + 页眉高」之后开始
  const rowsTop = mm(PAGE.marginTMm + PAGE.headerMm);
  const rowHeight = mm(layout.cellMm * ROW_FACTOR);
  const gap = mm(layout.lineGapMm);
  // unit（格=100）→ px：1 unit = cellMm/100 mm = cellMm/100 × PX_MM px
  const scale = mm(layout.cellMm) / 100;

  const parts: string[] = [];
  parts.push(
    `<text x="${mL}" y="${px(headerTop + 16)}" font-family="${FONT_ATTR}" font-size="16" font-weight="700" fill="#1f2328">${
      escapeXml(worksheet.title)
    }</text>`,
  );
  let y = rowsTop;
  for (const row of rows) {
    const inner = renderToStaticMarkup(
      <RowContent row={row} layout={layout} pinyinFor={pinyinFor} />,
    );
    parts.push(`<g transform="translate(${mL} ${px(y)}) scale(${scale})">${inner}</g>`);
    y += rowHeight + gap;
  }
  // 页脚与预览一致：右对齐「第 X 页 / 共 Y 页」，位于最后一行之下
  const footerY = rows.length > 0 ? y - gap + mm(2) + 10 : rowsTop + mm(2) + 10;
  parts.push(
    `<text x="${mR}" y="${px(footerY)}" text-anchor="end" font-family="${FONT_ATTR}" font-size="10" fill="#9ca3af">第 ${pi + 1} 页 / 共 ${pages.length} 页</text>`,
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.wMm}mm" height="${PAGE.hMm}mm" ` +
    `viewBox="0 0 ${mm(PAGE.wMm)} ${mm(PAGE.hMm)}">` +
    `<rect x="0" y="0" width="${mm(PAGE.wMm)}" height="${mm(PAGE.hMm)}" fill="#ffffff"/>` +
    parts.join('') +
    `</svg>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string,
  );
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // 延迟回收：同步 revoke 会打断尚未开始的下载，产生空文件
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 文件系统保留字 → 全角，避免文件名被截断或保存失败 */
const INVALID_FILENAME_CHARS: Record<string, string> = {
  '/': '／',
  '\\': '＼',
  ':': '：',
  '*': '＊',
  '?': '？',
  '"': '＂',
  '<': '＜',
  '>': '＞',
  '|': '｜',
};

/** 标题 → 安全文件名主体：替换保留字符、去控制字符、限长，空则回退「字帖」 */
export function baseName(worksheet: Worksheet): string {
  const cleaned = (worksheet.title || '')
    .replace(/[/\\:*?"<>|]/g, (c) => INVALID_FILENAME_CHARS[c])
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .trim()
    .replace(/[. ]+$/, '') // Windows 不允许以点/空格结尾
    .slice(0, 50);
  return cleaned || '字帖';
}

/** 导出单页 SVG */
export function exportSvg(worksheet: Worksheet, pageIndex: number): void {
  const markup = pageSvgMarkup(worksheet, pageIndex);
  download(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), `${baseName(worksheet)}-第${pageIndex + 1}页.svg`);
}

/** 导出单页 PNG（scale 倍率，默认 4） */
export function exportPng(worksheet: Worksheet, pageIndex: number, scale = 4): Promise<void> {
  return new Promise((resolve, reject) => {
    const markup = pageSvgMarkup(worksheet, pageIndex);
    const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onerror = () => reject(new Error('PNG 导出失败：SVG 渲染错误'));
    img.onload = () => {
      // 位图尺寸 = 页面 px × 倍率（4x ≈ 384dpi，打印不糊）
      const w = Math.round(mm(PAGE.wMm) * scale);
      const h = Math.round(mm(PAGE.hMm) * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建画布'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG 编码失败'));
          return;
        }
        download(blob, `${baseName(worksheet)}-第${pageIndex + 1}页.png`);
        resolve();
      }, 'image/png');
    };
    img.src = svgUrl;
  });
}
