import { z } from 'zod';

// ── Hằng dùng chung ─────────────────────────────────────────────────────────
export const PUBLICATION_STATUSES = [
  'SUBMITTED',
  'ACCEPTED',
  'IN_PRESS',
  'PUBLISHED',
  'RETRACTED',
] as const;

export const CLAIM_STATUSES = ['CONFIRMED', 'PENDING', 'REJECTED'] as const;

export const QUARTILES = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

/** Quan hệ công tác với Khoa. Để trống = chưa khai, KHÔNG mặc định cơ hữu. */
export const AFFILIATION_TYPES = ['FULL_TIME', 'JOINT', 'VISITING'] as const;

/** Bậc đào tạo sau đại học giảng viên ĐANG theo học. */
export const GRAD_STUDY_LEVELS = ['MASTER', 'PHD', 'POSTDOC'] as const;

/**
 * Bậc ĐÃ tốt nghiệp. Khác `GRAD_STUDY_LEVELS` ("đang học"): một người đã có bằng
 * tiến sĩ mà đang làm sau tiến sĩ thì có mặt ở cả hai chỗ, và đó là đúng.
 */
export const EDUCATION_LEVELS = [
  'BACHELOR',
  'ENGINEER',
  'MASTER',
  'PHD',
  'POSTDOC',
  'OTHER',
] as const;

export const EDUCATION_SOURCES = ['SELF', 'STAFF_PAGE'] as const;

const OptionalText = (max: number) => z.string().max(max).nullish();

/**
 * Diện người học của MỘT đồng tác giả / thành viên nhiệm vụ — sinh viên, học
 * viên cao học hay nghiên cứu sinh. CHỈ để GHI NHẬN cho thống kê về sau. KHÔNG
 * dùng vào bất kỳ phép quy đổi giờ / điểm / KPI nào (giờ do ACADsoom tính, và
 * kênh tích hợp KHÔNG phát trường này). Khác `GRAD_STUDY_LEVELS` vốn là bậc
 * CHÍNH CHỦ đang theo học, khai ở hồ sơ của mình.
 */
export const STUDENT_TYPES = ['sinh_vien', 'cao_hoc', 'ncs'] as const;
const StudentTypeField = z.enum(STUDENT_TYPES).nullish();

// ── Lý lịch khoa học ────────────────────────────────────────────────────────
export const NameVariantResSchema = z.object({
  id: z.string(),
  raw: z.string(),
  normalized: z.string(),
  isPrimary: z.boolean(),
});

// ── Quá trình đào tạo ───────────────────────────────────────────────────────
export const EducationResSchema = z.object({
  id: z.string(),
  level: z.enum(EDUCATION_LEVELS),
  field: z.string().nullable(),
  institution: z.string(),
  country: z.string().nullable(),
  year: z.number().int().nullable(),
  note: z.string().nullable(),
  /** STAFF_PAGE = máy đọc từ trang nhân sự cũ, chính chủ chưa soát lại. */
  source: z.enum(EDUCATION_SOURCES),
});
export type EducationResType = z.infer<typeof EducationResSchema>;

const EducationRowSchema = z.object({
  level: z.enum(EDUCATION_LEVELS),
  field: OptionalText(200),
  /** Nơi đào tạo — dòng học vấn không nói học ở đâu thì không dùng được. */
  institution: z.string().min(2).max(300),
  country: OptionalText(100),
  /**
   * Năm TỐT NGHIỆP. Cho trống vì phần lớn trang nhân sự cũ chỉ ghi tên trường;
   * bắt buộc thì người ta điền bừa một năm, mà số bịa còn tệ hơn ô trống.
   */
  year: z.number().int().min(1950).max(2200).nullish(),
  note: OptionalText(500),
});

/**
 * Thay CẢ danh sách trong một lần gọi, giống `SetNameVariantsBodySchema`.
 *
 * Sửa từng dòng thì giao diện phải theo dõi id của dòng chưa lưu, và người dùng
 * đổi thứ tự là sinh ra một mớ lệnh gọi. Danh sách này dài nhất chỉ vài dòng.
 */
export const SetEducationBodySchema = z.object({
  items: z.array(EducationRowSchema).max(12),
});
export type SetEducationBodyType = z.infer<typeof SetEducationBodySchema>;

export const ScholarProfileResSchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** Tên và email của chính người gọi — giao diện cần để chào và hiện chữ tắt. */
  displayName: z.string(),
  email: z.string(),
  /** Bộ môn, đồng bộ từ PHYsoom. CHỈ ĐỌC — sửa ở PHYsoom, không sửa ở đây. */
  departmentName: z.string().nullable(),
  orcid: z.string().nullable(),
  scopusAuthorId: z.string().nullable(),
  researcherId: z.string().nullable(),
  googleScholarId: z.string().nullable(),
  researchGateUrl: z.string().nullable(),
  staffPageSlug: z.string().nullable(),
  showOnWeb: z.boolean(),
  lastOrcidSyncAt: z.date().nullable(),

  affiliationType: z.enum(AFFILIATION_TYPES).nullable(),
  homeInstitution: z.string().nullable(),

  gradStudyLevel: z.enum(GRAD_STUDY_LEVELS).nullable(),
  gradStudyField: z.string().nullable(),
  gradStudyInstitution: z.string().nullable(),
  gradStudyCountry: z.string().nullable(),
  gradStudyStartYear: z.number().int().nullable(),
  gradStudyEndYear: z.number().int().nullable(),
  gradStudyFullTime: z.boolean(),
  gradStudyNote: z.string().nullable(),

  nameVariants: z.array(NameVariantResSchema),
  education: z.array(EducationResSchema),
});
export type ScholarProfileResType = z.infer<typeof ScholarProfileResSchema>;

export const UpdateScholarProfileBodySchema = z.object({
  // ORCID luôn có dạng 0000-0000-0000-000X; sai dạng thì chặn ngay, vì đây là
  // khoá dùng để khớp tác giả — sai một ký tự là khớp nhầm người.
  orcid: z
    .string()
    .regex(
      /^\d{4}-\d{4}-\d{4}-\d{3}[\dXx]$/,
      'ORCID phải có dạng 0000-0000-0000-0000',
    )
    .nullish(),
  scopusAuthorId: OptionalText(40),
  researcherId: OptionalText(40),
  googleScholarId: OptionalText(40),
  researchGateUrl: z.string().url().max(300).nullish(),
  staffPageSlug: OptionalText(300),
  showOnWeb: z.boolean().optional(),

  // ── Quan hệ công tác ──────────────────────────────────────────────────────
  affiliationType: z.enum(AFFILIATION_TYPES).nullish(),
  /** Đơn vị công tác chính — chỉ có nghĩa với kiêm nhiệm và thỉnh giảng. */
  homeInstitution: OptionalText(300),

  // ── Đang học sau đại học ──────────────────────────────────────────────────
  // Đặt gradStudyLevel = null để xoá cả khối (đã học xong, hoặc khai nhầm).
  gradStudyLevel: z.enum(GRAD_STUDY_LEVELS).nullish(),
  gradStudyField: OptionalText(200),
  gradStudyInstitution: OptionalText(300),
  gradStudyCountry: OptionalText(100),
  gradStudyStartYear: z.number().int().min(1950).max(2200).nullish(),
  /** Năm DỰ KIẾN hoàn thành. */
  gradStudyEndYear: z.number().int().min(1950).max(2200).nullish(),
  gradStudyFullTime: z.boolean().optional(),
  gradStudyNote: OptionalText(1000),
});
export type UpdateScholarProfileBodyType = z.infer<
  typeof UpdateScholarProfileBodySchema
