import { z } from 'zod';

/**
 * SCOPUS AUTHOR ID — một người có thể có NHIỀU mã.
 *
 * Scopus hay tách nhầm một tác giả thành nhiều hồ sơ (đổi cơ quan, viết tên khác
 * nhau giữa các bài). Bảng Trường gửi Khoa ngày 16/11/2026 có người 4 mã, người 2
 * mã; trước đó ô này chỉ nhận một chuỗi tự do 40 ký tự, nên có người nhét nhiều mã
 * bằng dấu chấm phẩy, có người gõ luôn họ tên vào.
 *
 * Lưu vẫn trong MỘT cột chữ (không đổi CSDL), dạng chuẩn `57189905105; 57982213300`:
 * hệ thống chỉ hiển thị và đối chiếu mã Scopus, không tự kéo bài (cần khoá trả phí
 * của Elsevier), nên danh sách dạng chữ là đủ.
 */

/** Mã Scopus Author ID là dãy số — thường 10–11 chữ số, hồ sơ cũ có thể ngắn hơn. */
export const MA_SCOPUS_RE = /^\d{8,12}$/;

/** Tách chuỗi người nhập: ngăn bằng `;`, `,`, `/`, khoảng trắng hay xuống dòng; bỏ trùng, giữ thứ tự. */
export function tachMaScopus(s: string | null | undefined): string[] {
  return [
    ...new Set(
      (s ?? '')
        .split(/[;,/\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

/** Dạng lưu chuẩn; rỗng → null. */
export const noiMaScopus = (ds: string[]): string | null =>
  ds.length ? ds.join('; ') : null;

/**
 * Ô Scopus Author ID của hồ sơ: nhận một hoặc nhiều mã, mã nào không phải dãy số
 * thì báo lỗi nêu đúng mã đó; hợp lệ thì trả về dạng chuẩn.
 */
export const MaScopusSchema = z
  .string()
  .max(300)
  .nullish()
  .superRefine((s, ctx) => {
    const sai = tachMaScopus(s).filter((x) => !MA_SCOPUS_RE.test(x));
    if (sai.length) {
      ctx.addIssue({
        code: 'custom',
        message: `Scopus Author ID là dãy số (vd 57189905105); nhiều mã thì ngăn bằng dấu ; — không hợp lệ: ${sai.join(', ')}`,
      });
    }
  })
  .transform((s) => (s == null ? s : noiMaScopus(tachMaScopus(s))));
