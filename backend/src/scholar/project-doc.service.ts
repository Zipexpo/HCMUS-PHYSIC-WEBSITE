import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const run = promisify(execFile);

/** Nơi lưu tệp minh chứng đề tài — nằm trong volume `uploads/` (bền qua deploy). */
export const EVIDENCE_DIR = join(process.cwd(), 'uploads', 'project-evidence');

export type DocText = { text: string; source: 'text' | 'ocr' };

/**
 * Đọc CHỮ từ tài liệu đề tài để bóc tách trường (xem project-doc-parse.ts).
 *
 * Thuyết minh là PDF chữ → trích thẳng bằng `pdftotext`. Hợp đồng là bản SCAN
 * (mỗi trang một ảnh) → quét bằng `pdftoppm` (raster hoá) + `tesseract -l vie`.
 * Ảnh rời (jpg/png) → tesseract thẳng. Đo 19/9/2026 tesseract-vie đọc bản scan
 * hợp đồng có mộc đỏ ra đúng mã + hai mốc + kinh phí.
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

  async docText(filePath: string, mimeType: string): Promise<DocText> {
    if (mimeType.startsWith('image/')) {
      return { text: await this.tesseract(filePath), source: 'ocr' };
    }
    const truc = await this.pdfToText(filePath);
    if (truc.trim().length >= this.NGUONG_CHU) {
      return { text: truc, source: 'text' };
    }
    return { text: await this.ocrPdf(filePath), source: 'ocr' };
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
      { maxBuffer: this.MAX_BUFFER, timeout: 120_000 },
    );
    return stdout;
  }

  private async ocrPdf(filePath: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'detai-ocr-'));
    try {
      await run('pdftoppm', ['-r', '200', '-png', filePath, join(dir, 'p')], {
        timeout: 120_000,
      });
      const pages = (await readdir(dir))
        .filter((f) => f.endsWith('.png'))
        .sort();
      const parts: string[] = [];
      for (const f of pages) parts.push(await this.tesseract(join(dir, f)));
      return parts.join('\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
