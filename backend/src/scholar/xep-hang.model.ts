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
  /**
   * Bảng nào cho ra gợi ý — null = không tìm thấy trong bảng đã nạp. `scopus` / `wos`
   * = danh sách chỉ mục (21/11/2026): wos cho mã 1.1f; scopus chỉ giải thích (thuộc
   * Scopus mà chưa có hạng, hoặc đã bị loại).
   */
  nguon: z.enum(['sjr', 'core', 'scopus', 'wos']).nullable(),
  ma: z.string().nullable(),
  /** Tên trong bảng xếp hạng — để người khai thấy đã khớp ĐÚNG nơi đăng chưa. */
  tieuDe: z.string().nullable(),
  giaiThich: z.string(),
  /**
   * Nơi đăng KHÔNG thuộc Scopus ở năm công bố (Scopus đã loại…) dù bảng SJR năm trước
   * vẫn cho hạng — form hiện nổi bật, Khoa quyết. Thiếu = không có gì để cảnh báo.
   */
  canhBao: z.string().nullable().optional(),
  bang: z.array(
    z.object({
      ten: z.string(),
      ma: z.string().nullable(),
      hang: z.string().nullable(),
    }),
  ),
});
export type GoiYResType = z.infer<typeof GoiYResSchema>;

const LoaiBangSchema = z.enum(['sjr', 'core', 'scopus', 'wos']);

/**
 * Nạp bảng: tệp gửi multipart ở trường `file`. SJR / CORE: tệp CSV gốc (năm SJR đọc
 * ngay trong tệp). Scopus / WoS: GÓI JSON trình duyệt dựng từ tệp gốc (GoiChiMucSchema).
 */
export const NapBangBodySchema = z.object({
  loai: LoaiBangSchema,
});
export type NapBangBodyType = z.infer<typeof NapBangBodySchema>;

export const NapBangResSchema = z.object({
  loai: LoaiBangSchema,
  /** SJR: năm của bảng · CORE: các phiên bản trong tệp · Scopus / WoS: bản danh sách. */
  ten: z.string(),
  soDong: z.number().int(),
  ghiChu: z.string(),
});

/**
 * Gói danh sách chỉ mục trình duyệt quản trị dựng từ tệp gốc — Scopus Source List
 * (.xlsx của Elsevier) hoặc các tệp CSV của Master Journal List (WoS). Giá trị giữ
 * nguyên như tệp; máy chủ chuẩn hoá (chuanHoaChiMuc).
 */
export const GoiChiMucSchema = z.object({
  /** "Scopus Sources Oct. 2026", "WoS MJL 2026-11-18"… */
  phienBan: z.string().trim().min(1).max(200),
  ds: z
    .array(
      z.object({
        sourceId: z.string().max(100).optional(),
        title: z.string().max(1000),
        type: z.string().max(100).optional(),
        issn: z.string().max(200).optional(),
        coverage: z.string().max(2000).optional(),
        active: z.boolean().optional(),
        finalYear: z.number().int().min(1800).max(2200).nullable().optional(),
        finalIssue: z.string().max(200).nullable().optional(),
        finalReason: z.string().max(200).nullable().optional(),
      }),
    )
    .max(200_000),
});
export type GoiChiMucType = z.infer<typeof GoiChiMucSchema>;

export const TinhTrangBangResSchema = z.object({
  sjr: z.array(
    z.object({ nam: z.number().int(), soDong: z.number().int(), luc: z.date().nullable() }),
  ),
  core: z.array(
    z.object({ ban: z.string(), soDong: z.number().int(), luc: z.date().nullable() }),
  ),
  /** Danh sách Scopus / WoS đã nạp — mỗi chỉ mục một bản. */
  chiMuc: z.array(
    z.object({
      loai: z.enum(['scopus', 'wos']),
      phienBan: z.string(),
      soDong: z.number().int(),
      luc: z.date().nullable(),
    }),
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
      /** null khi huong = ngoai — không có mã nào để áp tự động. */
      maGoiY: z.string().nullable(),
      /**
       * nang = bảng cho mã cao hơn · ha = khai cao hơn bảng · doi = cùng định mức, khác
       * mục · ngoai = khai mã Scopus (1.1a–e) / WoS (1.1f) mà nơi đăng không thuộc chỉ
       * mục đó năm công bố — KHÔNG sửa tự động, Khoa xem từng bài.
       */
      huong: z.enum(['nang', 'ha', 'doi', 'ngoai']),
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
