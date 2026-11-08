import type { DeckData } from '../types.ts';
import {
  assertDeckPrintExportReady,
  createDeckPrintSnapshot,
  prepareDeckPrintPages,
  renderDeckPrintPages,
  type DeckPrintPageRole,
} from './export-pdf.ts';

export type PdfX4ProgressPhase =
  | 'preparing'
  | 'selectingDestination'
  | 'rendering'
  | 'converting'
  | 'finishing';

export interface PdfX4ExportProgress {
  phase: PdfX4ProgressPhase;
  completedPages: number;
  totalPages: number;
  message: string;
}

export interface PdfX4ExportResult {
  saved: boolean;
  path: string | null;
  bytesWritten: number;
  pageCount: number;
  profileName: string | null;
}

interface BeginPdfX4Result {
  started: boolean;
  jobId: string | null;
  expectedPages: number;
  pageWidth: number;
  pageHeight: number;
  profileName: string;
}

interface AppendPdfX4Result {
  appendedPages: number;
  expectedPages: number;
}

interface FinishPdfX4Result {
  saved: true;
  path: string;
  bytesWritten: number;
  pageCount: number;
}

export class PdfX4ExportError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PDFX4_EXPORT_FAILED') {
    super(message);
    this.name = 'PdfX4ExportError';
    this.code = code;
  }
}

export function isPdfX4DesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function errorRecord(value: unknown): { code?: unknown; message?: unknown } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as { code?: unknown; message?: unknown };
  }
  return record;
}

export function parsePdfX4Error(error: unknown): PdfX4ExportError {
  if (error instanceof PdfX4ExportError) return error;
  if (error instanceof Error) {
    const record = errorRecord(error);
    return new PdfX4ExportError(
      typeof record?.message === 'string' ? record.message : error.message,
      typeof record?.code === 'string' ? record.code : 'PDFX4_EXPORT_FAILED',
    );
  }
  if (typeof error === 'string') {
    try {
      return parsePdfX4Error(JSON.parse(error) as unknown);
    } catch {
      return new PdfX4ExportError(error);
    }
  }
  const record = errorRecord(error);
  return new PdfX4ExportError(
    typeof record?.message === 'string' ? record.message : 'PDF/X-4 印厂文件生成失败。',
    typeof record?.code === 'string' ? record.code : 'PDFX4_EXPORT_FAILED',
  );
}

function notifyProgress(
  callback: ((progress: PdfX4ExportProgress) => void) | undefined,
  progress: PdfX4ExportProgress,
): void {
  try {
    callback?.(progress);
  } catch {
    // A presentation callback must not interrupt a print-master export.
  }
}

function pageRoleLabel(role: DeckPrintPageRole): string {
  if (role === 'cardFront') return '卡牌正面';
  if (role === 'cardBack') return '卡牌背面';
  if (role === 'rightsNotice') return '权利声明';
  return '玩法说明书';
}

function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new PdfX4ExportError('印刷页面编码失败。', 'PDFX4_PAGE_INVALID'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(
        new PdfX4ExportError('印刷页面读取失败。', 'PDFX4_PAGE_INVALID'),
      );
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new PdfX4ExportError('印刷页面编码失败。', 'PDFX4_PAGE_INVALID'));
          return;
        }
        const separator = result.indexOf(',');
        if (separator < 0) {
          reject(new PdfX4ExportError('印刷页面编码格式无效。', 'PDFX4_PAGE_INVALID'));
          return;
        }
        resolve(result.slice(separator + 1));
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

function suggestedPdfX4Name(deck: DeckData): string {
  const safeName = deck.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'wanxiang-deck';
  return `${safeName}--pdfx4-cmyk.pdf`;
}