>;

/** Bộ tên thường dùng khi đăng báo — thay cả danh sách trong một lần gọi. */
export const SetNameVariantsBodySchema = z.object({
  variants: z.array(z.string().min(2).max(200)).max(30),
  primary: z.string().max(200).optional(),
});
export type SetNameVariantsBodyType = z.infer<typeof SetNameVariantsBodySchema>;

// ── Tra cứu ─────────────────────────────────────────────────────────────────
export const ResolvedAuthorSchema = z.object({
  family: z.string().nullish(),
  given: z.string().nullish(),
  name: z.string().nullish(),
  orcid: z.string().nullish(),
  sequence: z.enum(['first', 'additional']).nullish(),
  affiliation: z.string().nullish(),
  /**
   * Diện học viên của tác giả này — CHỈ ghi nhận cho thống kê, KHÔNG tính giờ.
   * Lưu ngay trong authorsRaw (JSON) nên không cần cột/di trú riêng, và round-trip
   * qua đây vì cùng schema dùng cho cả nhận vào lẫn trả ra.
   */
  studentType: StudentTypeField,
  /**
   * Tác giả nước ngoài — CHỈ ghi nhận cho thống kê. Về NV2 xử lý y hệt non_school
   * (KHÔNG tính); kênh tích hợp sang ACADsoom không phát trường này. Lưu ngay
   * trong authorsRaw (JSON) như `studentType`, không cần cột/di trú riêng.
   */
  isForeign: z.boolean().nullish(),
  /**
   * Thuộc Đại học Quốc gia — đơn vị khác trong ĐHQG-HCM nhưng KHÔNG phải Trường
   * ĐH KHTN. CHỈ ghi nhận cho thống kê; về NV2 xử lý y hệt non_school (KHÔNG
   * tính). Lưu ngay trong authorsRaw (JSON) như `isForeign`, không cột/di trú riêng.
   */
  isVnu: z.boolean().nullish(),
  /**
   * Tác giả KHÔNG thuộc Trường trên BÀI NÀY (địa chỉ nơi khác lúc công bố, dù nay
   * có tài khoản Khoa). Trước đây school/double/non_school đều "không isForeign,
   * không isVnu" nên non_school bị suy nhầm về school lúc nạp → cộng dư. Lưu ngay
   * trong authorsRaw (JSON) như `isForeign`/`isVnu`, không cột/di trú riêng. Về
   * NV2 xử lý y hệt isForeign (KHÔNG tính) — chỉ để schoolAuthors đếm đúng.
   */
  isNonSchool: z.boolean().nullish(),
});

export const ResolvedWorkSchema = z.object({
  doi: z.string().nullish(),
  arxivId: z.string().nullish(),
  isbn: z.string().nullish(),
  issn: z.string().nullish(),
  type: z.string(),
  title: z.string(),
  containerTitle: z.string().nullish(),
  volume: z.string().nullish(),
  issue: z.string().nullish(),
  pages: z.string().nullish(),
  publisher: z.string().nullish(),
  url: z.string().nullish(),
  publishedYear: z.number().int().nullish(),
  publishedMonth: z.number().int().min(1).max(12).nullish(),
  acceptedYear: z.number().int().nullish(),
  acceptedMonth: z.number().int().min(1).max(12).nullish(),
  authors: z.array(ResolvedAuthorSchema),
  source: z.string(),
});

/** Gợi ý "người này trong Khoa có mặt trong danh sách tác giả". */
export const AuthorSuggestionSchema = z.object({
  authorIndex: z.number().int(),
  userId: z.string(),
  displayName: z.string(),
  email: z.string(),
  reason: z.enum(['orcid', 'variant', 'loose']),
  /** Gợi ý này chính là người đang gọi — giao diện tick sẵn "tôi là người này". */
  isMe: z.boolean(),
});

export const ResolvePreviewResSchema = z.object({
  work: ResolvedWorkSchema.nullable(),
  /** Bài đã có sẵn trong CSDL (trùng DOI) — để không tạo bản thứ hai. */
  existingPublicationId: z.string().nullable(),
  suggestions: z.array(AuthorSuggestionSchema),
});

export const ResolveBodySchema = z.object({
  input: z.string().min(3).max(2000),
});
export type ResolveBodyType = z.infer<typeof ResolveBodySchema>;

/** Nhập từ file .bib / .ris / CSL-JSON — gửi nội dung file dạng chữ. */
export const ImportFileBodySchema = z.object({
  content: z.string().min(3).max(2_000_000),
  filename: z.string().max(300).optional(),
});
export type ImportFileBodyType = z.infer<typeof ImportFileBodySchema>;

export const ImportPreviewResSchema = z.object({
  items: z.array(
    z.object({
      work: ResolvedWorkSchema,
      existingPublicationId: z.string().nullable(),
      suggestions: z.array(AuthorSuggestionSchema),
    }),
  ),
  skipped: z.number().int(),
});

export const OrcidImportBodySchema = z.object({
  /** Bỏ trống thì lấy ORCID trong hồ sơ của chính người gọi. */
  orcid: z
    .string()
    .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dXx]$/)
    .optional(),
  limit: z.number().int().min(1).max(300).optional(),
});
export type OrcidImportBodyType = z.infer<typeof OrcidImportBodySchema>;

// ── Công trình ──────────────────────────────────────────────────────────────
/** Vai trò của chính người gọi trong bài — quyết định giờ quy đổi ở ACADsoom. */
export const MyAuthorshipSchema = z.object({
  authorIndex: z.number().int().min(-1).default(-1),
  isFirst: z.boolean().default(false),
  isCorresponding: z.boolean().default(false),
  isLast: z.boolean().default(false),
  sharePercent: z.number().int().min(1).max(100).nullish(),
  showOnWeb: z.boolean().default(true),
});

