import { z } from 'zod';
import { HANG_MUC_KEYS } from './hdgs-vat-ly';

/** Phần cán bộ tự nhập cho một công trình — gửi null để xoá một ô (về theo hệ thống). */
export const NhapTayBodySchema = z
  .object({
    hangMuc: z.enum(HANG_MUC_KEYS as [string, ...string[]]).nullish(),
    impactFactor: z.number().min(0).max(500).nullish(),
    trichDan: z.number().int().min(0).max(1_000_000).nullish(),
    quartile: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).nullish(),
    hIndex: z.number().int().min(0).max(5000).nullish(),
    online: z.boolean().nullish(),
    dongGop: z.number().min(0).max(100).nullish(),
    laTacGiaChinh: z.boolean().nullish(),
    nxbUyTin: z.boolean().nullish(),
    ghiChu: z.string().trim().max(1000).nullish(),
  })
  .strict();
export type NhapTayBodyType = z.infer<typeof NhapTayBodySchema>;

const NamQuery = z
  .string()
  .regex(/^\d{4}$/)
  .optional()
  .transform((v) => (v ? Number(v) : undefined));

export const HdgsQuerySchema = z.object({
  /** Năm hết hạn nộp hồ sơ — "3 năm cuối" tính theo năm này. Mặc định năm nay. */
  den: NamQuery,
  /** Năm bảo vệ TS (PGS) / đạt chuẩn PGS (GS) — chỉ đếm bài quốc tế từ năm này. */
  tuNamQT: NamQuery,
});
export type HdgsQueryType = z.infer<typeof HdgsQuerySchema>;
