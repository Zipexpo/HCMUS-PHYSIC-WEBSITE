import { z } from 'zod';
import { CLAIM_STATUSES } from './scholar.model';

/**
 * SÁNG KIẾN được công nhận (Khoa yêu cầu 25/11/2026) — khai giống bài báo:
 * tựa đề, MÃ SỐ (bắt buộc), CẤP (bắt buộc, mặc định cơ sở), SỐ QUYẾT ĐỊNH (bắt
 * buộc), nhiều tác giả. Thêm NGÀY quyết định: thiếu nó thì không xếp được sáng
 * kiến vào năm học / kỳ đánh giá (QĐ 3771 ký 20/11/2026 thuộc kỳ 2026-2027 dù mã
 * mang số 2026).
 */
export const CAP_SANG_KIEN = ['CO_SO', 'BO', 'TOAN_QUOC'] as const;
/** Khoa duyệt: nạp từ quyết định = APPROVED; tác giả khai / sửa nội dung = PENDING. */
export const TRANG_THAI_DUYET = ['APPROVED', 'PENDING', 'REJECTED'] as const;
export type CapSangKien = (typeof CAP_SANG_KIEN)[number];

/** Nhóm trong danh sách công nhận năm 2026 — chỉ hiển thị, không ảnh hưởng gì. */
export const NHOM_SANG_KIEN = [
  'BAI_BAO',
  'DE_TAI',
  'KHCN',
  'QUY_TRINH',
  'SACH',
  'KHAC',
] as const;

const Text = (max: number) => z.string().trim().max(max);
/**
 * KHÔNG gắn `.transform()` ở đây: với Zod 4, khoá vắng mặt vẫn chạy qua transform
 * của một schema nullish → «không gửi» thành `null` → PATCH xoá mất ghi chú. Chuỗi
 * rỗng → null làm ở service (`rong`).
 */
const OptionalText = (max: number) => z.string().trim().max(max).nullish();

/** 'YYYY-MM-DD' → Date lúc 00:00 UTC (cột @db.Date). */
const NgayQd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày quyết định dạng YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Ngày quyết định không hợp lệ')
  .refine(
    (d) => d.getUTCFullYear() >= 1990 && d.getUTCFullYear() <= 2200,
    'Năm quyết định ngoài khoảng hợp lệ',
  );

/**
 * Một dòng tác giả, theo ĐÚNG thứ tự trong quyết định. Có `userId` = người có tài
 * khoản (sẽ được mời xác nhận); không có = tác giả ngoài (sinh viên, đơn vị khác)
 * — bắt buộc ghi tên.
 */
export const TacGiaSangKienInputSchema = z
  .object({
    userId: z.string().min(1).nullish(),
    externalName: OptionalText(200),
    externalOrg: OptionalText(300),
  })
  .refine((a) => Boolean(a.userId) || Boolean(a.externalName), {
    message: 'Mỗi dòng tác giả phải chọn một người hoặc ghi tên',
    path: ['externalName'],
  });
export type TacGiaSangKienInput = z.infer<typeof TacGiaSangKienInputSchema>;

const ThongTinSangKien = {
  code: Text(60).min(3, 'Mã số sáng kiến là bắt buộc'),
  title: Text(1000).min(1, 'Tên sáng kiến là bắt buộc'),
  level: z.enum(CAP_SANG_KIEN).default('CO_SO'),
  decisionNo: Text(100).min(1, 'Số quyết định là bắt buộc'),
  decisionDate: NgayQd,
  category: z.enum(NHOM_SANG_KIEN).nullish(),
  note: OptionalText(2000),
  url: OptionalText(1000),
};

export const CreateSangKienBodySchema = z.object({
  ...ThongTinSangKien,
  /** Toàn bộ danh sách tác giả theo thứ tự; người khai có thể có hoặc không — thiếu thì tự thêm ở cuối. */
  authors: z.array(TacGiaSangKienInputSchema).max(50).default([]),
});
export type CreateSangKienBodyType = z.infer<typeof CreateSangKienBodySchema>;

/**
 * Sửa: mọi trường đều tuỳ chọn, KHÔNG có `.default()` — Zod 4 điền default cả
 * trong `.partial()` (bẫy nút «Hiện trên web» xoá vai trò, 23/11) nên dựng lại
 * từng trường thay vì `CreateSangKienBodySchema.partial()`.
 */