export const PublicationAuthorResSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  email: z.string(),
  authorIndex: z.number().int(),
  isFirst: z.boolean(),
  isCorresponding: z.boolean(),
  isLast: z.boolean(),
  sharePercent: z.number().int().nullable(),
  claimStatus: z.enum(CLAIM_STATUSES),
  invitedBy: z.string().nullable(),
  respondedAt: z.date().nullable(),
  showOnWeb: z.boolean(),
});

export const PublicationResSchema = z.object({
  id: z.string(),
  doi: z.string().nullable(),
  arxivId: z.string().nullable(),
  isbn: z.string().nullable(),
  issn: z.string().nullable(),
  type: z.string(),
  title: z.string(),
  containerTitle: z.string().nullable(),
  volume: z.string().nullable(),
  issue: z.string().nullable(),
  pages: z.string().nullable(),
  publisher: z.string().nullable(),
  url: z.string().nullable(),
  status: z.enum(PUBLICATION_STATUSES),
  publishedYear: z.number().int().nullable(),
  publishedMonth: z.number().int().nullable(),
  acceptedYear: z.number().int().nullable(),
  acceptedMonth: z.number().int().nullable(),
  countYear: z.number().int().nullable(),
  authorsRaw: z.array(ResolvedAuthorSchema),
  source: z.string(),
  catalogCode: z.string().nullable(),
  quartile: z.string().nullable(),
  classifiedBy: z.string().nullable(),
  classifiedAt: z.date().nullable(),
  satellite: z.boolean(),
  reprint: z.boolean(),
  fromProject: z.boolean(),
  stage: z.number().int(),
  totalAuthors: z.number().int(),
  schoolAuthors: z.number().int(),
  mainAuthorAtSchool: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  authors: z.array(PublicationAuthorResSchema),
  /** Suy ra cho người đang gọi, để giao diện không phải tự dò. */
  isClassified: z.boolean(),
  myClaimStatus: z.enum(CLAIM_STATUSES).nullable(),
  /** Bài này có hiện trên trang nhân sự của TÔI không. */
  myShowOnWeb: z.boolean(),
});
export type PublicationResType = z.infer<typeof PublicationResSchema>;

export const PublicationListResSchema = z.object({
  items: z.array(PublicationResSchema),
  total: z.number().int(),
  /** Số bài chưa phân loại — giao diện phải nêu bật, vì chúng KHÔNG được tính. */
  unclassified: z.number().int(),
});

const YearNum = z.number().int().min(1900).max(2200);
const MonthNum = z.number().int().min(1).max(12);

/**
 * Tác giả NGOÀI Trường (không có tài khoản). Giao diện đã gửi kèm cờ vị trí cho
 * MỌI tác giả kể cả người ngoài; dùng để đếm mainAuthors — TỔNG tác giả chính
 * của BÀI, kể cả ngoài Trường (mục 1, docs/yeu-cau-web-khoa.md).
 */
export const ExternalAuthorSchema = z.object({
  name: z.string().max(300).optional(),
  isFirst: z.boolean().optional(),
  isCorresponding: z.boolean().optional(),
  isLast: z.boolean().optional(),
  sharePercent: z.number().nullish(),
});

export const CreatePublicationBodySchema = z.object({
  work: ResolvedWorkSchema,
  /** Mặc định PUBLISHED — phần lớn bài được khai sau khi đã in. */
  status: z.enum(PUBLICATION_STATUSES).default('PUBLISHED'),
  publishedYear: YearNum.nullish(),
  publishedMonth: MonthNum.nullish(),
  acceptedYear: YearNum.nullish(),
  acceptedMonth: MonthNum.nullish(),
  me: MyAuthorshipSchema,
  /** Đồng tác giả trong Khoa — họ sẽ ở PENDING cho tới khi tự xác nhận. */
  coAuthorUserIds: z.array(z.string()).max(50).default([]),
  /** Tác giả ngoài Trường + cờ vị trí — để đếm mainAuthors (tổng tác giả chính
   *  của bài, kể cả ngoài Trường). Giao diện vốn đã gửi, trước đây bị Zod bỏ. */
  externalAuthors: z.array(ExternalAuthorSchema).max(2000).default([]),
  totalAuthors: z.number().int().min(1).max(2000).optional(),
  /** SỐ tác giả thuộc Trường — cho phép 0 (mục 1b: bài không ai thuộc Trường).
   *  Thiếu trong schema này thì Zod bỏ số app gửi → mọi bài về mặc định 1. */
  schoolAuthors: z.number().int().min(0).max(2000).optional(),

  // ── Phân loại Phụ lục 2, chọn NGAY lúc khai ──────────────────────────────
  // Bắt quay lại lần hai nghĩa là nhiều người sẽ không quay lại, mà chưa phân
  // loại thì không được tính vào NV2. Vẫn cho để trống: người không chắc mình
  // thuộc mục nào thì đừng chặn họ lưu bài.
  catalogCode: OptionalText(20),
  quartile: z.enum(QUARTILES).nullish(),
  satellite: z.boolean().optional(),
  reprint: z.boolean().optional(),
  fromProject: z.boolean().optional(),
  stage: z.number().int().min(0).max(2).optional(),
});
export type CreatePublicationBodyType = z.infer<
  typeof CreatePublicationBodySchema
>;

export const UpdatePublicationBodySchema = z.object({
  title: z.string().min(1).max(1000).optional(),
  containerTitle: OptionalText(500),
  volume: OptionalText(50),
  issue: OptionalText(50),
  pages: OptionalText(50),
  publisher: OptionalText(300),
  url: z.string().max(1000).nullish(),
  issn: OptionalText(20),
  status: z.enum(PUBLICATION_STATUSES).optional(),
  publishedYear: YearNum.nullish(),
  publishedMonth: MonthNum.nullish(),
  acceptedYear: YearNum.nullish(),
  acceptedMonth: MonthNum.nullish(),

  // Phân loại — tác giả tự chọn. Đặt null để đưa bài về "chưa phân loại".
  catalogCode: OptionalText(20),
  quartile: z.enum(QUARTILES).nullish(),

  satellite: z.boolean().optional(),
  reprint: z.boolean().optional(),
  fromProject: z.boolean().optional(),
  stage: z.number().int().min(0).max(2).optional(),

  totalAuthors: z.number().int().min(1).max(2000).optional(),
  /** Kể cả đồng tác giả là sinh viên/học viên thuộc Trường mà không có tài khoản.
   *  Hệ thống luôn nâng lên ít nhất bằng số tác giả đã xác nhận. CHO PHÉP 0: khi
   *  người khai đánh dấu không tác giả nào thuộc Trường trên bài này (bài của nơi
   *  làm việc cũ) — sàn min(1) sẽ ép bài đó vẫn tính giờ NV2, đúng lỗi 1b. */
  schoolAuthors: z.number().int().min(0).max(2000).optional(),
  mainAuthorAtSchool: z.boolean().optional(),

  me: MyAuthorshipSchema.partial().optional(),
  coAuthorUserIds: z.array(z.string()).max(50).optional(),

  /**
   * Danh sách tác giả gốc, gửi lên KHI cần ghi lại `studentType` (diện học viên)
   * cho từng tác giả — dữ liệu GHI NHẬN, không đụng quy đổi. Giao diện gửi nguyên
   * mảng đã nạp về, chỉ phủ thêm `studentType`, nên thứ tự và danh tính tác giả
   * giữ nguyên. Bỏ trống thì không đụng tới authorsRaw.
   */
  authorsRaw: z.array(ResolvedAuthorSchema).max(2000).optional(),
  /** Tác giả ngoài Trường + cờ vị trí — cập nhật lại số tác giả chính ngoài Trường. */
  externalAuthors: z.array(ExternalAuthorSchema).max(2000).optional(),
});
export type UpdatePublicationBodyType = z.infer<
  typeof UpdatePublicationBodySchema