export async function exportDeckPdfX4(
  deck: DeckData,
  onProgress?: (progress: PdfX4ExportProgress) => void,
): Promise<PdfX4ExportResult> {
  if (!isPdfX4DesktopRuntime()) {
    throw new PdfX4ExportError(
      'PDF/X-4 印厂文件仅支持万象卡域桌面版，请在桌面软件中导出。',
      'PDFX4_DESKTOP_REQUIRED',
    );
  }

  deck = createDeckPrintSnapshot(deck);

  notifyProgress(onProgress, {
    phase: 'preparing',
    completedPages: 0,
    totalPages: 0,
    message: '正在检查牌组与印刷插画…',
  });
  await assertDeckPrintExportReady(deck);
  const printPlan = prepareDeckPrintPages(deck, 'pdfx4');
  const totalPages = printPlan.pageCount;
  notifyProgress(onProgress, {
    phase: 'selectingDestination',
    completedPages: 0,
    totalPages,
    message: `请选择 PDF/X-4 印厂文件保存位置 · 共 ${totalPages} 页`,
  });

  const { invoke } = await import('@tauri-apps/api/core');
  let jobId: string | null = null;
  let profileName: string | null = null;
  try {
    const begin = await invoke<BeginPdfX4Result>('begin_pdfx4_export', {
      suggestedName: suggestedPdfX4Name(deck),
      title: `${deck.name} - 万象卡域 PDF/X-4 印厂文件`,
      author: deck.author,
      expectedPages: totalPages,
    });
    if (!begin.started || !begin.jobId) {
      return {
        saved: false,
        path: null,
        bytesWritten: 0,
        pageCount: 0,
        profileName: begin.profileName ?? null,
      };
    }
    if (
      begin.expectedPages !== totalPages ||
      begin.pageWidth !== 2480 ||
      begin.pageHeight !== 3508
    ) {
      throw new PdfX4ExportError(
        '桌面印刷引擎与页面规格不一致，请更新或重新安装软件。',
        'PDFX4_PAGE_INVALID',
      );
    }
    jobId = begin.jobId;
    profileName = begin.profileName;

    let completedPages = 0;
    for await (const page of renderDeckPrintPages(deck, 'pdfx4', printPlan)) {
      notifyProgress(onProgress, {
        phase: 'rendering',
        completedPages,
        totalPages,
        message: `正在渲染${pageRoleLabel(page.role)} · ${page.pageIndex + 1}/${totalPages}`,
      });
      try {
        if (page.canvas.width !== 2480 || page.canvas.height !== 3508) {
          throw new PdfX4ExportError(
            `第 ${page.pageIndex + 1} 页尺寸不符合 A4 300 PPI 规范。`,
            'PDFX4_PAGE_INVALID',
          );
        }
        const pngBase64 = await canvasToPngBase64(page.canvas);
        notifyProgress(onProgress, {
          phase: 'converting',
          completedPages,
          totalPages,
          message: `正在转换 CMYK · ${page.pageIndex + 1}/${totalPages} · ${profileName}`,
        });
        const appended = await invoke<AppendPdfX4Result>('append_pdfx4_page', {
          jobId,
          pageIndex: page.pageIndex,
          role: page.role,
          pngBase64,
        });
        completedPages = appended.appendedPages;
        if (appended.expectedPages !== totalPages || completedPages !== page.pageIndex + 1) {
          throw new PdfX4ExportError(
            '桌面印刷引擎返回了不连续的页序。',
            'PDFX4_PAGE_INVALID',
          );
        }
      } finally {
        page.canvas.width = 1;
        page.canvas.height = 1;
      }
    }

    notifyProgress(onProgress, {
      phase: 'finishing',
      completedPages: totalPages,
      totalPages,
      message: '正在校验 PDF/X-4、输出意图与 CMYK 页面…',
    });
    const finished = await invoke<FinishPdfX4Result>('finish_pdfx4_export', { jobId });
    jobId = null;
    if (!finished.saved || finished.pageCount !== totalPages) {
      throw new PdfX4ExportError(
        'PDF/X-4 文件页数校验失败，因此未保存。',
        'PDFX4_CONFORMANCE_FAILED',
      );
    }
    return {
      saved: true,
      path: finished.path,
      bytesWritten: finished.bytesWritten,
      pageCount: finished.pageCount,
      profileName,
    };
  } catch (error) {
    if (jobId) {
      try {
        await invoke('cancel_pdfx4_export', { jobId });
      } catch {
        // Preserve the original conversion or conformance error.
      }
    }
    throw parsePdfX4Error(error);
  }
}