export const UpdateSangKienBodySchema = z.object({
  code: ThongTinSangKien.code.optional(),
  title: ThongTinSangKien.title.optional(),
  level: z.enum(CAP_SANG_KIEN).optional(),
  decisionNo: ThongTinSangKien.decisionNo.optional(),
  decisionDate: NgayQd.optional(),
  category: z.enum(NHOM_SANG_KIEN).nullish(),
  note: OptionalText(2000),
  url: OptionalText(1000),
  authors: z.array(TacGiaSangKienInputSchema).max(50).optional(),
});
export type UpdateSangKienBodyType = z.infer<typeof UpdateSangKienBodySchema>;

export const TraMaQuerySchema = z.object({ code: Text(60).min(1) });

export const NhanTenBodySchema = z.object({
  /** Dòng tác giả KHÔNG tài khoản mà người gọi nhận là mình (đổi thành dòng của họ, giữ thứ tự). */
  authorId: z.string().min(1).optional(),
});

export const TraLoiMoiBodySchema = z.object({ accept: z.boolean() });
export const HienTrenWebBodySchema = z.object({ showOnWeb: z.boolean() });
export const DongBoTrangBodySchema = z.object({ dryRun: z.boolean().optional() });

// ── Trả về ──────────────────────────────────────────────────────────────────
export const TacGiaSangKienResSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  userId: z.string().nullable(),
  displayName: z.string(),
  externalOrg: z.string().nullable(),
  departmentName: z.string().nullable(),
  claimStatus: z.enum(CLAIM_STATUSES).nullable(),
  invitedBy: z.string().nullable(),
});

export const SangKienResSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  level: z.enum(CAP_SANG_KIEN),
  decisionNo: z.string(),
  decisionDate: z.string().nullable(),
  category: z.string().nullable(),
  note: z.string().nullable(),
  url: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdByName: z.string().nullable(),
  /** Trạng thái của CHÍNH người đang xem; null = không có tên trong sáng kiến. */
  myStatus: z.enum(CLAIM_STATUSES).nullable(),
  myShowOnWeb: z.boolean().nullable(),
  evidenceName: z.string().nullable(),
  authors: z.array(TacGiaSangKienResSchema),
  reviewStatus: z.enum(TRANG_THAI_DUYET),
  reviewNote: z.string().nullable(),
  reviewedAt: z.date().nullable(),
  source: z.string(),
  /** Chỗ đổi so với bản Khoa đã duyệt — chỉ có khi đang chờ duyệt một bản sửa. */
  thayDoi: z.array(z.object({ truong: z.string(), tu: z.string(), sang: z.string() })),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const DanhSachDuyetQuerySchema = z.object({
  status: z.enum(TRANG_THAI_DUYET).default('PENDING'),
});
export const DuyetBodySchema = z.object({
  ok: z.boolean(),
  note: z.string().trim().max(2000).nullish(),
});

export const SangKienListResSchema = z.object({
  items: z.array(SangKienResSchema),
  total: z.number().int(),
});

/** Tra mã: đã có thì trả bản gọn để giao diện hỏi «gắn tên tôi vào?». */
export const TraMaResSchema = z.object({
  found: z.boolean(),
  item: SangKienResSchema.nullable(),
});

export const LoiMoiSangKienResSchema = z.object({
  items: z.array(
    z.object({
      initiativeId: z.string(),
      code: z.string(),
      title: z.string(),
      level: z.enum(CAP_SANG_KIEN),
      decisionNo: z.string(),
      decisionDate: z.string().nullable(),
      invitedByName: z.string().nullable(),
      authors: z.array(z.string()),
    }),
  ),
});

export const IntegrationSangKienResSchema = z.object({
  items: z.array(
    z.object({
      initiativeId: z.string(),
      code: z.string(),
      title: z.string(),
      level: z.enum(CAP_SANG_KIEN),
      decisionNo: z.string(),
      /** 'YYYY-MM-DD' */
      decisionDate: z.string().nullable(),
      category: z.string().nullable(),
      /** Chỉ APPROVED được đếm; PENDING / REJECTED chỉ để hiển thị. */
      reviewStatus: z.enum(TRANG_THAI_DUYET),
      email: z.string().nullable(),
      /** Thứ tự của người này trong danh sách tác giả (1 = đầu). */
      position: z.number().int(),
      /** Tổng số tác giả, kể cả người không tài khoản. */
      totalAuthors: z.number().int(),
      removed: z.boolean().optional(),
    }),
  ),
  nextSince: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
});
