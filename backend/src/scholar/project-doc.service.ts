import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const run = promisify(execFile);

/** Nơi lưu tệp minh chứng đề tài — nằm trong volume `uploads/` (bền qua deploy). */
export const EVIDENCE_DIR = join(process.cwd(), 'uploads', 'project-evidence');

export type DocText = { text: string; source: 'text' | 'ocr' };

/** Điều khiển quét scan: dừng sớm và giới hạn số trang cho nhanh. */
export type OcrOpts = {
  /** Trả true khi text gom được đã đủ trường → ngừng OCR các trang sau. */
  enough?: (text: string) => boolean;
  /** Số trang tối đa phải quét. Mã/ngày/kinh phí của hợp đồng nằm ở Điều 1–3. */
  maxPages?: number;
};

/**
 * Đọc CHỮ từ tài liệu đề tài để bóc tách trường (xem project-doc-parse.ts).
 *
 * Thuyết minh là PDF chữ → trích thẳng bằng `pdftotext` (tức thì). Hợp đồng là
 * bản SCAN → quét bằng `pdftoppm` + `tesseract -l vie`. Ảnh rời (jpg/png) →
 * tesseract thẳng.
 *
 * QUÉT LƯỜI: mỗi trang OCR mất ~3–4s, nhưng mọi trường cần (mã, tên, hai mốc,
 * kinh phí, số quyết định, chủ nhiệm) đều nằm ở Điều 1–3, tức trang 1–2 của mẫu
 * hợp đồng ĐHQG. Nên quét TỪNG TRANG và dừng ngay khi `enough` báo đã đủ, tối đa
 * `maxPages` (mặc định 3). Đo 20/9: quét cả 6 trang mất ~30s; dừng ở trang 2 còn
 * ~10s. Trang 3–6 chỉ là điều khoản, chữ ký — không có dữ liệu cần.
 *
 * Cả ba nhị phân (poppler-utils + tesseract-ocr + gói `vie`) được cài trong image
 * backend — xem Dockerfile. Máy dev không có chúng thì hàm ném lỗi rõ ràng; chỉ
 * endpoint parse-documents gọi tới đây.
 */
@Injectable()
export class ProjectDocOcrService {
  /** Ít hơn ngần này ký tự thì coi là PDF scan (không có lớp chữ) → phải OCR. */
  private readonly NGUONG_CHU = 200;
  private readonly MAX_BUFFER = 48 * 1024 * 1024;
  private readonly DPI = '200';

  async docText(
    filePath: string,
    mimeType: string,
    opts?: OcrOpts,
  ): Promise<DocText> {
    if (mimeType.startsWith('image/')) {
      return { text: await this.tesseract(filePath), source: 'ocr' };
    }
    const truc = await this.pdfToText(filePath);
    if (truc.trim().length >= this.NGUONG_CHU) {
      return { text: truc, source: 'text' };
    }
    return { text: await this.ocrPdf(filePath, opts), source: 'ocr' };
  }

  private async pdfToText(filePath: string): Promise<string> {
    try {
      const { stdout } = await run(
        'pdftotext',
        ['-layout', '-q', filePath, '-'],
        { maxBuffer: this.MAX_BUFFER, timeout: 60_000 },
      );
      return stdout;
    } catch {
      // Thiếu poppler hoặc PDF hỏng lớp chữ — lùi về OCR.
      return '';
    }
  }

  private async tesseract(imgPath: string): Promise<string> {
    const { stdout } = await run(
      'tesseract',
      [imgPath, 'stdout', '-l', 'vie'],
      {
        maxBuffer: this.MAX_BUFFER,
        timeout: 120_000,
      },
    );
    return stdout;
  }

  /**
   * Quét scan theo kiểu LƯỜI: raster + OCR từng trang một, gom text, và dừng ngay
   * khi `enough` báo đủ. Hết trang thật (pdftoppm không sinh ảnh) thì cũng dừng.
   */
  private async ocrPdf(filePath: string, opts?: OcrOpts): Promise<string> {
    const maxPages = opts?.maxPages ?? 3;
    const dir = await mkdtemp(join(tmpdir(), 'detai-ocr-'));
    try {
      let text = '';
      for (let p = 1; p <= maxPages; p++) {
        const img = join(dir, 'page.png');
        await rm(img, { force: true });
        try {
          // `-singlefile` ghi đúng `page.png`, khỏi đoán tên có số trang.
          await run(
            'pdftoppm',
            [
              '-r',
              this.DPI,
              '-f',
              String(p),
              '-l',
              String(p),
              '-singlefile',
              '-png',
              filePath,
              join(dir, 'page'),
            ],
            { timeout: 60_000 },
          );
        } catch {
          break; // quá trang cuối
        }
        try {
          await stat(img);
        } catch {
          break; // trang không tồn tại → hết
        }
        text += (text ? '\n' : '') + (await this.tesseract(img));
        if (opts?.enough?.(text)) break;
      }
      return text;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