>;

export const ListPublicationsQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  status: z.enum(PUBLICATION_STATUSES).optional(),
  /** "unclassified" = chưa chọn mã Phụ lục 2. */
  filter: z.enum(['all', 'unclassified', 'classified', 'pending']).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListPublicationsQueryType = z.infer<
  typeof ListPublicationsQuerySchema
>;

// ── Xác nhận tác giả ────────────────────────────────────────────────────────
export const ClaimResponseBodySchema = z.object({
  accept: z.boolean(),
  authorship: MyAuthorshipSchema.partial().optional(),
});
export type ClaimResponseBodyType = z.infer<typeof ClaimResponseBodySchema>;

export const PendingClaimListResSchema = z.array(
  z.object({
    publicationId: z.string(),
    title: z.string(),
    containerTitle: z.string().nullable(),
    year: z.number().int().nullable(),
    doi: z.string().nullable(),
    invitedBy: z.string().nullable(),
    invitedByName: z.string().nullable(),
    authorsRaw: z.array(ResolvedAuthorSchema),
    suggestedAuthorIndex: z.number().int(),
  }),
);

// ── API tích hợp cho ACADsoom ───────────────────────────────────────────────
/**
 * Chỉ trả DỮ KIỆN, không trả giờ quy đổi: hệ số là quy định của Trường/Khoa và
 * đã cài ở ACADsoom (src/lib/nv2Hours.js). Trả giờ ở đây là có hai nơi cùng
 * quy đổi, sửa định mức phải sửa hai chỗ.
 *
 * Và chỉ trả bài ĐÃ PHÂN LOẠI: bài chưa chọn mã Phụ lục 2 không tồn tại đối với
 * ACADsoom, nên "không chỉnh thì không được tính" là ràng buộc dữ liệu chứ
 * không phải lời nhắc trên giao diện.
 */
/**
 * Mốc để gọi lần sau. Bên nhận lưu `nextSince` lại, lần sau gửi nguyên si.
 * `hasMore` = còn trang nữa, gọi tiếp ngay đừng đợi tới lịch sau.
 */
const INTEGRATION_CURSOR = {
  nextSince: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
};

export const IntegrationPublicationResSchema = z.object({
  items: z.array(
    z.object({
      publicationId: z.string(),
      doi: z.string().nullable(),
      // CÁCH NHẬP: ACADsoom dựa vào đây để đòi minh chứng — bài nhập tay ('Khai
      // tay'/'manual'/import .bib) phải nộp fulltext, bài tự truy xuất thì miễn.
      // Không có `@ZodSerializerDto` sẽ nuốt mất trường này ở đầu ra.
      source: z.string().nullable(),
      title: z.string(),
      venue: z.string().nullable(),
      url: z.string().nullable(),
      status: z.enum(PUBLICATION_STATUSES),
      countYear: z.number().int().nullable(),
      publishedYear: z.number().int().nullable(),
      publishedMonth: z.number().int().nullable(),
      acceptedYear: z.number().int().nullable(),
      acceptedMonth: z.number().int().nullable(),

      // Null được, nhưng chỉ ở chế độ `since` và luôn đi kèm `removed: true` —
      // bài rút phân loại thì bên nhận phải thấy để bỏ đi.
      catalogCode: z.string().nullable(),
      quartile: z.string().nullable(),

      satellite: z.boolean(),
      reprint: z.boolean(),
      fromProject: z.boolean(),
      stage: z.number().int(),

      totalAuthors: z.number().int(),
      schoolAuthors: z.number().int(),
      mainAuthorAtSchool: z.boolean(),
      /** SỐ tác giả chính thuộc Trường đã xác nhận — mẫu số của Cách 2. */
      mainAuthorsAtSchool: z.number().int(),
      /** TỔNG tác giả chính CỦA BÀI (kể cả ngoài Trường) — mẫu số thật của phần 1/3. */
      mainAuthors: z.number().int(),
      isMainAuthor: z.boolean(),
      sharePercent: z.number().int().nullable(),

      /** Vị trí của chính người được hỏi — để đối soát, không dùng để tính. */
      authorIndex: z.number().int(),
      isFirst: z.boolean(),
      isCorresponding: z.boolean(),
      isLast: z.boolean(),
      /**
       * Người được hỏi CÓ ghi địa chỉ Trường trên bài này không (câu hỏi theo
       * từng cặp người × bài — ca A/B/C). `true`=có · `false`=không (ACADsoom cho
       * 0 giờ) · `null`=chưa xác định (vị trí -1 / chưa khai → tính như cũ).
       */
      authorAtSchool: z.boolean().nullable(),

      email: z.string().nullable(),
      /** Bản ghi này KHÔNG còn được tính nữa (xoá / rút phân loại / rút xác nhận). */
      removed: z.boolean().optional(),
    }),
  ),
  ...INTEGRATION_CURSOR,
});

/**
 * Diện đang học sau đại học cho ACADsoom.
 *
 * Là DỮ KIỆN, không phải giờ: bên ACADsoom diện đang học kéo giảm định mức
 * (tới 50%) và cộng giờ chuẩn, nhưng hệ số nào áp cho ai là quy định của
 * Trường/Khoa, cài ở ACADsoom. Web Khoa chỉ nói người này đang học BẬC gì, Ở ĐÂU
 * (quốc gia — để tách NCS trong nước / nước ngoài), TỪ năm nào ĐẾN năm nào (dự
 * kiến), và có được cử đi TOÀN THỜI GIAN không.
 *
 * `from/to` KHÔNG áp ở đây — diện học không có một "năm" đơn để lọc. ACADsoom
 * nhận trọn `startYear/endYear` rồi tự cắt theo cửa sổ năm học của nó, đúng như
 * cách nó cắt tháng đề tài.
 */
