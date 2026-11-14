import z from 'zod';
import { ContentStatus } from '../generated/prisma/enums';

export const ContentStatusEnum = z.nativeEnum(ContentStatus);

// Localized text payload — vi required (primary), en optional.
export const LocalizedTextSchema = z.object({
  vi: z.string(),
  en: z.string().optional(),
});
export type LocalizedTextType = z.infer<typeof LocalizedTextSchema>;

export const UpsertPostBodySchema = z.object({
  title: LocalizedTextSchema,
  slug: z.string().min(1).max(300),
  body: LocalizedTextSchema.nullable().optional(),
  excerpt: LocalizedTextSchema.nullable().optional(),
  status: ContentStatusEnum.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  // Ngày đăng tuỳ chọn (lùi về quá khứ) — CHỈ Super Admin được áp; role khác gửi
  // lên cũng bị bỏ qua ở service.
  publishedAt: z.string().datetime().nullable().optional(),
  coverMediaId: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  coverAlt: z.string().nullable().optional(),
  tagSlugs: z.array(z.string().min(1)).default([]),
  eventStartAt: z.string().nullable().optional(),
  eventEndAt: z.string().nullable().optional(),
  eventLocation: z.string().max(300).nullable().optional(),
  // Dữ liệu cho holder đa phương tiện của layout. Cất trong Post.metadata (cột
  // Json có sẵn, đang bỏ trống) nên KHÔNG phải đổi cấu trúc CSDL.
  gallery: z
    .array(z.object({ src: z.string(), alt: z.string().default('') }))
    .optional(),
  videoUrl: z.string().nullable().optional(),
  videoCaption: LocalizedTextSchema.nullable().optional(),
});
export type UpsertPostBodyType = z.infer<typeof UpsertPostBodySchema>;

export const CloneIntoLayoutBodySchema = z.object({
  templateLayoutId: z.string().min(1),
  // Danh mục của TRANG. Bỏ trống thì lấy danh mục của layout mẫu. Nhiều danh mục
  // cho một trang là cách để bài hiện dưới nhiều bộ lọc mà vẫn chỉ có một URL.
  categoryIds: z.array(z.string().min(1)).optional(),
  layoutName: z.string().min(1).max(300).optional(),
  layoutSlug: z.string().min(1).max(300).optional(),
});
export type CloneIntoLayoutBodyType = z.infer<typeof CloneIntoLayoutBodySchema>;

export const PostTagRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export const PostLayoutRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  isPublished: z.boolean(),
  scheduledAt: z.date().nullable(),
  publishedAt: z.date().nullable(),
  // Danh mục của trang, để trình soạn bài tick lại đúng khi mở bài cũ ra sửa.
  categoryLinks: z.array(z.object({ categoryId: z.string() })).optional(),
});

export const CategoryRefSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: LocalizedTextSchema,
});

export const PostResSchema = z.object({
  id: z.string(),
  title: LocalizedTextSchema,
  slug: z.string(),
  body: LocalizedTextSchema.nullable(),
  excerpt: LocalizedTextSchema.nullable(),
  departmentId: z.string().nullable(),
  category: CategoryRefSchema.optional(),
  status: ContentStatusEnum,
  reviewNote: z.string().nullable().optional(),
  coverMediaId: z.string().nullable(),
  coverUrl: z.string().nullable(),
  coverAlt: z.string().nullable(),
  tags: z.array(PostTagRefSchema),
  eventStartAt: z.date().nullable(),
  eventEndAt: z.date().nullable(),
  eventLocation: z.string().nullable(),
  gallery: z.array(z.object({ src: z.string(), alt: z.string() })).default([]),
  videoUrl: z.string().nullable().default(null),
  videoCaption: LocalizedTextSchema.nullable().default(null),
  publishedAt: z.date().nullable(),
  scheduledAt: z.date().nullable(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  layouts: z.array(PostLayoutRefSchema),
});
export type PostResType = z.infer<typeof PostResSchema>;

export const PostDraftResSchema = z.object({
  id: z.string(),
  slug: z.string(),
});
export type PostDraftResType = z.infer<typeof PostDraftResSchema>;

export const PostListResSchema = z.array(PostResSchema);
