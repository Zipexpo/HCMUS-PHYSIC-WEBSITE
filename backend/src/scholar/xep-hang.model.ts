import { z } from 'zod';

/** Gợi ý mã Phụ lục 2 cho MỘT công bố — form khai gọi khi đã có ISSN / tên nơi đăng. */
export const GoiYQuerySchema = z.object({
  issn: z.string().max(200).optional(),
  /** Tên tạp chí / kỷ yếu — dùng khi thiếu ISSN, và để dò CORE. */
  venue: z.string().max(500).optional(),
  /** Năm công bố (online). Thiếu thì lấy năm nay. */
  year: z.coerce.number().int().min(1990).max(2100).optional(),
  /** Gợi ý của form: kỷ yếu hội nghị thì dò CORE trước. */
  loai: z.enum(['tap-chi', 'hoi-nghi']).optional(),
});
export type GoiYQueryType = z.infer<typeof GoiYQuerySchema>;

export const GoiYResSchema = z.object({
  /** Bảng nào cho ra gợi ý — null = không tìm thấy trong bảng đã nạp. */
  nguon: z.enum(['sjr', 'core']).nullable(),
  ma: z.string().nullable(),
  /** Tên trong bảng xếp hạng — để người khai thấy đã khớp ĐÚNG nơi đăng chưa. */
  tieuDe: z.string().nullable(),
  giaiThich: z.string(),
  bang: z.array(
    z.object({
      ten: z.string(),
      ma: z.string().nullable(),
      hang: z.string().nullable(),
    }),
  ),
});
export type GoiYResType = z.infer<typeof GoiYResSchema>;

/** Nạp bảng: tệp CSV gửi multipart ở trường `file`. Năm SJR đọc ngay trong tệp. */
export const NapBangBodySchema = z.object({
  loai: z.enum(['sjr', 'core']),
});
export type NapBangBodyType = z.infer<typeof NapBangBodySchema>;

export const NapBangResSchema = z.object({
  loai: z.enum(['sjr', 'core']),
  /** SJR: năm của bảng · CORE: các phiên bản trong tệp. */
  ten: z.string(),
  soDong: z.number().int(),
  ghiChu: z.string(),
});

export const TinhTrangBangResSchema = z.object({
  sjr: z.array(
    z.object({ nam: z.number().int(), soDong: z.number().int(), luc: z.date().nullable() }),
  ),
  core: z.array(
    z.object({ ban: z.string(), soDong: z.number().int(), luc: z.date().nullable() }),
  ),
  /** Nhắc quản trị: bảng SJR kỳ đang chạy còn thiếu, chưa có CORE… */
  canhBao: z.array(z.string()),
});

export const TaiCoreResSchema = z.object({
  phienBan: z.array(z.object({ ban: z.string(), trangThai: z.string() })),
});

const ThangSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Dạng YYYY-MM');

/** Khoảng tháng cần soát — mặc định ở giao diện là kỳ đánh giá đang chạy (11 → 10). */
export const LechQuerySchema = z.object({ tu: ThangSchema, den: ThangSchema });
export type LechQueryType = z.infer<typeof LechQuerySchema>;

export const LechResSchema = z.object({
  tu: z.string(),
  den: z.string(),
  /** Số bài (mã tạp chí / kỷ yếu) trong khoảng — để biết đã soát bao nhiêu. */
  soBai: z.number().int(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      venue: z.string().nullable(),
      issn: z.string().nullable(),
      nam: z.number().int().nullable(),
      thang: z.number().int().nullable(),
      maKhai: z.string(),
      maGoiY: z.string(),
      /** nang = bảng cho mã cao hơn · ha = khai cao hơn bảng · doi = cùng định mức, khác mục. */
      huong: z.enum(['nang', 'ha', 'doi']),
      giaiThich: z.string(),
      tacGia: z.array(z.string()),
    }),
  ),
});

export const ApDungBodySchema = z.object({
  /** Mã quản trị đang nhìn thấy — CSDL khác thì dừng (ai đó vừa sửa). */
  tuMa: z.string().min(1).max(20),
});

export const ApDungResSchema = z.object({ id: z.string(), maMoi: z.string() });
