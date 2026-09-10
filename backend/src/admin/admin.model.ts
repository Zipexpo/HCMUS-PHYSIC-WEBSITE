import { z } from 'zod';

export const AdminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Tìm theo tên · họ · email · MSCB (nhiều từ, không phân biệt hoa thường). */
  search: z.string().trim().max(120).optional(),
});

export type AdminListQueryType = z.infer<typeof AdminListQuerySchema>;

export const AdminItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  position: z.string().nullable(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'LECTURER']),
  isActive: z.boolean(),
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
  department: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
  // ── Hồ sơ tài khoản (Mục 10) — web Khoa làm chủ ──
  physoomId: z.string().nullable(),
  teacherId: z.string().nullable(),
  degree: z.string().nullable(),
  rank: z.string().nullable(),
  positionKey: z.string().nullable(),
  positionFrom: z.date().nullable(),
  positionTo: z.date().nullable(),
  employmentType: z.string().nullable(),
});

export type AdminItemType = z.infer<typeof AdminItemSchema>;

export const AdminListResSchema = z.object({
  items: z.array(AdminItemSchema),
  total: z.number().int(),
  activeNow: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Danh sách đơn vị để dropdown chọn — Mục 10. */
  units: z.array(z.object({ id: z.string(), name: z.string() })),
});

/** Cập nhật hồ sơ tài khoản (Mục 10). Chỉ các trường web Khoa làm chủ. */
export const UpdateAdminProfileBodySchema = z.object({
  rank: z.string().nullable().optional(),
  positionKey: z.string().nullable().optional(),
  positionFrom: z.coerce.date().nullable().optional(),
  positionTo: z.coerce.date().nullable().optional(),
  degree: z.string().nullable().optional(),
  teacherId: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
});

export type UpdateAdminProfileBodyType = z.infer<
  typeof UpdateAdminProfileBodySchema
>;

/**
 * Tạo CÁN BỘ (giảng viên) — hồ sơ nhân sự, KHÔNG có mật khẩu (không đăng nhập
 * CMS). Khác hẳn tạo admin (POST /auth/create-admin, có password). `name` là họ
 * tên đầy đủ tiếng Việt, tách bằng splitVietnameseName.
 */
export const CreateStaffBodySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  teacherId: z.string().max(50).nullable().optional(),
  rank: z.string().nullable().optional(),
  positionKey: z.string().nullable().optional(),
  degree: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  positionFrom: z.coerce.date().nullable().optional(),
  positionTo: z.coerce.date().nullable().optional(),
});

export type CreateStaffBodyType = z.infer<typeof CreateStaffBodySchema>;

export type AdminListResType = z.infer<typeof AdminListResSchema>;

export const ResetAdminPasswordBodySchema = z.object({
  password: z.string().min(6).max(100),
});

export type ResetAdminPasswordBodyType = z.infer<
  typeof ResetAdminPasswordBodySchema
>;

export const AdminMessageResSchema = z.object({
  message: z.string(),
});

export type AdminMessageResType = z.infer<typeof AdminMessageResSchema>;
