import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Kho tệp đính kèm — thư mục riêng trong volume `ticket_uploads`.
 *
 * KHÔNG tin tên tệp hay loại tệp trình duyệt khai: đọc chữ ký ở đầu tệp để
 * biết thật nó là gì, rồi đặt tên ngẫu nhiên. Nhờ vậy không ai tải được một
 * trang HTML lên rồi mở ra như thể nó thuộc hệ thống.
 */
export const UPLOAD_DIR = process.env.TICKET_UPLOAD_DIR ?? "/app/data/uploads";
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PER_TICKET = 20;

const KINDS = [
  { mime: "image/png", ext: "png", sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", ext: "jpg", sig: [0xff, 0xd8, 0xff] },
  { mime: "application/pdf", ext: "pdf", sig: [0x25, 0x50, 0x44, 0x46, 0x2d] },
] as const;

export function sniff(buf: Uint8Array): (typeof KINDS)[number] | null {
  return KINDS.find((k) => k.sig.every((b, i) => buf[i] === b)) ?? null;
}

/** Tên hiển thị: bỏ đường dẫn và ký tự điều khiển, cắt ngắn. */
export function cleanName(name: string, ext: string): string {
  const base = (name.split(/[\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 120);
  return base || `tep.${ext}`;
}

export async function store(buf: Uint8Array, ext: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  await writeFile(path.join(/* turbopackIgnore: true */ UPLOAD_DIR, name), buf, { flag: "wx" });
  return name;
}

export async function load(stored: string): Promise<Buffer | null> {
  // Tên lưu luôn do ta sinh; vẫn chặn mọi thứ ngoài dạng hex.ext cho chắc.
  if (!/^[a-f0-9]{32}\.(png|jpg|pdf)$/.test(stored)) return null;
  try {
    return await readFile(path.join(/* turbopackIgnore: true */ UPLOAD_DIR, stored));
  } catch {
    return null;
  }
}
