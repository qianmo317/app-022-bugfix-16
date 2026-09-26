/**
 * 单页导出：SVG（矢量）与 PNG（4x 位图）。
 * 与预览/打印共用 RowContent 渲染，坐标几何与 PageView 保持一致，所见即所得。
 *
 * 坐标系：viewBox 用 CSS px（1mm = 96/25.4 px）；
 * RowContent 的 1 unit = cellMm/100 mm，套到行组上时需乘 mm→px 系数。
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

/**
 * 组合单页 SVG 标记。
 * viewBox 恒为 CSS px 尺寸；rasterScale=1 时 width/height 用 mm（矢量导出/打印），
 * rasterScale>1 时用对应物理像素（PNG 离屏栅格化，保证 1:1 清晰）。
 */
export function pageSvgMarkup(worksheet: Worksheet, pageIndex: number, rasterScale = 1): string {
  const layout = clampLayout(worksheet.layout);
  const pages = paginate(worksheet.chars, layout, strokeCountOf);
  const pi = pageIndex;
  const rows = pages[pi] ?? [];
  const pinyinFor = pinyinResolver(worksheet);

  const pageW = mm(PAGE.wMm);
  const pageH = mm(PAGE.hMm);
  const xLeft = mm(PAGE.marginLMm);
  const xRight = mm(PAGE.wMm - PAGE.marginRMm);

  // 标题在上边距内（与预览 .sheet-title 的 16px 字号对齐）
  const titleBaseline = mm(PAGE.marginTMm) + 16;
  // 格子从「上边距 + 信息带」开始，不能压标题（与预览 padding/header 布局一致）
  const rowsTop = mm(PAGE.marginTMm + PAGE.headerMm);
  const rowHeight = mm(layout.cellMm * ROW_FACTOR);
  const gap = mm(layout.lineGapMm);
  // 1 unit = cellMm/100 mm → 换算成 SVG 用户坐标（CSS px）
  const scale = Math.round((layout.cellMm / 100) * PX_MM * 1000) / 1000;

  const parts: string[] = [];
  parts.push(
    `<text x="${xLeft}" y="${titleBaseline}" font-family="${FONT_ATTR}" font-size="16" font-weight="700" fill="#222">${
      escapeXml(worksheet.title)
    }</text>`,
  );
  let y = rowsTop;
  for (const row of rows) {
    const inner = renderToStaticMarkup(
      <RowContent row={row} layout={layout} pinyinFor={pinyinFor} />,
    );
    parts.push(`<g transform="translate(${xLeft} ${y}) scale(${scale})">${inner}</g>`);
    y += rowHeight + gap;
  }

  // 页脚：与预览一致，右下角「第 X 页 / 共 N 页」
  const footerBaseline = mm(PAGE.hMm - PAGE.marginBMm);
  parts.push(
    `<text x="${xRight}" y="${footerBaseline}" text-anchor="end" font-family="${FONT_ATTR}" font-size="10" fill="#9ca3af">第 ${
      pi + 1
    } 页 / 共 ${pages.length} 页</text>`,
  );

  const widthAttr = rasterScale === 1 ? `${PAGE.wMm}mm` : String(Math.round(pageW * rasterScale));
  const heightAttr = rasterScale === 1 ? `${PAGE.hMm}mm` : String(Math.round(pageH * rasterScale));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthAttr}" height="${heightAttr}" ` +
    `viewBox="0 0 ${pageW} ${pageH}">` +
    `<rect x="0" y="0" width="${pageW}" height="${pageH}" fill="#ffffff"/>` +
    parts.join('') +
    `</svg>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string,
  );
}

/** 文件名里各操作系统/文件系统不允许出现的字符（斜杠冒号等会导致路径截断或存盘失败） */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 去掉标题中的非法文件名字符；清洗后为空则回退「字帖」 */
export function safeBaseName(title: string): string {
  const cleaned = title
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '') // 末尾点号在 Windows 上会被吞掉
    .slice(0, 80)
    .trim();
  return cleaned || '字帖';
}

/** 延迟回收 blob URL：click 后部分浏览器仍在读流，过早 revoke 会落出 0 字节空文件 */
function revokeLater(url: string): void {
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  revokeLater(url);
}

/** 导出单页 SVG */
export function exportSvg(worksheet: Worksheet, pageIndex: number): void {
  const markup = pageSvgMarkup(worksheet, pageIndex);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  download(blob, `${safeBaseName(worksheet.title)}-第${pageIndex + 1}页.svg`);
}

/** 导出单页 PNG（scale 倍率，默认 4，约 384dpi） */
export async function exportPng(worksheet: Worksheet, pageIndex: number, scale = 4): Promise<void> {
  // 等字体就绪再栅格化，避免首屏未加载完字体时导出糊字/回退字体
  try {
    await document.fonts.ready;
  } catch {
    /* 字体不可用时继续导出 */
  }

  const markup = pageSvgMarkup(worksheet, pageIndex, scale);
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onerror = () => {
      revokeLater(svgUrl);
      reject(new Error('PNG 导出失败：SVG 渲染错误'));
    };
    img.onload = () => {
      // 画布与 SVG 的固有像素尺寸一致，drawImage 1:1，真正按 scale 倍栅格化
      const w = Math.round(mm(PAGE.wMm) * scale);
      const h = Math.round(mm(PAGE.hMm) * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        revokeLater(svgUrl);
        reject(new Error('无法创建画布'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      revokeLater(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG 编码失败'));
          return;
        }
        download(blob, `${safeBaseName(worksheet.title)}-第${pageIndex + 1}页.png`);
        resolve();
      }, 'image/png');
    };
    img.src = svgUrl;
  });
}