export const IntegrationGradStudyResSchema = z.object({
  items: z.array(
    z.object({
      email: z.string().nullable(),
      // Null CHỈ ở chế độ `since`, luôn đi kèm `removed: true` — người vừa gỡ
      // diện học thì bên nhận phải thấy để THÔI giảm định mức, không thì họ được
      // giảm mãi sau khi đã học xong.
      level: z.enum(GRAD_STUDY_LEVELS).nullable(),
      field: z.string().nullable(),
      institution: z.string().nullable(),
      country: z.string().nullable(),
      startYear: z.number().int().nullable(),
      /** Năm DỰ KIẾN hoàn thành, không phải năm đã xong. */
      endYear: z.number().int().nullable(),
      fullTime: z.boolean(),
      note: z.string().nullable(),
      /** KHÔNG còn khai diện học nào nữa — bên nhận thôi áp giảm định mức. */
      removed: z.boolean().optional(),
    }),
  ),
  ...INTEGRATION_CURSOR,
});

/**
 * Hồ sơ nhân sự cho ACADsoom (Mục 10) — web Khoa LÀM CHỦ, ACADsoom kéo về, không
 * sửa. Trả DỮ KIỆN người + danh sách đơn vị; KHÔNG trả giờ/điểm/định mức (nằm ở
 * `Term.*` bên ACADsoom, đổi theo năm học). Hai chế độ ảnh chụp / `since` như các
 * kênh khác. `id` là định danh BẤT BIẾN (physoomId) — khoá ghép người.
 */
export const IntegrationStaffResSchema = z.object({
  units: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      /** dept · lab · office — quyết định trần điểm NV3 bên ACADsoom. */
      kind: z.string().nullable(),
      order: z.number().int(),
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      /** MSCB — chuỗi, giữ số 0 đầu. */
      teacherId: z.string().nullable(),
      degree: z.string().nullable(),
      rank: z.string().nullable(),
      /** Chức vụ (key), rỗng = không giữ chức vụ. */
      position: z.string().nullable(),
      positionFrom: z.string().nullable(),
      positionTo: z.string().nullable(),
      unitId: z.string().nullable(),
      employmentType: z.string().nullable(),
      active: z.boolean(),
      /** Ở chế độ `since`: người đã nghỉ / gỡ — bên nhận ẩn đi. */
      removed: z.boolean().optional(),
    }),
  ),
  ...INTEGRATION_CURSOR,
});

// ── Hoạt động KHCN khác (Bảng 3) ────────────────────────────────────────────
//
// Khác hẳn công bố và đề tài ở một điểm quyết định hình dạng lược đồ: Bảng 3
// tính giờ CỐ ĐỊNH CHO MỘT NGƯỜI, không chia theo số tác giả. Nên không có
// `totalAuthors` / `schoolAuthors` / `sharePercent`, và không có cơ chế mời —
// hai người cùng ngồi một hội đồng thì khai hai bản ghi độc lập.
const ActivityYear = z.number().int().min(1950).max(2200);

/** Đồng thực hiện — dùng cho giải thưởng có nhiều người đồng hướng dẫn. */
const ActivityMemberInputSchema = z.object({
  userId: z.string(),
  role: OptionalText(100),
});

export const CreateActivityBodySchema = z.object({
  /** Mã Bảng 3 — BẮT BUỘC. Nó gói sẵn cả cấp lẫn vai trò, và là căn cứ quy đổi giờ. */
  catalogCode: z.string().min(2).max(20),
  title: z.string().min(1).max(500),
  level: OptionalText(100),
  role: OptionalText(100),
  organizer: OptionalText(300),
  decisionNo: OptionalText(100),
  year: ActivityYear.nullish(),
  month: z.number().int().min(1).max(12).nullish(),
  note: OptionalText(2000),
  url: OptionalText(1000),
  /**
   * Đồng thực hiện thuộc Khoa — họ ở PENDING cho tới khi TỰ xác nhận. Bảng 3
   * khoán giờ cố định cho mỗi người nên KHÔNG chia: mỗi người được trọn phần,
   * ai xác nhận nấy được ghi. Chỉ có ý nghĩa với nhóm giải thưởng.
   */
  members: z.array(ActivityMemberInputSchema).max(30).optional(),
});
export type CreateActivityBodyType = z.infer<typeof CreateActivityBodySchema>;

export const UpdateActivityBodySchema = CreateActivityBodySchema.partial();
export type UpdateActivityBodyType = z.infer<typeof UpdateActivityBodySchema>;

export const ListActivitiesQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  q: z.string().max(200).optional(),
});
export type ListActivitiesQueryType = z.infer<typeof ListActivitiesQuerySchema>;

export const ActivityMemberResSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  role: z.string().nullable(),
  claimStatus: z.enum(CLAIM_STATUSES),
  invitedBy: z.string().nullable(),
});

export const ActivityResSchema = z.object({
  id: z.string(),
  catalogCode: z.string(),
  title: z.string(),
  level: z.string().nullable(),
  role: z.string().nullable(),
  organizer: z.string().nullable(),
  decisionNo: z.string().nullable(),
  year: z.number().int().nullable(),
  month: z.number().int().nullable(),
  note: z.string().nullable(),
  url: z.string().nullable(),
  members: z.array(ActivityMemberResSchema).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Lời mời đồng thực hiện đang chờ CHÍNH người được gắn xác nhận. */
export const ActivityClaimResSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  title: z.string(),
  catalogCode: z.string(),
  role: z.string().nullable(),
  year: z.number().int().nullable(),
  ownerName: z.string(),
  invitedBy: z.string().nullable(),
});
export const ActivityClaimListResSchema = z.object({
  items: z.array(ActivityClaimResSchema),
});
export const RespondActivityClaimBodySchema = z.object({
  accept: z.boolean(),
});
export type RespondActivityClaimBodyType = z.infer<
  typeof RespondActivityClaimBodySchema
>;

export const ActivityListResSchema = z.object({
  items: z.array(ActivityResSchema),
  total: z.number().int(),
});

export const IntegrationActivityResSchema = z.object({
  items: z.array(
    z.object({
      activityId: z.string(),
      catalogCode: z.string(),
      title: z.string(),
      level: z.string().nullable(),
      role: z.string().nullable(),
      organizer: z.string().nullable(),
      decisionNo: z.string().nullable(),
      year: z.number().int().nullable(),
      month: z.number().int().nullable(),
      email: z.string().nullable(),
      removed: z.boolean().optional(),
    }),
  ),
  ...INTEGRATION_CURSOR,
});

// ── Tra người trong Khoa ────────────────────────────────────────────────────
export const PeopleQuerySchema = z.object({
  q: z.string().max(100).optional(),
});
export type PeopleQueryType = z.infer<typeof PeopleQuerySchema>;

