import { z } from 'zod';
import { UpdatePublicationBodySchema } from './scholar.model';

/**
 * ĐỀ NGHỊ CHỈNH SỬA một công trình đã khai — Khoa chốt 20/11/2026:
 *   · ai có tài khoản cũng gửi được (kể cả người không có tên trong bài);
 *   · NGƯỜI KHAI quyết; im lặng quá 7 ngày, hoặc từ chối mà bên đề nghị không đồng
 *     ý → quản trị Khoa quyết;
 *   · đồng tác giả đã xác nhận VẪN sửa thẳng như cũ — đề nghị là đường thêm.
 *
 * Chỉ các trường THÔNG TIN BÀI được đề nghị và tự áp khi chấp nhận. Danh sách tác
 * giả, vai trò, tỷ lệ Cách 1 KHÔNG nằm ở đây: chúng có khoá vị trí, lý do bỏ Last
 * Author, đại diện Cách 1… — áp tự động sẽ lách hết các lớp đó. Sai ở phần tác giả
 * thì ghi vào lý do; người khai sửa bằng form thường (đủ mọi lớp kiểm).
 */
export const DeNghiThayDoiSchema = UpdatePublicationBodySchema.pick({
  title: true,
  containerTitle: true,
  volume: true,
  issue: true,
  pages: true,
  publisher: true,
  url: true,
  issn: true,
  status: true,
  publishedYear: true,
  publishedMonth: true,
  acceptedYear: true,
  acceptedMonth: true,
  catalogCode: true,
  quartile: true,
  satellite: true,
  reprint: true,
  fromProject: true,
  stage: true,
}).strict();
export type DeNghiThayDoiType = z.infer<typeof DeNghiThayDoiSchema>;
export const TRUONG_DE_NGHI = Object.keys(DeNghiThayDoiSchema.shape) as (keyof DeNghiThayDoiType)[];

export const LY_DO_DE_NGHI_TOI_THIEU = 10;
export const NGAY_CHO_NGUOI_KHAI = 7;

export const DE_NGHI_TRANG_THAI = ['PENDING', 'ESCALATED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const;
export type DeNghiTrangThai = (typeof DE_NGHI_TRANG_THAI)[number];

export const TaoDeNghiBodySchema = z.object({
  reason: z.string().trim().min(LY_DO_DE_NGHI_TOI_THIEU).max(2000),
  changes: DeNghiThayDoiSchema.default({}),
});
export type TaoDeNghiBodyType = z.infer<typeof TaoDeNghiBodySchema>;

export const QuyetDeNghiBodySchema = z.object({
  response: z.string().trim().max(2000).optional(),
});
export type QuyetDeNghiBodyType = z.infer<typeof QuyetDeNghiBodySchema>;

export const TuChoiDeNghiBodySchema = z.object({
  response: z.string().trim().min(LY_DO_DE_NGHI_TOI_THIEU).max(2000),
});

export const ChuyenKhoaBodySchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

export const ListDeNghiQuerySchema = z.object({
  /** den = gửi tới tôi (tôi là người khai) · di = tôi đã gửi · khoa = hàng chờ Khoa quyết */
  hop: z.enum(['den', 'di', 'khoa']).default('den'),
  /** "1" = cả đề nghị đã xong (mặc định chỉ đang mở). KHÔNG z.coerce.boolean: chuỗi "false" thành true. */
  tatCa: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});
export type ListDeNghiQueryType = z.infer<typeof ListDeNghiQuerySchema>;

const NguoiSchema = z.object({ id: z.string(), ten: z.string(), email: z.string() }).nullable();

export const DeNghiResSchema = z.object({
  id: z.string(),
  publicationId: z.string(),
  baiTen: z.string(),
  baiDoi: z.string().nullable(),
  nguoiGui: NguoiSchema,
  nguoiKhai: NguoiSchema,
  reason: z.string(),
  changes: z.record(z.string(), z.object({ tu: z.unknown(), sang: z.unknown() })),
  status: z.enum(DE_NGHI_TRANG_THAI),
  response: z.string().nullable(),
  nguoiQuyet: NguoiSchema,
  decidedAt: z.date().nullable(),
  escalatedAt: z.date().nullable(),
  createdAt: z.date(),
  /** Đã quá 7 ngày người khai chưa trả lời → Khoa quyết được, bên đề nghị chuyển được. */
  quaHan: z.boolean(),
  /** Người đang xem làm được gì với đề nghị này. */
  quyen: z.object({
    quyet: z.boolean(),
    rut: z.boolean(),
    chuyenKhoa: z.boolean(),
  }),
  history: z.array(
    z.object({ at: z.string(), by: z.string().nullable(), viec: z.string(), ghiChu: z.string().nullable() }),
  ),
});
export type DeNghiResType = z.infer<typeof DeNghiResSchema>;

export const DeNghiListResSchema = z.object({
  items: z.array(DeNghiResSchema),
  /** Số đề nghị ĐANG CHỜ người xem quyết — cho chấm đỏ trên menu. */
  choToi: z.number().int(),
  laQuanTri: z.boolean(),
});