export const PeopleResSchema = z.object({
  items: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      email: z.string(),
      departmentName: z.string().nullable(),
    }),
  ),
});

export const IntegrationQuerySchema = z.object({
  email: z.string().email().optional(),
  /** Nhiều email, ngăn bằng dấu phẩy — lọc một lượt cho nhiều người (traDanhBa /
   *  đăng nhập của ACADsoom). `email` (số ít) vẫn nhận để tương thích. */
  emails: z.string().max(4000).optional(),
  from: z.coerce.number().int().min(1900).max(2200).optional(),
  to: z.coerce.number().int().min(1900).max(2200).optional(),
  /**
   * Chế độ "lấy phần đã đổi": trả mọi bản ghi động vào từ mốc này, KỂ CẢ bản
   * vừa bị xoá / bị rút phân loại (đánh dấu `removed`). Đây là chỗ bảo đảm
   * đồng bộ — webhook chỉ là cú hích, mất thì lần quét này vá lại.
   */
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});
export type IntegrationQueryType = z.infer<typeof IntegrationQuerySchema>;

// ── Thống kê ────────────────────────────────────────────────────────────────
export const StatsResSchema = z.object({
  byYear: z.array(
    z.object({
      year: z.number().int().nullable(),
      total: z.number().int(),
      classified: z.number().int(),
    }),
  ),
  byQuartile: z.array(
    z.object({ quartile: z.string().nullable(), count: z.number().int() }),
  ),
  byStatus: z.array(
    z.object({ status: z.enum(PUBLICATION_STATUSES), count: z.number().int() }),
  ),
});

/**
 * Dữ liệu THÔ toàn Khoa cho trang thống kê admin — ACADsoom/phys-profile tự lọc
 * (năm, khoảng tháng) và tổng hợp phía client. Payload nhỏ (vài trăm dòng), nên
 * trả nguyên còn hơn thêm một endpoint tổng hợp cho mỗi chiều lọc.
 */
export const FacultyDetailResSchema = z.object({
  publications: z.array(
    z.object({
      type: z.string(),
      countYear: z.number().int().nullable(),
      publishedMonth: z.number().int().nullable(),
      acceptedMonth: z.number().int().nullable(),
      status: z.string(),
      quartile: z.string().nullable(),
      catalogCode: z.string().nullable(),
    }),
  ),
  projects: z.array(
    z.object({
      status: z.string(),
      startYear: z.number().int().nullable(),
      startMonth: z.number().int().nullable(),
      endYear: z.number().int().nullable(),
      endMonth: z.number().int().nullable(),
      budget: z.number().nullable(),
    }),
  ),
});

/**
 * BÁO CÁO chi tiết toàn Khoa — mỗi công bố / đề tài một dòng với đủ trường để
 * dựng file danh sách (khớp mẫu Khoa). Tên tác giả / chủ nhiệm / thành viên đã
 * ghép sẵn ở máy chủ; bên nhận chỉ trải ra bảng. Admin-gated.
 */
export const FacultyReportResSchema = z.object({
  publications: z.array(
    z.object({
      type: z.string(),
      countYear: z.number().int().nullable(),
      publishedYear: z.number().int().nullable(),
      publishedMonth: z.number().int().nullable(),
      acceptedYear: z.number().int().nullable(),
      acceptedMonth: z.number().int().nullable(),
      status: z.string(),
      quartile: z.string().nullable(),
      catalogCode: z.string().nullable(),
      title: z.string(),
      containerTitle: z.string().nullable(),
      volume: z.string().nullable(),
      issue: z.string().nullable(),
      pages: z.string().nullable(),
      issn: z.string().nullable(),
      doi: z.string().nullable(),
      url: z.string().nullable(),
      totalAuthors: z.number().int(),
      authorNames: z.array(z.string()),
      firstAuthor: z.string(),
      correspondingAuthor: z.string(),
    }),
  ),
  projects: z.array(
    z.object({
      decisionNo: z.string().nullable(),
      title: z.string(),
      status: z.string(),
      startYear: z.number().int().nullable(),
      startMonth: z.number().int().nullable(),
      endYear: z.number().int().nullable(),
      endMonth: z.number().int().nullable(),
      leadName: z.string(),
      memberNames: z.array(z.string()),
      memberCount: z.number().int(),
    }),
  ),
});

// ── Trang nhân sự trên web Khoa ─────────────────────────────────────────────
// Giảng viên sửa trang của CHÍNH MÌNH từ app. Không có tham số chỉ định trang
// khác — quyền chặn ở tầng dữ liệu qua ScholarProfile.staffPageSlug.
// Song ngữ: mỗi ô có thêm bản `*En` (tuỳ chọn) để app phys-profile đẩy được cả
// tiếng Anh. Bỏ trống thì trang công khai tự lùi về tiếng Việt (xem i18n `t`).
const EntrySchema = z.object({
  title: z.string().min(1).max(300),
  desc: z.string().max(2000).optional(),
  titleEn: z.string().max(300).optional(),
  descEn: z.string().max(2000).optional(),
});

const ExtraSchema = z.object({
  section: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  desc: z.string().max(2000).optional(),
  sectionEn: z.string().max(120).optional(),
  titleEn: z.string().max(300).optional(),
  descEn: z.string().max(2000).optional(),
});

const StaffPubSchema = z.object({
  year: z.string().max(10).optional(),
  title: z.string().min(1).max(1000),
  meta: z.string().max(1000).optional(),
  url: z.string().max(1000).optional(),
});

export const StaffPageResSchema = z.object({
  slug: z.string(),
  layoutId: z.string(),
  photo: z.string(),
  /** 'compact' (mặc định) ảnh nhỏ trên điện thoại; 'full' ảnh lớn như cũ. */
  heroLayout: z.string(),
  /** Nền hero: mã màu hex (giảng viên chọn) · URL ảnh (admin) · rỗng = tối mặc định. */
  heroBg: z.string(),
  /** Email liên hệ hiện cạnh icon học thuật — tự đồng bộ từ tài khoản. */
  email: z.string(),
  eyebrow: z.string(),
  eyebrowEn: z.string(),
  name: z.string(),
  nameEn: z.string(),
  intro: z.string(),
  introEn: z.string(),
  research: z.array(EntrySchema),
  teaching: z.array(EntrySchema),
  extras: z.array(ExtraSchema),
  publications: z.array(StaffPubSchema),
  /** Khối "Thông tin chi tiết" (prop `html`) — nay sửa được qua ô soạn thảo ở app. */
  legacyHtml: z.string(),
  legacyHtmlEn: z.string(),
});

/** Ô song ngữ đơn giản cho khối danh sách đội ngũ. */
const DeptLocalizedSchema = z.object({ vi: z.string(), en: z.string() });

/** Một người trên trang danh sách đội ngũ bộ môn (khối `DepartmentStaffAuto`). */
export const DepartmentStaffPersonSchema = z.object({
  /** Slug trang cá nhân — link tới hồ sơ, và khoá ghép ảnh/chức vụ. */
  slug: z.string(),
  photo: z.string(),
  name: DeptLocalizedSchema,
  /** Học vị (đệm trên tên), song ngữ. */
  eyebrow: DeptLocalizedSchema,
  /** Chức vụ hiển thị (Trưởng bộ môn / Giảng viên / Thỉnh giảng…), song ngữ. */
  role: DeptLocalizedSchema,
  email: z.string(),
  /** true = cán bộ thỉnh giảng — trang nhóm riêng ở cuối. */
  visiting: z.boolean(),
  /** Nhóm lọc: lanh-dao · giang-vien · giao-vu · thinh-giang. */
  category: z.string(),
  /** Chức vụ cấp KHOA (Trưởng/Phó khoa) nếu có — trang cấp Khoa gom "Ban lãnh đạo". */
  facultyRole: DeptLocalizedSchema.nullish(),
});

/** Đội ngũ MỘT bộ môn cho khối `DepartmentStaffAuto` (công khai, không auth). */
export const DepartmentStaffResSchema = z.object({
  department: z.string(),
  /** Tên hiển thị bộ môn (cho hero) — vd "Vật lý Tin học". */
  departmentName: z.string(),
  people: z.array(DepartmentStaffPersonSchema),
});
export type DepartmentStaffResType = z.infer<typeof DepartmentStaffResSchema>;

/** Sinh lại danh sách trên trang từ CSDL. Ghi đè hẳn danh sách cũ. */
export const SyncStaffPageBodySchema = z.object({
  /** Chỉ lấy từ năm này trở đi. Bỏ trống = lấy tất cả. */
  fromYear: z.number().int().min(1950).max(2200).nullish(),
  includeProjects: z.boolean().optional(),
});
export type SyncStaffPageBodyType = z.infer<typeof SyncStaffPageBodySchema>;

export const UpdateStaffPageBodySchema = z.object({
  photo: z.string().max(1000).nullish(),
  /** Nền hero: mã màu hex (vd "#0c2340") hoặc rỗng để về nền tối mặc định. */
  heroBg: z.string().max(1000).nullish(),
  /** Kiểu hero: 'compact' (mặc định, ảnh nhỏ) hoặc 'full' (ảnh lớn). */
  heroLayout: z.enum(['compact', 'full']).nullish(),
  // Tên hiển thị trên trang (khác tên tài khoản dùng để ghép đơn vị). Song ngữ:
  // ghi vào cả `name` và `nameLines` (một dòng) để trình dựng trang hiện đúng.
  name: z.string().max(300).nullish(),
  nameEn: z.string().max(300).nullish(),
  eyebrow: z.string().max(200).nullish(),
  eyebrowEn: z.string().max(200).nullish(),
  intro: z.string().max(5000).nullish(),
  introEn: z.string().max(5000).nullish(),
  research: z.array(EntrySchema).max(50).optional(),
  teaching: z.array(EntrySchema).max(50).optional(),
  extras: z.array(ExtraSchema).max(50).optional(),
  publications: z.array(StaffPubSchema).max(300).optional(),
  /**
   * Khối "Thông tin chi tiết" (prop `html`), HTML thô do ô soạn thảo ở app gửi.
   * Trần rộng có chủ ý: nội dung này đi kèm MỌI lần lưu (kể cả khi không sửa nó),
   * nên trần phải lớn hơn mọi khối cũ để không chặn nhầm bản đang có.
   */
  legacyHtml: z.string().max(500000).nullish(),
  legacyHtmlEn: z.string().max(500000).nullish(),
});
export type UpdateStaffPageBodyType = z.infer<typeof UpdateStaffPageBodySchema>;

// ── Đề tài, dự án NCKH (Bảng 2 của Phụ lục 2) ───────────────────────────────
export const PROJECT_STATUSES = [
  'PROPOSED',
  'ONGOING',
  'COMPLETED',
  'FAILED',
] as const;
export const PROJECT_ROLES = ['LEAD', 'SECRETARY', 'MEMBER'] as const;

const ProjectYear = z.number().int().min(1950).max(2200);
const ProjectMonth = z.number().int().min(1).max(12);

export const ProjectMemberResSchema = z.object({
  id: z.string(),
  /** Trống = người ngoài hệ thống (cộng sự ngoài Khoa / ngoài Trường). */
  userId: z.string().nullable(),
  displayName: z.string(),
  email: z.string(),
  /** Cơ quan của người ngoài, nếu có khai. */
  externalOrg: z.string().nullable(),
  role: z.enum(PROJECT_ROLES),
  sharePercent: z.number().int().nullable(),
  /** Diện học viên — CHỈ ghi nhận cho thống kê, không tính giờ. */
  studentType: z.enum(STUDENT_TYPES).nullable(),
  claimStatus: z.enum(CLAIM_STATUSES),
  invitedBy: z.string().nullable(),
  respondedAt: z.date().nullable(),
});

export const ProjectResSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  decisionNo: z.string().nullable(),
  title: z.string(),
  catalogCode: z.string().nullable(),
  funder: z.string().nullable(),
  /** VND. Lưu BigInt trong CSDL, trả về dạng số thường. */
  budget: z.number().nullable(),
  status: z.enum(PROJECT_STATUSES),
  startYear: z.number().int().nullable(),
  startMonth: z.number().int().nullable(),
  endYear: z.number().int().nullable(),
  endMonth: z.number().int().nullable(),
  months: z.number().int().nullable(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  members: z.array(ProjectMemberResSchema),
  isClassified: z.boolean(),
  myRole: z.enum(PROJECT_ROLES).nullable(),
  myClaimStatus: z.enum(CLAIM_STATUSES).nullable(),
  myShowOnWeb: z.boolean(),
  mySharePercent: z.number().int().nullable(),
});

export const ProjectListResSchema = z.object({
  items: z.array(ProjectResSchema),
  total: z.number().int(),
  unclassified: z.number().int(),
});

export const CreateProjectBodySchema = z.object({
  title: z.string().min(1).max(500),
  code: OptionalText(100),
  /** Số quyết định phê duyệt — căn cứ của mốc "trong thời gian được phê duyệt". */
  decisionNo: OptionalText(100),
  /** Mã Bảng 2 — CHỦ NHIỆM tự chọn. Hệ thống không suy cấp đề tài từ kinh phí. */
  catalogCode: OptionalText(20),
  funder: OptionalText(300),
  budget: z.number().min(0).max(1e15).nullish(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startYear: ProjectYear.nullish(),
  startMonth: ProjectMonth.nullish(),
  endYear: ProjectYear.nullish(),
  endMonth: ProjectMonth.nullish(),
  /**
   * Số tháng thực hiện. CHỈ dùng khi thiếu mốc bắt đầu hoặc kết thúc — có đủ hai
   * mốc thì backend tự suy ra và bỏ qua giá trị gửi lên, để con số này không bao
   * giờ lệch với hai mốc kia.
   */
  months: z.number().int().min(1).max(240).nullish(),
  note: OptionalText(2000),
  myRole: z.enum(PROJECT_ROLES).optional(),
  mySharePercent: z.number().int().min(1).max(100).nullish(),
  /** Hiện đề tài này trên trang nhân sự của tôi. */
  myShowOnWeb: z.boolean().optional(),
  /**
   * Thành viên trong Khoa, kèm vai trò và phần được chia — nhận NGAY lúc tạo.
   * Trước đây chỉ nhận danh sách id, nên chủ nhiệm phải lưu rồi mở lại mới gán
   * được vai trò và tỷ lệ: hai lượt gọi cho một lần bấm.
   */
  members: z
    .array(
      z.object({
        userId: z.string(),
        role: z.enum(PROJECT_ROLES).optional(),
        sharePercent: z.number().int().min(1).max(100).nullish(),
        /** Diện học viên — CHỈ ghi nhận cho thống kê, không tính giờ. */
        studentType: StudentTypeField,
      }),
    )
    .max(50)
    .default([]),
  /**
   * Thành viên KHÔNG có tài khoản trong hệ thống — cộng sự ngoài Khoa, ngoài
   * Trường, hoặc ngoài đơn vị. Phụ lục 2 tr. 2.8 chia giờ cho MỌI thành viên của
   * nhiệm vụ, nên bỏ họ ra là làm phần của người trong Khoa phình lên.
   */
  externalMembers: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        org: OptionalText(300),
        role: z.enum(PROJECT_ROLES).optional(),
        sharePercent: z.number().int().min(1).max(100).nullish(),
        /** Diện học viên — CHỈ ghi nhận cho thống kê, không tính giờ. */
        studentType: StudentTypeField,
      }),
    )
    .max(50)
    .default([]),
});
export type CreateProjectBodyType = z.infer<typeof CreateProjectBodySchema>;

export const UpdateProjectBodySchema = CreateProjectBodySchema.partial().extend(
  {
    /**
     * Thành viên trong Khoa, kèm vai trò và phần được chia — nhận NGAY lúc tạo.
     * Trước đây chỉ nhận danh sách id, nên chủ nhiệm phải lưu rồi mở lại mới gán
     * được vai trò và tỷ lệ: hai lượt gọi cho một lần bấm.
     */
    members: z
      .array(
        z.object({
          userId: z.string(),
          role: z.enum(PROJECT_ROLES).optional(),
          sharePercent: z.number().int().min(1).max(100).nullish(),
        }),
      )
      .max(50)
      .optional(),
    /**
     * Vai trò và phương án chia giờ của CẢ NHÓM, do chủ nhiệm nộp (Phụ lục 2
     * tr. 2.8). Gộp làm một mảng chứ không tách hai: chúng được sửa cùng lúc
     * trên cùng một bảng, tách ra chỉ tạo cơ hội cho hai lần ghi lệch nhau.
     *
     * Tổng tỷ lệ không được vượt 100% — chia một lần cho cả đề tài, không phải
     * mỗi năm một bộ tỷ lệ.
     */
    memberUpdates: z
      .array(
        z.object({
          /** Id của DÒNG thành viên — dùng được cho cả người ngoài hệ thống. */
          memberId: z.string(),
          role: z.enum(PROJECT_ROLES).optional(),
          sharePercent: z.number().int().min(1).max(100).nullish(),
          /** Diện học viên — CHỈ ghi nhận cho thống kê, không tính giờ. */
          studentType: StudentTypeField,
        }),
      )
      .max(50)
      .optional(),
  },
);
export type UpdateProjectBodyType = z.infer<typeof UpdateProjectBodySchema>;

export const ListProjectsQuerySchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  filter: z.enum(['all', 'unclassified', 'pending']).optional(),
});
export type ListProjectsQueryType = z.infer<typeof ListProjectsQuerySchema>;

export const PendingProjectListResSchema = z.array(
  z.object({
    projectId: z.string(),
    title: z.string(),
    code: z.string().nullable(),
    funder: z.string().nullable(),
    year: z.number().int().nullable(),
    invitedBy: z.string().nullable(),
    invitedByName: z.string().nullable(),
  }),
);

export const ProjectClaimBodySchema = z.object({
  accept: z.boolean(),
  role: z.enum(PROJECT_ROLES).optional(),
});
export type ProjectClaimBodyType = z.infer<typeof ProjectClaimBodySchema>;

/** Trả DỮ KIỆN, không trả giờ — hệ số Bảng 2 nằm ở ACADsoom. */
export const IntegrationProjectResSchema = z.object({
  items: z.array(
    z.object({
      projectId: z.string(),
      code: z.string().nullable(),
      title: z.string(),
      catalogCode: z.string().nullable(),
      decisionNo: z.string().nullable(),
      funder: z.string().nullable(),
      budget: z.number().nullable(),
      status: z.enum(PROJECT_STATUSES),
      startYear: z.number().int().nullable(),
      startMonth: z.number().int().nullable(),
      endYear: z.number().int().nullable(),
      endMonth: z.number().int().nullable(),
      months: z.number().int().nullable(),
      role: z.enum(PROJECT_ROLES),
      isLead: z.boolean(),
      sharePercent: z.number().int().nullable(),
      /**
       * MẪU SỐ chia giờ: số thành viên mà giờ quy đổi của đề tài được chia cho.
       * Giống nhau trên mọi dòng của cùng một `projectId`.
       *
       * ĐẾM CẢ người ngoài Khoa — họ không có dòng riêng trong payload này (đã
       * lọc `userId != null`) nhưng vẫn chiếm phần theo Phụ lục 2 tr. 2.8, vốn
       * chia cho "các thành viên trong nhiệm vụ" chứ không riêng người của Khoa.
       * Bỏ họ ra là hai người thuộc Khoa của một đề tài năm người chia nhau đủ
       * 100%.
       *
       * Bên nhận KHÔNG suy ra được: đếm số dòng cùng `projectId` chỉ ra số người
       * CÓ TÀI KHOẢN. Cùng loại với `mainAuthorsAtSchool` ở công bố.
       */
      memberCount: z.number().int().min(1),

      email: z.string().nullable(),
      /** Bản ghi này KHÔNG còn được tính nữa (xoá / rút phân loại / rút xác nhận). */
      removed: z.boolean().optional(),
    }),
  ),
  ...INTEGRATION_CURSOR,
});
