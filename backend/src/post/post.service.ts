import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { PageLayoutRepository } from '../page-layout/page-layout.repo';
import { slugExistsInStatusException } from '../page-layout/page-layout.error';
import {
  PostNotFoundException,
  PostSlugExistsException,
  TemplateLayoutNotFoundException,
} from './post.error';
import {
  CloneIntoLayoutBodyType,
  LocalizedTextType,
  UpsertPostBodyType,
} from './post.model';
import { injectPostIntoPuckData, PostInjectPayload } from './puck-inject';
import {
  canAccessDepartment,
  departmentScopeWhere,
  isFacultyWide,
  FACULTY_DEPT_ID,
  toSlug,
  toSlugPath,
} from '../shared/helpers';
import { PublicRevalidateService } from '../shared/services/public-revalidate.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import type { InputJsonValue } from '../generated/prisma/internal/prismaNamespace';
import type { JsonValue } from '../generated/prisma/internal/prismaNamespace';

// JsonValue → { vi, en? } payload. Tolerates legacy plain-string field values
// that may slip through during the migration window.
const asLocalized = (
  value: JsonValue | null | undefined,
): LocalizedTextType | null => {
  if (value == null) return null;
  if (typeof value === 'string') return { vi: value };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const vi = typeof obj.vi === 'string' ? obj.vi : '';
    const en = typeof obj.en === 'string' ? obj.en : undefined;
    if (vi || en) return { vi: vi || en || '', en };
  }
  return null;
};

const viOf = (value: JsonValue | null | undefined): string => {
  const l = asLocalized(value);
  return l ? l.vi || l.en || '' : '';
};

const postInclude = {
  postTags: { include: { tag: true } },
  layouts: {
    select: {
      id: true,
      name: true,
      slug: true,
      isPublished: true,
      scheduledAt: true,
      publishedAt: true,
      // Trình soạn bài cần biết trang đang thuộc danh mục nào để tick lại đúng
      // khi mở bài cũ ra sửa.
      categoryLinks: { select: { categoryId: true } },
    },
  },
} as const;

// Projection for LIST endpoints: everything the list serializers need but WITHOUT
// the heavy `body` JSON tree. Detail endpoints (findById/create/update) keep using
// `postInclude`, which returns the full row incl. body. Cutting body here is what
// makes the admin "Bài của tôi" list (pageSize 100) small instead of ~2 MB.
const postListSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  departmentId: true,
  status: true,
  reviewNote: true,
  coverMediaId: true,
  coverUrl: true,
  coverAlt: true,
  eventStartAt: true,
  eventEndAt: true,
  eventLocation: true,
  publishedAt: true,
  scheduledAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  postTags: { include: { tag: true } },
  layouts: {
    select: {
      id: true,
      name: true,
      slug: true,
      isPublished: true,
      scheduledAt: true,
      publishedAt: true,
      // Trình soạn bài cần biết trang đang thuộc danh mục nào để tick lại đúng
      // khi mở bài cũ ra sửa.
      categoryLinks: { select: { categoryId: true } },
    },
  },
} as const;

type PostListRecord = Prisma.PostGetPayload<{ select: typeof postListSelect }>;

// A post is publicly visible only once it has at least one PUBLISHED layout
// (the public site resolves an article by its published layout; without one the
// standalone URL 404s). This clause keeps such "orphan" posts out of the feeds.
// A post is only public if it has a published layout that has NOT been soft-deleted.
const HAS_PUBLISHED_LAYOUT = {
  layouts: { some: { isPublished: true, deletedAt: null } },
} as const;
// Bài CÒN HIỆN công khai. Cố tình KHÔNG khoá theo `status === 'PUBLISHED'`: hẹn
// giờ một bản CẬP NHẬT cho bài đang sống sẽ đưa status về SCHEDULED, mà bài đó
// vẫn phải nằm trong danh sách/feed — chỉ NỘI DUNG MỚI là chờ tới giờ, còn bản
// đang xuất bản không được biến mất khỏi trang chủ trong lúc chờ.
// `publishedAt` là mốc phân biệt: bài chưa từng xuất bản thì nó null.
const PUBLICLY_VISIBLE: Prisma.PostWhereInput = {
  publishedAt: { not: null },
  ...HAS_PUBLISHED_LAYOUT,
};
// Soft-delete: exclude trashed rows from every normal (non-trash) query.
const NOT_DELETED = { deletedAt: null } as const;

// Bài rỗng nội dung chỉ bị ẩn khỏi feed công khai khi nó là bài DI TRÚ (nguồn cũ
// vốn không có nội dung) — nhận biết bằng legacyId. Bài SOẠN TRÊN CMS luôn hiện:
// trước đây luật này ẩn luôn cả chúng nên biên tập viên đăng bài xong không thấy
// bài đâu mà cũng không được báo gì. Bài SỰ KIỆN vẫn được miễn vì chỉ cần thời
// gian/địa điểm.
const HAS_PUBLIC_CONTENT: Prisma.PostWhereInput = {
  OR: [
    { body: { not: Prisma.DbNull } },
    { eventStartAt: { not: null } },
    { legacyId: null },
  ],
};
// Bộ lọc theo danh mục đi qua LAYOUT: danh mục thuộc về layout mà bài được rót
// vào, nên một bài rót vào nhiều layout sẽ hiện dưới nhiều danh mục. Bản công
// khai chỉ tính layout đã xuất bản và chưa bị xoá.
const categoryWhere = (slug: string, publicOnly: boolean) => ({
  layouts: {
    some: {
      categoryLinks: { some: { category: { slug } } },
      ...(publicOnly ? { isPublished: true, deletedAt: null } : {}),
    },
  },
});

// Items in the trash are permanently purged this long after deletion.
const TRASH_RETENTION_DAYS = 30;

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pageLayoutRepo: PageLayoutRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly publicRevalidate: PublicRevalidateService,
    private readonly chatbot: ChatbotService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'publishDuePosts' })
  async handleScheduledPublish() {
    const now = new Date();
    const due = await this.prisma.post.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
        ...NOT_DELETED,
      },
      select: { id: true, publishedAt: true },
    });
    if (due.length === 0) return;
    for (const row of due) {
      try {
        await this.prisma.post.update({
          where: { id: row.id },
          data: {
            status: 'PUBLISHED',
            // Hẹn giờ một bản CẬP NHẬT cho bài đã xuất bản thì giữ ngày đăng
            // gốc, không dời sang thời điểm cập nhật.
            publishedAt: row.publishedAt ?? now,
            scheduledAt: null,
          },
        });
        // Đúng thời điểm lên sóng → bản công khai được thay ở đây.
        await this.syncAttachedLayouts(row.id, { publishLive: true });
        await this.chatbot.indexPost(row.id).catch((e) =>
          this.logger.error(`Chatbot index failed for ${row.id}`, e as Error),
        );
        this.logger.log(`Auto-published scheduled post ${row.id}`);
      } catch (err) {
        this.logger.error(
          `Failed to auto-publish post ${row.id}`,
          err as Error,
        );
      }
    }
    await this.syncNewsFeedSnapshots();
    await this.cache.clear();
    this.publicRevalidate.trigger([
      'sitemap',
      ...due.map((r) => `post:${r.id}`),
    ]);
  }

  /**
   * Dữ liệu cho holder đa phương tiện (thư viện ảnh, video) cất trong cột Json
   * `metadata` sẵn có — tránh phải thêm cột vào CSDL đang chạy.
   * Chỉ ghi đè khoá nào client thực sự gửi lên, giữ nguyên phần còn lại.
   */
  private mediaMetadata(
    current: unknown,
    body: UpsertPostBodyType,
  ): Prisma.InputJsonValue {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
    const next = { ...base };
    if (body.gallery !== undefined) next.gallery = body.gallery;
    if (body.videoUrl !== undefined) next.videoUrl = body.videoUrl;
    if (body.videoCaption !== undefined) next.videoCaption = body.videoCaption;
    return next as Prisma.InputJsonValue;
  }

  /** Bóc dữ liệu đa phương tiện ra khỏi `metadata` để trả cho giao diện. */
  private readMedia(metadata: unknown) {
    const m =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      gallery: Array.isArray(m.gallery)
        ? (m.gallery as { src: string; alt: string }[])
        : [],
      videoUrl: typeof m.videoUrl === 'string' ? m.videoUrl : null,
      videoCaption:
        m.videoCaption && typeof m.videoCaption === 'object'
          ? (m.videoCaption as Record<string, string>)
          : null,
    };
  }

  // Ngày đăng do Super Admin chỉ định (lùi về quá khứ). Role khác gửi lên bị bỏ qua.
  private backdateFor(
    roleName: string,
    publishedAt: string | null | undefined,
  ): Date | null {
    if (roleName === 'SUPER_ADMIN' && publishedAt) return new Date(publishedAt);
    return null;
  }

  async create(
    body: UpsertPostBodyType,
    userId: string,
    departmentId: string | null,
    roleName: string,
  ) {
    const slug = toSlug(body.slug || body.title.vi);
    const existing = await this.prisma.post.findUnique({ where: { slug } });
    if (existing) throw PostSlugExistsException;
    const tagIds = await this.upsertTagIds(body.tagSlugs ?? []);
    const status = body.status ?? 'DRAFT';
    const scheduledAtValue =
      status === 'SCHEDULED' && body.scheduledAt
        ? new Date(body.scheduledAt)
        : null;
    const backdate = this.backdateFor(roleName, body.publishedAt);
    const created = await this.prisma.post.create({
      data: {
        title: body.title,
        slug,
        body: body.body ?? undefined,
        excerpt: body.excerpt ?? undefined,
        status,
        publishedAt:
          status === 'PUBLISHED' ? (backdate ?? new Date()) : null,
        scheduledAt: scheduledAtValue,
        coverMediaId: body.coverMediaId ?? null,
        coverUrl: body.coverUrl ?? null,
        coverAlt: body.coverAlt ?? null,
        eventStartAt: body.eventStartAt ? new Date(body.eventStartAt) : null,
        eventEndAt: body.eventEndAt ? new Date(body.eventEndAt) : null,
        eventLocation: body.eventLocation ?? null,
        metadata: this.mediaMetadata(null, body),
        createdBy: userId,
        departmentId: departmentId ?? null,
        postTags: {
          create: tagIds.map((tagId) => ({ tagId })),
        },
      },
      include: postInclude,
    });
    if (created.status === 'PUBLISHED') {
      await this.syncNewsFeedSnapshots();
      await this.chatbot.indexPost(created.id).catch(() => undefined);
      this.publicRevalidate.trigger(['sitemap', `post:${created.id}`]);
    }
    return this.serialize(created);
  }

  async update(
    id: string,
    body: UpsertPostBodyType,
    userId: string,
    roleName: string,
    departmentId: string | null,
  ) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw PostNotFoundException;
    if (!canAccessDepartment(roleName, departmentId, existing.departmentId)) {
      throw PostNotFoundException;
    }
    const slug = toSlug(body.slug || body.title.vi);
    if (slug !== existing.slug) {
      const other = await this.prisma.post.findUnique({ where: { slug } });
      if (other && other.id !== id) throw PostSlugExistsException;
    }
    const tagIds = await this.upsertTagIds(body.tagSlugs ?? []);
    const nextStatus = body.status ?? existing.status;
    const becamePublished =
      nextStatus === 'PUBLISHED' && existing.status !== 'PUBLISHED';
    // Hẹn giờ cho bài ĐANG xuất bản là hẹn một bản CẬP NHẬT, không phải rút bài
    // xuống: giữ nguyên publishedAt để bài vẫn còn công khai (PUBLICLY_VISIBLE)
    // và không mất ngày đăng gốc. Chỉ khi về nháp/lưu trữ mới xoá mốc đó.
    const leftPublished =
      existing.status === 'PUBLISHED' &&
      nextStatus !== 'PUBLISHED' &&
      nextStatus !== 'SCHEDULED';
    // Super Admin có thể LÙI ngày đăng: kể cả bài đang xuất bản, đổi publishedAt
    // về mốc quá khứ đã chọn. CHỈ áp khi KẾT QUẢ là PUBLISHED — nếu đang gỡ bài
    // xuống nháp/lưu trữ thì phải để leftPublished xoá publishedAt (null), nếu
    // không bài vẫn công khai dù đã về nháp.
    const backdate = this.backdateFor(roleName, body.publishedAt);
    const publishedAtPatch =
      backdate && nextStatus === 'PUBLISHED'
        ? { publishedAt: backdate }
        : becamePublished
          ? { publishedAt: new Date() }
          : leftPublished
            ? { publishedAt: null }
            : {};
    const scheduledAtValue =
      nextStatus === 'SCHEDULED' && body.scheduledAt
        ? new Date(body.scheduledAt)
        : null;
    // Đang hẹn giờ ở tương lai → giữ nguyên bản công khai, nội dung mới chỉ nằm
    // ở bản nháp cho tới khi cron tới giờ.
    const holdLive = Boolean(
      scheduledAtValue && scheduledAtValue.getTime() > Date.now(),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.postTag.deleteMany({ where: { postId: id } });
      return tx.post.update({
        where: { id },
        data: {
          title: body.title as unknown as InputJsonValue,
          slug,
          body: (body.body ?? undefined) as InputJsonValue | undefined,
          excerpt: (body.excerpt ?? undefined) as InputJsonValue | undefined,
            status: nextStatus,
          scheduledAt: scheduledAtValue,
          ...publishedAtPatch,
          coverMediaId: body.coverMediaId ?? null,
          coverUrl: body.coverUrl ?? null,
          coverAlt: body.coverAlt ?? null,
          eventStartAt: body.eventStartAt ? new Date(body.eventStartAt) : null,
          eventEndAt: body.eventEndAt ? new Date(body.eventEndAt) : null,
          eventLocation: body.eventLocation ?? null,
          metadata: this.mediaMetadata(existing.metadata, body),
          postTags: {
            create: tagIds.map((tagId) => ({ tagId })),
          },
        },
        include: postInclude,
      });
    });
    const affectedSlugs = await this.syncAttachedLayouts(id, {
      publishLive: !holdLive,
    });
    if (updated.status === 'PUBLISHED' || existing.status === 'PUBLISHED') {
      await this.syncNewsFeedSnapshots();
    }
    await this.cache.clear();
    if (updated.status === 'PUBLISHED' || existing.status === 'PUBLISHED') {
      await this.chatbot.indexPost(id).catch(() => undefined);
    }
    this.publicRevalidate.trigger([
      'sitemap',
      `post:${id}`,
      ...affectedSlugs.map((s) => `page:${s}`),
    ]);
    return this.serialize(updated);
  }

  async list(userId: string, roleName: string, departmentId: string | null) {
    const posts = await this.prisma.post.findMany({
      where: {
        ...NOT_DELETED,
        ...((departmentScopeWhere(roleName, departmentId) ?? {}) as any),
      },
      orderBy: { updatedAt: 'desc' },
      select: postListSelect,
    });
    return posts.map((p) => this.serializeListItem(p));
  }

  // Tìm kiếm bài viết KHÔNG phân biệt hoa/thường VÀ không phân biệt dấu.
  // `string_contains` của Prisma trên cột Json phân biệt cả hoa/thường lẫn dấu,
  // nên "viện hàng không" không khớp "Viện Hàng không" (và "vien hang khong"
  // càng không). Ở đây dùng unaccent(lower(...)) trên tiêu đề/tóm tắt/slug để
  // gom id khớp, rồi ràng buộc theo id — cho phép gõ có dấu hoặc không dấu.
  private async searchPostIdWhere(
    q: string,
  ): Promise<Record<string, unknown>> {
    const like = `%${q.toLowerCase()}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Post"
      WHERE unaccent(lower(coalesce("title"->>'vi', ''))) LIKE unaccent(${like})
         OR unaccent(lower(coalesce("title"->>'en', ''))) LIKE unaccent(${like})
         OR unaccent(lower(coalesce("excerpt"->>'vi', ''))) LIKE unaccent(${like})
         OR unaccent(lower(coalesce("excerpt"->>'en', ''))) LIKE unaccent(${like})
         OR unaccent(lower("slug")) LIKE unaccent(${like})
    `;
    return { id: { in: rows.map((r) => r.id) } };
  }

  async listAdminPaged(params: {
    page: number;
    pageSize: number;
    category?: string;
    status?: string;
    search?: string;
    userId: string;
    roleName: string;
    departmentId: string | null;
    deleted?: boolean;
  }) {
    const {
      page,
      pageSize,
      category,
      status,
      search,
      roleName,
      departmentId,
      deleted,
    } = params;
    const andClauses: Record<string, unknown>[] = [];
    const scope = departmentScopeWhere(roleName, departmentId);
    if (scope) andClauses.push(scope);
    if (search && search.trim()) {
      andClauses.push(await this.searchPostIdWhere(search.trim()));
    }
    const where: Record<string, unknown> = {};
    if (category) Object.assign(where, categoryWhere(category, false));
    if (status) where.status = status;
    if (deleted) {
      // Trash view: only rows soft-deleted within the retention window (older ones
      // are purged by cron, but guard here too so nothing past 30 days shows).
      const cutoff = new Date(
        Date.now() - TRASH_RETENTION_DAYS * 86400000,
      );
      where.deletedAt = { not: null, gte: cutoff };
    } else {
      where.deletedAt = null;
    }
    if (andClauses.length) where.AND = andClauses;
    const [total, posts] = await Promise.all([
      this.prisma.post.count({ where: where as any }),
      this.prisma.post.findMany({
        where: where as any,
        orderBy: deleted ? { deletedAt: 'desc' } : { updatedAt: 'desc' },
        select: postListSelect,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: posts.map((p) => this.serializeListItem(p)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // Scope a public feed by department. Default (no arg) = faculty homepage/main
  // feed: only faculty-office + untagged posts, so bộ-môn posts never surface on
  // the Khoa homepage. Pass a dept slug for a department page's own feed.
  private feedDeptWhere(department?: string): Record<string, unknown> {
    if (department && department.trim()) {
      return { department: { slug: department.trim() } };
    }
    return { OR: [{ departmentId: FACULTY_DEPT_ID }, { departmentId: null }] };
  }

  /**
   * Feed Khoa + bài của các ĐƠN VỊ (Đoàn–Hội, CLB… — `kind='unit'`). Dùng cho
   * trang tin khi đã lọc theo MỘT danh mục cụ thể: đơn vị cố ý không lên trang
   * chủ, nhưng phải hiện được trong chính danh mục của nó.
   */
  private feedDeptWhereWithUnits(): Record<string, unknown> {
    return {
      OR: [
        { departmentId: FACULTY_DEPT_ID },
        { departmentId: null },
        { department: { kind: 'unit' } },
      ],
    };
  }

  // By resolved departmentId (used when snapshotting per-layout).
  private feedDeptWhereById(
    departmentId: string | null,
  ): Record<string, unknown> {
    if (!departmentId || departmentId === FACULTY_DEPT_ID) {
      return { OR: [{ departmentId: FACULTY_DEPT_ID }, { departmentId: null }] };
    }
    return { departmentId };
  }

  async listLatestPublic(limit: number, deptWhere?: Record<string, unknown>) {
    const now = new Date();
    const posts = await this.prisma.post.findMany({
      where: {
        ...NOT_DELETED,
        // chỉ công khai bài đã gắn vào một layout đã xuất bản (nếu không, URL bài lẻ 404)
        ...PUBLICLY_VISIBLE,
        AND: [
          deptWhere ?? this.feedDeptWhere(),
          { OR: [{ eventStartAt: null }, { eventStartAt: { lt: now } }] },
          HAS_PUBLIC_CONTENT,
        ],
      },
      // Sắp theo NGÀY ĐĂNG GỐC (publishedAt) để tin mới viết gần đây luôn ở đầu;
      // bài cũ (2021…) dù mới di trú/sửa cũng không nhảy lên trang chủ.
      orderBy: { publishedAt: 'desc' },
      select: postListSelect,
      // Over-fetch để ảnh bìa phá hoà khi cùng ngày (bài có bìa lên trước bài không).
      take: Math.max(limit * 3, limit),
    });
    const dateOf = (x: PostListRecord) =>
      +new Date(x.publishedAt ?? x.updatedAt);
    const sorted = posts.sort((a, b) => {
      const d = dateOf(b) - dateOf(a); // mới viết gần đây nhất trước
      if (d !== 0) return d;
      // Hoà ngày → ưu tiên bài có ảnh bìa (bài không bìa dùng logo mặc định).
      return (b.coverUrl ? 1 : 0) - (a.coverUrl ? 1 : 0);
    });
    return sorted.slice(0, limit).map((p) => this.serializePublic(p));
  }

  async listUpcomingEventsPublic(
    limit: number,
    deptWhere?: Record<string, unknown>,
  ) {
    const now = new Date();
    const posts = await this.prisma.post.findMany({
      where: {
        ...NOT_DELETED,
        // KHÔNG buộc có body: sự kiện có thể chỉ gồm thông tin thời gian/địa điểm
        // (không có nội dung bài) mà vẫn phải hiện ở "Sự kiện sắp tới".
        ...PUBLICLY_VISIBLE,
        AND: [deptWhere ?? this.feedDeptWhere()],
        eventStartAt: { gte: now },
      },
      orderBy: { eventStartAt: 'asc' },
      select: postListSelect,
      take: limit,
    });
    return posts.map((p) => this.serializePublic(p));
  }

  async listPagedPublic(params: {
    page: number;
    pageSize: number;
    category?: string;
    department?: string;
    fromDate?: Date;
    toDate?: Date;
    search?: string;
  }) {
    const { page, pageSize, category, department, fromDate, toDate, search } =
      params;
    const where: Record<string, unknown> = {
      ...NOT_DELETED,
      ...PUBLICLY_VISIBLE,
      // Faculty feed by default; a dept slug narrows to that department's posts.
      // Khi người xem đã CHỌN ĐÚNG MỘT DANH MỤC thì nới thêm bài của các ĐƠN VỊ
      // (Đoàn–Hội, CLB — kind='unit'): chúng cố ý không lên trang chủ, nhưng nếu
      // feed Khoa lọc luôn ở đây thì bài của đơn vị không hiện được ở BẤT KỲ đâu,
      // kể cả trong chính danh mục của nó.
      AND: [
        category && !department
          ? this.feedDeptWhereWithUnits()
          : this.feedDeptWhere(department),
        HAS_PUBLIC_CONTENT,
      ],
    };
    if (category) Object.assign(where, categoryWhere(category, true));
    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate) range.gte = fromDate;
      if (toDate) range.lte = toDate;
      // Lọc theo ngày ĐĂNG GỐC cho khớp cột ngày hiển thị + sắp xếp.
      where.publishedAt = range;
    }
    if (search && search.trim()) {
      (where.AND as Record<string, unknown>[]).push(
        await this.searchPostIdWhere(search.trim()),
      );
    }
    const [total, posts] = await Promise.all([
      this.prisma.post.count({ where: where as any }),
      this.prisma.post.findMany({
        where: where as any,
        // Danh sách/tin tức/tìm kiếm: sắp theo ngày đăng gốc (mới viết trước).
        orderBy: { publishedAt: 'desc' },
        select: postListSelect,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: posts.map((p) => this.serializePublic(p)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  private serializePublic(record: PostListRecord) {
    const publishedLayout = record.layouts.find((l) => l.isPublished) ?? null;
    return {
      id: record.id,
      title: asLocalized(record.title),
      slug: record.slug,
      excerpt: asLocalized(record.excerpt),
      coverUrl: record.coverUrl,
      coverAlt: record.coverAlt,
      eventStartAt: record.eventStartAt,
      eventEndAt: record.eventEndAt,
      eventLocation: record.eventLocation,
      // Ngày HIỂN THỊ = ngày đăng GỐC (publishedAt), KHÔNG dùng updatedAt (là ngày
      // di trú/chỉnh sửa) — nếu không bài cũ 2021 sửa lại năm 2026 sẽ mang nhãn 2026
      // và nhảy lên đầu feed. Fallback updatedAt phòng khi thiếu (thực tế 0 bài null).
      publishedAt: record.publishedAt ?? record.updatedAt,
      layoutSlug: publishedLayout?.slug ?? null,
      // Tag icons (e.g. SDG badges) shown under the card on the public site.
      tags: record.postTags.map((pt) => ({
        slug: pt.tag.slug,
        name: pt.tag.name,
        icon: pt.tag.icon,
      })),
    };
  }

  async findById(
    id: string,
    userId: string,
    roleName: string,
    departmentId: string | null,
  ) {
    const record = await this.findByIdOrThrow(id);
    if (!canAccessDepartment(roleName, departmentId, record.departmentId)) {
      throw PostNotFoundException;
    }
    return this.serialize(record);
  }

  async delete(
    id: string,
    userId: string,
    roleName: string,
    departmentId: string | null,
  ) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw PostNotFoundException;
    if (!canAccessDepartment(roleName, departmentId, existing.departmentId)) {
      throw PostNotFoundException;
    }
    // Layouts created from this post become meaningless once the post is gone,
    // so delete them too (and remember their slugs to revalidate the public site).
    const attached = await this.prisma.pageLayout.findMany({
      where: { sourcePostId: id },
      select: { slug: true },
    });
    // Soft delete: stamp deletedAt on the post + its layouts so they drop out of
    // every public/admin query but can be restored within the retention window.
    // A daily cron (purgeExpiredTrash) hard-deletes anything older than 30 days.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.pageLayout.updateMany({
        where: { sourcePostId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.post.update({ where: { id }, data: { deletedAt: now } });
    });
    await this.cache.clear();
    // Revalidate trang của bài + layout NGAY (nhanh).
    this.publicRevalidate.trigger([
      'sitemap',
      `post:${id}`,
      ...attached.map((l) => `page:${l.slug}`),
    ]);
    if (existing.status === 'PUBLISHED') {
      // Dựng lại snapshot feed duyệt ~1900 layout → CHẠY NỀN (không await) để phản
      // hồi trả về ngay (toast hiện tức thì thay vì chờ vài giây); xong thì
      // revalidate các trang feed (trang chủ/mục).
      void this.syncNewsFeedSnapshots()
        .then((r) =>
          this.publicRevalidate.trigger([
            'sitemap',
            ...r.slugs.map((s) => `page:${s}`),
          ]),
        )
        .catch(() => undefined);
    }
    return { ok: true };
  }

  // Restore a soft-deleted post (and the layouts deleted alongside it) back into
  // the system. Only works while the post is still within the retention window.
  async restore(
    id: string,
    userId: string,
    roleName: string,
    departmentId: string | null,
  ) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing || !existing.deletedAt) throw PostNotFoundException;
    if (!canAccessDepartment(roleName, departmentId, existing.departmentId)) {
      throw PostNotFoundException;
    }
    const deletedAt = existing.deletedAt;
    const attached = await this.prisma.pageLayout.findMany({
      where: { sourcePostId: id },
      select: { slug: true },
    });
    await this.prisma.$transaction(async (tx) => {
      // Only un-delete layouts that were trashed together with this post (same
      // timestamp), so a layout the user deleted separately stays in the trash.
      await tx.pageLayout.updateMany({
        where: { sourcePostId: id, deletedAt },
        data: { deletedAt: null },
      });
      await tx.post.update({ where: { id }, data: { deletedAt: null } });
    });
    await this.cache.clear();
    // Revalidate trang của bài + layout NGAY (nhanh).
    this.publicRevalidate.trigger([
      'sitemap',
      `post:${id}`,
      ...attached.map((l) => `page:${l.slug}`),
    ]);
    if (existing.status === 'PUBLISHED') {
      // Dựng lại snapshot feed duyệt ~1900 layout → CHẠY NỀN (không await) để phản
      // hồi trả về ngay (toast hiện tức thì thay vì chờ vài giây); xong thì
      // revalidate các trang feed (trang chủ/mục).
      void this.syncNewsFeedSnapshots()
        .then((r) =>
          this.publicRevalidate.trigger([
            'sitemap',
            ...r.slugs.map((s) => `page:${s}`),
          ]),
        )
        .catch(() => undefined);
    }
    return { ok: true };
  }

  // Permanently remove a single trashed post on demand ("Xóa vĩnh viễn"), instead of
  // waiting for the retention window to expire. Nothing here is recoverable.
  async purge(
    id: string,
    userId: string,
    roleName: string,
    departmentId: string | null,
  ) {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    // Only posts already in the trash can be purged — a live post must be deleted
    // (soft) first, so the destructive step always goes through the trash tab.
    if (!existing || !existing.deletedAt) throw PostNotFoundException;
    if (!canAccessDepartment(roleName, departmentId, existing.departmentId)) {
      throw PostNotFoundException;
    }
    const attached = await this.prisma.pageLayout.findMany({
      where: { sourcePostId: id },
      select: { slug: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.pageLayout.deleteMany({ where: { sourcePostId: id } });
      await tx.postTag.deleteMany({ where: { postId: id } });
      await tx.post.deleteMany({ where: { id } });
    });
    await this.cache.clear();
    this.publicRevalidate.trigger([
      'sitemap',
      `post:${id}`,
      ...attached.map((l) => `page:${l.slug}`),
    ]);
    return { ok: true };
  }

  // Permanently remove posts + layouts that have been in the trash longer than the
  // retention window. Runs daily; nothing here is recoverable afterwards.
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'purgeExpiredTrash' })
  async purgeExpiredTrash() {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400000);
    const expiredPosts = await this.prisma.post.findMany({
      where: { deletedAt: { not: null, lt: cutoff } },
      select: { id: true },
    });
    // Layouts deleted on their own (no live source post) also expire.
    const expiredLayouts = await this.prisma.pageLayout.findMany({
      where: { deletedAt: { not: null, lt: cutoff } },
      select: { id: true },
    });
    if (expiredPosts.length === 0 && expiredLayouts.length === 0) return;
    const postIds = expiredPosts.map((p) => p.id);
    await this.prisma.$transaction(async (tx) => {
      // Remove layouts of expiring posts first, then any independently-expired ones.
      if (postIds.length) {
        await tx.pageLayout.deleteMany({ where: { sourcePostId: { in: postIds } } });
        await tx.postTag.deleteMany({ where: { postId: { in: postIds } } });
        await tx.post.deleteMany({ where: { id: { in: postIds } } });
      }
      const layoutIds = expiredLayouts.map((l) => l.id);
      if (layoutIds.length) {
        await tx.pageLayout.deleteMany({
          where: { id: { in: layoutIds }, deletedAt: { not: null, lt: cutoff } },
        });
      }
    });
    this.logger.log(
      `Purged ${expiredPosts.length} post(s) + ${expiredLayouts.length} layout(s) past ${TRASH_RETENTION_DAYS}d retention`,
    );
  }

  async cloneIntoLayout(
    postId: string,
    body: CloneIntoLayoutBodyType,
    userId: string,
    roleName: string,
    departmentId: string | null,
  ) {
    const post = await this.findByIdOrThrow(postId);
    if (!canAccessDepartment(roleName, departmentId, post.departmentId)) {
      throw PostNotFoundException;
    }
    // MỘT bài = MỘT trang. Bài đã có trang rồi thì chỉ cập nhật danh mục cho nó,
    // không đẻ thêm layout thứ hai — trước đây mỗi danh mục một layout nên cùng
    // nội dung nằm ở nhiều URL khác nhau.
    const existingLayout = await this.prisma.pageLayout.findFirst({
      where: { sourcePostId: post.id, deletedAt: null },
      select: { id: true, slug: true },
      orderBy: { createdAt: 'asc' },
    });
    const template = await this.prisma.pageLayout.findUnique({
      where: { id: body.templateLayoutId },
      select: {
        id: true,
        slug: true,
        puckData: true,
        categoryId: true,
        category: { select: { slug: true, name: true } },
      },
    });
    if (!template) throw TemplateLayoutNotFoundException;

    // Enforce that a bộ-môn post's layout lives under that department's slug so
    // it can never be published at the faculty root (/, /tin-tuc). Faculty and
    // untagged posts keep the template-derived path.
    let deptSlug: string | null = null;
    // Danh muc mac dinh cua don vi (CLB, Doan-Hoi): bai cua don vi LUON duoc gan
    // danh muc nay, khong phu thuoc nguoi dang co nho tick hay khong.
    let unitCategoryId: string | null = null;
    if (post.departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: post.departmentId },
        select: { slug: true, defaultCategoryId: true },
      });
      if (post.departmentId !== FACULTY_DEPT_ID) deptSlug = dept?.slug ?? null;
      unitCategoryId = dept?.defaultCategoryId ?? null;
    }
    // Faculty/untagged posts publish under the news prefix (/tin-tuc/<slug>);
    // bộ-môn posts stay under their department slug (never at the faculty root).
    let layoutSlug: string;
    if (body.layoutSlug) {
      layoutSlug = toSlugPath(body.layoutSlug);
      if (
        deptSlug &&
        layoutSlug !== deptSlug &&
        !layoutSlug.startsWith(`${deptSlug}/`)
      ) {
        layoutSlug = toSlugPath(`${deptSlug}/${layoutSlug}`);
      }
    } else if (deptSlug) {
      // Bài sự kiện của bộ môn: <deptSlug>/su-kien/<slug>; còn lại giữ nguyên.
      layoutSlug = post.eventStartAt
        ? toSlugPath(`${deptSlug}/su-kien/${post.slug}`)
        : toSlugPath(`${deptSlug}/${post.slug}`);
    } else {
      // Bài có ngày giờ sự kiện → đường dẫn /su-kien/<slug>; tin tức thường →
      // /tin-tuc/<slug>. Nhờ vậy sự kiện có URL riêng, tách khỏi luồng tin tức.
      layoutSlug = post.eventStartAt
        ? toSlugPath(`su-kien/${post.slug}`)
        : toSlugPath(`tin-tuc/${post.slug}`);
    }
    // Cùng MỘT bài có thể rót vào NHIỀU layout (mỗi layout một đường dẫn). Slug
    // suy ra từ slug bài nên rót lần 2 sẽ trùng → tự thêm hậu tố -2, -3… cho tới
    // khi slug chưa tồn tại, thay vì báo lỗi "trùng slug". Có thể đổi lại slug
    // trong trình sửa layout sau.
    const baseSlug = layoutSlug;
    let suffix = 1;
    while (
      await this.pageLayoutRepo.findConflictBySlugAndStatus(layoutSlug, false)
    ) {
      suffix += 1;
      layoutSlug = toSlugPath(`${baseSlug}-${suffix}`);
    }

    // Danh mục đi theo LAYOUT chứ không theo bài: cùng một bài rót vào "Layout
    // mẫu — Câu lạc bộ" và "Layout mẫu — Tin khoa học" thì mỗi trang mang danh
    // mục của layout đó, và bài hiện dưới CẢ HAI bộ lọc. Trước đây luôn bơm danh
    // mục của bài nên trang câu lạc bộ vẫn hiện breadcrumb "Tin học vụ".
    // Người dùng chọn danh mục ở trình soạn bài; không chọn thì dùng của layout
    // mẫu (vd bài sự kiện luôn là danh mục Sự kiện).
    const requested = Array.from(new Set(body.categoryIds ?? [])).filter(Boolean);
    const picked = requested.length
      ? requested
      : template.categoryId
        ? [template.categoryId]
        : [];
    // Bai cua mot DON VI (Doan-Hoi, CLB...) LUON mang danh muc cua don vi do.
    // Truoc day nguoi dang phai tu nho tick; quen la bai khong hien trong muc cua
    // chinh minh. Ep o backend nen khong the bo sot.
    const categoryIds =
      unitCategoryId && !picked.includes(unitCategoryId)
        ? [...picked, unitCategoryId]
        : picked;
    const primaryCategoryId = categoryIds[0] ?? template.categoryId ?? null;
    const layoutCategory = primaryCategoryId
      ? await this.prisma.category.findUnique({
          where: { id: primaryCategoryId },
          select: { slug: true, name: true },
        })
      : null;
    const injectPayload: PostInjectPayload = {
      title: asLocalized(post.title) ?? { vi: '' },
      body: asLocalized(post.body) ?? { vi: '' },
      excerpt: asLocalized(post.excerpt),
      coverUrl:
        post.coverUrl ?? (post.coverMedia ? post.coverMedia.url : null) ?? null,
      coverAlt: post.coverAlt ?? null,
      tags: post.postTags.map((pt) => ({
        slug: pt.tag.slug,
        name: pt.tag.name,
        icon: pt.tag.icon,
      })),
      category: layoutCategory?.slug ?? '',
      categoryLabel: asLocalized(layoutCategory?.name) ?? { vi: '' },
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
      eventStartAt: post.eventStartAt ? post.eventStartAt.toISOString() : null,
      eventEndAt: post.eventEndAt ? post.eventEndAt.toISOString() : null,
      eventLocation: post.eventLocation ?? null,
      ...this.readMedia(post.metadata),
    };
    const injectedTree = injectPostIntoPuckData(
      template.puckData,
      injectPayload,
    );

    if (existingLayout) {
      await this.prisma.$transaction([
        this.prisma.pageLayout.update({
          where: { id: existingLayout.id },
          data: { categoryId: primaryCategoryId },
        }),
        this.prisma.pageLayoutCategoryLink.deleteMany({
          where: { pageLayoutId: existingLayout.id },
        }),
        this.prisma.pageLayoutCategoryLink.createMany({
          data: categoryIds.map((categoryId) => ({
            pageLayoutId: existingLayout.id,
            categoryId,
          })),
          skipDuplicates: true,
        }),
      ]);
      // Bơm lại nội dung + breadcrumb theo danh mục mới. Chỉ vào bản nháp: hàm
      // này chạy ở MỌI lần lưu (ensureLayout), không phải lệnh xuất bản.
      await this.syncAttachedLayouts(post.id, { publishLive: false });
      await this.cache.clear();
      return existingLayout;
    }

    const layout = await this.prisma.pageLayout.create({
      data: {
        name: body.layoutName || viOf(post.title),
        slug: layoutSlug,
        description: viOf(post.excerpt) || null,
        puckData: injectedTree as unknown as InputJsonValue,
        createdBy: userId,
        sourcePostId: post.id,
        // Scope the layout to the post's department so dept-scoped public feeds
        // (syncNewsFeedSnapshots) place it correctly and never on the homepage.
        departmentId: post.departmentId,
        // Danh mục CHÍNH (breadcrumb): danh mục đầu tiên người dùng chọn, không
        // có thì lấy của layout mẫu.
        categoryId: primaryCategoryId,
      },
      select: { id: true, slug: true },
    });
    // Bảng nối mới là nguồn cho bộ lọc: một trang có thể nằm dưới nhiều danh mục
    // mà vẫn chỉ có một URL.
    if (categoryIds.length) {
      await this.prisma.pageLayoutCategoryLink.createMany({
        data: categoryIds.map((categoryId) => ({
          pageLayoutId: layout.id,
          categoryId,
        })),
        skipDuplicates: true,
      });
    }
    // Gắn bài vào một layout = nội dung đã sẵn sàng có trang: đưa bài đang ở
    // nháp sang "chờ xuất bản" (PENDING). Không đụng bài đã SCHEDULED/PUBLISHED.
    if (post.status === 'DRAFT') {
      await this.prisma.post.update({
        where: { id: post.id },
        data: { status: 'PENDING' },
      });
    }
    await this.cache.clear();
    return layout;
  }

  /**
   * Xuất bản (hoặc lên lịch) các layout của bài, gọi thẳng từ trình soạn bài.
   *
   * Trang công khai lấy LAYOUT làm nguồn sự thật, nên trước đây muốn bài lên web
   * phải rời trình soạn bài sang trình sửa layout rồi mới bấm publish. Đây vẫn là
   * hành động CÓ CHỦ Ý của người dùng (nút "Lưu và xuất bản ngay"), không phải tự
   * động publish sau lưng họ.
   */
  /** Bai nay co phai qua Khoa duyet khong? */
  private async needsApproval(
    roleName: string,
    userDeptId: string | null,
    postDeptId: string | null,
  ): Promise<boolean> {
    // Admin cap Khoa duyet nguoi khac, khong tu duyet minh.
    if (isFacultyWide(roleName, userDeptId)) return false;
    if (!postDeptId) return false;
    const dept = await this.prisma.department.findUnique({
      where: { id: postDeptId },
      select: { requiresApproval: true },
    });
    return dept?.requiresApproval ?? false;
  }

  /** Hang doi bai cho duyet — chi admin cap Khoa xem duoc. */
  async listPendingReview(roleName: string, departmentId: string | null) {
    if (!isFacultyWide(roleName, departmentId)) throw PostNotFoundException;
    const rows = await this.prisma.post.findMany({
      where: {
        status: 'PENDING',
        ...NOT_DELETED,
        department: { requiresApproval: true },
        // Bai da co layout dang xuat ban roi thi khong con cho duyet nua.
        NOT: { layouts: { some: { isPublished: true, deletedAt: null } } },
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        ...postListSelect,
        department: { select: { name: true, slug: true } },
      },
    });
    return rows.map((r) => this.serializeListItem(r as PostListRecord));
  }

  /** Khoa tra bai ve cho don vi sua, kem ly do. */
  async rejectPost(
    id: string,
    note: string,
    roleName: string,
    departmentId: string | null,
  ) {
    if (!isFacultyWide(roleName, departmentId)) throw PostNotFoundException;
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || post.deletedAt) throw PostNotFoundException;
    await this.prisma.post.update({
      where: { id },
      // Ve nhap kem ly do; don vi sua xong bam gui duyet lai.
      data: { status: 'DRAFT', reviewNote: note.trim() || null },
    });
    await this.cache.clear();
    return { ok: true };
  }

  async publishAttachedLayouts(
    id: string,
    userId: string,
    roleName: string,
    departmentId: string | null,
    scheduledAt?: Date | null,
  ) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || post.deletedAt) throw PostNotFoundException;
    if (!canAccessDepartment(roleName, departmentId, post.departmentId)) {
      throw PostNotFoundException;
    }

    // ── CUA KIEM DUYET ──────────────────────────────────────────────────────
    // Don vi co requiresApproval thi tai khoan cua don vi KHONG tu dang duoc:
    // bam "dang" = GUI DUYET. Chan o day vi day la cho duy nhat trinh soan bai
    // dua bai len web, nen khong the lach bang cach goi API truc tiep.
    // Admin cap Khoa (isFacultyWide) khong bi chan -> ho duyet bang chinh ham
    // nay, khong can duong rieng.
    if (await this.needsApproval(roleName, departmentId, post.departmentId)) {
      await this.prisma.post.update({
        where: { id },
        // Gui duyet lai thi xoa ly do tra ve cu cho khoi hieu nham.
        data: { status: 'PENDING', reviewNote: null },
      });
      await this.cache.clear();
      return { ok: true, submittedForReview: true as const, published: 0 };
    }

    const layouts = await this.prisma.pageLayout.findMany({
      where: { sourcePostId: id, deletedAt: null },
      select: { id: true, slug: true, isPublished: true },
    });
    if (!layouts.length) {
      return { ok: false, reason: 'no-layout' as const, published: 0 };
    }

    if (scheduledAt) {
      await this.pageLayoutRepo.scheduleManyPublish(
        layouts.map((l) => l.id),
        scheduledAt,
      );
      await this.prisma.post.update({
        where: { id },
        data: { status: 'SCHEDULED', scheduledAt },
      });
      await this.cache.clear();
      return { ok: true, scheduled: layouts.length };
    }

    let published = 0;
    const skipped: string[] = [];
    for (const layout of layouts) {
      // KHÔNG bỏ qua layout đã xuất bản: publish() chép puckData sang
      // publishedPuckData, nên đây chính là bước đưa bản nháp vừa sửa lên trang
      // công khai. Bỏ qua thì "Lưu và xuất bản ngay" trên bài đã xuất bản sẽ
      // không đổi gì trên web.
      // Không cướp đường dẫn của một trang khác đang xuất bản.
      const conflict = await this.pageLayoutRepo.findAnyPublishedWithSlug(
        layout.slug,
        layout.id,
      );
      if (conflict) {
        skipped.push(layout.slug);
        continue;
      }
      await this.pageLayoutRepo.publish(layout.id);
      await this.pageLayoutRepo.snapshotPublishedVersion(layout.id, userId);
      published += 1;
    }
    // Kéo trạng thái bài theo layout + dựng lại snapshot feed + revalidate.
    const { slugs } = await this.syncStatusFromLayouts(id);
    await this.cache.clear();
    this.publicRevalidate.trigger([
      'sitemap',
      'page:trang-chu',
      `post:${id}`,
      ...layouts.map((l) => `page:${l.slug}`),
      ...slugs.map((sl) => `page:${sl}`),
    ]);
    return { ok: true, published, skipped };
  }

  private async findByIdOrThrow(id: string) {
    const record = await this.prisma.post.findUnique({
      where: { id },
      include: {
        ...postInclude,
        coverMedia: { select: { id: true, url: true } },
      },
    });
    if (!record) throw PostNotFoundException;
    return record;
  }

  async syncNewsFeedSnapshots() {
    // Chỉ layout CÓ widget feed mới cần dựng lại snapshot. Trước đây hàm này nạp
    // TOÀN BỘ ~2000 layout kèm nguyên cây puckData (JSON rất nặng) trên mỗi lần
    // lưu bài, khiến mỗi thao tác đăng/sửa mất ~6,5s. Lọc trước bằng một truy vấn
    // text nhẹ: thực tế chỉ khoảng chục layout có LatestNewsAuto/UpcomingEventsAuto.
    const candidates = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "PageLayout"
      WHERE "puckData"::text LIKE '%LatestNewsAuto%'
         OR "puckData"::text LIKE '%UpcomingEventsAuto%'
         OR "publishedPuckData"::text LIKE '%LatestNewsAuto%'
         OR "publishedPuckData"::text LIKE '%UpcomingEventsAuto%'
    `;
    if (candidates.length === 0) return { changed: 0, slugs: [] as string[] };
    const layouts = await this.prisma.pageLayout.findMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      select: {
        id: true,
        slug: true,
        departmentId: true,
        puckData: true,
        publishedPuckData: true,
      },
    });

    // Each layout is snapshotted with a feed scoped to ITS department, so a
    // faculty/homepage layout never shows bộ-môn posts and a department page
    // shows its own. Memoize per scope to avoid re-querying.
    type Feed = { latest: unknown[]; events: unknown[] };
    const feedCache = new Map<string, Feed>();
    const scopeKey = (deptId: string | null) =>
      !deptId || deptId === FACULTY_DEPT_ID ? '__faculty__' : deptId;
    const getFeed = async (deptId: string | null): Promise<Feed> => {
      const key = scopeKey(deptId);
      let feed = feedCache.get(key);
      if (!feed) {
        const w = this.feedDeptWhereById(deptId);
        const [latest, events] = await Promise.all([
          this.listLatestPublic(12, w),
          this.listUpcomingEventsPublic(12, w),
        ]);
        feed = { latest, events };
        feedCache.set(key, feed);
      }
      return feed;
    };

    const transformNode = (node: any, feed: Feed): any => {
      if (Array.isArray(node)) return node.map((n) => transformNode(n, feed));
      if (!node || typeof node !== 'object') return node;
      const out = { ...node };
      if (out.props) out.props = { ...out.props };
      if (out.type === 'LatestNewsAuto' && out.props) {
        const limit = Math.max(1, Math.min(Number(out.props.limit) || 4, 12));
        out.props.posts = feed.latest.slice(0, limit);
      } else if (out.type === 'UpcomingEventsAuto' && out.props) {
        const limit = Math.max(1, Math.min(Number(out.props.limit) || 4, 12));
        out.props.posts = feed.events.slice(0, limit);
      }
      if (out.props) {
        for (const k of Object.keys(out.props)) {
          out.props[k] = transformNode(out.props[k], feed);
        }
      }
      return out;
    };

    const transformTree = (data: any, feed: Feed): any => {
      if (!data || typeof data !== 'object') return data;
      const out = { ...data };
      if (Array.isArray(out.content))
        out.content = out.content.map((n: unknown) => transformNode(n, feed));
      if (out.zones && typeof out.zones === 'object') {
        const z: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(out.zones)) {
          z[k] = Array.isArray(v) ? v.map((n) => transformNode(n, feed)) : v;
        }
        out.zones = z;
      }
      return out;
    };

    let changed = 0;
    const changedSlugs: string[] = [];
    for (const layout of layouts) {
      const feed = await getFeed(layout.departmentId);
      const orig = JSON.stringify(layout.puckData);
      const origPub = JSON.stringify(layout.publishedPuckData);
      const next = transformTree(layout.puckData, feed);
      const nextPub = transformTree(layout.publishedPuckData, feed);
      if (
        JSON.stringify(next) !== orig ||
        JSON.stringify(nextPub) !== origPub
      ) {
        await this.prisma.pageLayout.update({
          where: { id: layout.id },
          data: {
            puckData: next as InputJsonValue,
            publishedPuckData: (nextPub ?? undefined) as
              | InputJsonValue
              | undefined,
          },
        });
        changed++;
        changedSlugs.push(layout.slug);
      }
    }
    if (changed) await this.cache.clear();
    return { layoutsUpdated: changed, slugs: changedSlugs };
  }

  /**
   * Đồng bộ TRẠNG THÁI bài viết theo layout của nó — gọi khi một layout gắn
   * `sourcePostId` được publish/unpublish. Nếu bài có ít nhất một layout đã xuất
   * bản → đưa bài về PUBLISHED (giữ nguyên publishedAt gốc nếu có); nếu không còn
   * layout published nào → hạ về DRAFT. Khi trạng thái đổi, dựng lại snapshot feed
   * để bài hiện/ẩn NGAY trên trang chủ + trang mục, và trả về slug các layout đã
   * đổi để revalidate đúng trang (một lần tải là thấy).
   */
  async syncStatusFromLayouts(postId: string): Promise<{ slugs: string[] }> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        deletedAt: true,
        scheduledAt: true,
        layouts: {
          where: { deletedAt: null },
          select: { isPublished: true, scheduledAt: true },
        },
      },
    });
    if (!post || post.deletedAt) return { slugs: [] };
    const hasPublished = post.layouts.some((l) => l.isPublished);
    // Còn layout nào đang chờ tới giờ thì bài vẫn ở trạng thái hẹn.
    const stillScheduled = post.layouts.some((l) => l.scheduledAt !== null);
    if (hasPublished && !stillScheduled && post.status !== 'PUBLISHED') {
      await this.prisma.post.update({
        where: { id: postId },
        data: {
          status: 'PUBLISHED',
          publishedAt: post.publishedAt ?? new Date(),
          // Cron đã xuất bản xong → xoá mốc hẹn để giao diện không còn báo "Đã
          // lên lịch" cho một việc đã chạy.
          scheduledAt: null,
        },
      });
    } else if (hasPublished && !stillScheduled && post.scheduledAt !== null) {
      await this.prisma.post.update({
        where: { id: postId },
        data: { scheduledAt: null },
      });
    } else if (!hasPublished && post.status === 'PUBLISHED') {
      await this.prisma.post.update({
        where: { id: postId },
        data: { status: 'DRAFT' },
      });
    }
    // LUÔN dựng lại snapshot feed, KỂ CẢ khi trạng thái bài không đổi: publish/xoá
    // một layout của bài ĐÃ published (vd đổi bài sang layout sự kiện, thêm layout
    // thứ 2) vẫn làm feed trang chủ/mục đổi. Trước đây bỏ qua khi status không đổi
    // nên "Sự kiện sắp tới"/"Tin tức" ở trang chủ không cập nhật cho tới khi hết ISR.
    const { slugs } = await this.syncNewsFeedSnapshots();
    return { slugs };
  }

  /**
   * Bơm nội dung bài vào các layout gắn với nó.
   *
   * `publishLive` quyết định có ghi luôn vào `publishedPuckData` (bản đang phục
   * vụ trang công khai) hay chỉ ghi `puckData` (bản nháp). Trước đây hàm này
   * LUÔN ghi cả hai, nên "Lưu và lên lịch" đẩy nội dung mới lên trang công khai
   * ngay lúc bấm lưu — đặt hẹn 9h23 thì 9h22 đã thấy bản mới. Bản công khai chỉ
   * được thay ở đúng thời điểm xuất bản: hoặc do người dùng bấm xuất bản ngay
   * (repo.publish chép puckData sang publishedPuckData), hoặc do cron tới giờ.
   */
  private async syncAttachedLayouts(
    postId: string,
    { publishLive }: { publishLive: boolean },
  ): Promise<string[]> {
    const post = await this.findByIdOrThrow(postId);
    const layouts = await this.prisma.pageLayout.findMany({
      where: { sourcePostId: postId },
      select: {
        id: true,
        slug: true,
        puckData: true,
        publishedPuckData: true,
        category: { select: { slug: true, name: true } },
      },
    });
    if (!layouts.length) return [];
    // Danh mục thuộc về TỪNG layout, nên phần dùng chung được dựng một lần rồi
    // mỗi layout tự chèn danh mục của mình (bài rót vào layout câu lạc bộ và
    // layout tin khoa học phải hiện đúng danh mục ở mỗi trang).
    const sharedPayload: Omit<PostInjectPayload, 'category' | 'categoryLabel'> = {
      title: asLocalized(post.title) ?? { vi: '' },
      body: asLocalized(post.body) ?? { vi: '' },
      excerpt: asLocalized(post.excerpt),
      coverUrl:
        post.coverUrl ?? (post.coverMedia ? post.coverMedia.url : null) ?? null,
      coverAlt: post.coverAlt ?? null,
      tags: post.postTags.map((pt) => ({
        slug: pt.tag.slug,
        name: pt.tag.name,
        icon: pt.tag.icon,
      })),
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
      eventStartAt: post.eventStartAt ? post.eventStartAt.toISOString() : null,
      eventEndAt: post.eventEndAt ? post.eventEndAt.toISOString() : null,
      eventLocation: post.eventLocation ?? null,
      ...this.readMedia(post.metadata),
    };
    await Promise.all(
      layouts.map((layout) => {
        const payload: PostInjectPayload = {
          ...sharedPayload,
          category: layout.category?.slug ?? '',
          categoryLabel: asLocalized(layout.category?.name) ?? { vi: '' },
        };
        const data: {
          puckData?: InputJsonValue;
          publishedPuckData?: InputJsonValue;
        } = {};
        if (layout.puckData) {
          data.puckData = injectPostIntoPuckData(
            layout.puckData,
            payload,
          ) as unknown as InputJsonValue;
        }
        if (publishLive && layout.publishedPuckData) {
          data.publishedPuckData = injectPostIntoPuckData(
            layout.publishedPuckData,
            payload,
          ) as unknown as InputJsonValue;
        }
        if (!data.puckData && !data.publishedPuckData) {
          return Promise.resolve();
        }
        return this.prisma.pageLayout.update({
          where: { id: layout.id },
          data,
        });
      }),
    );
    return layouts.map((l) => l.slug);
  }

  private async upsertTagIds(slugs: string[]): Promise<string[]> {
    const unique = Array.from(new Set(slugs.filter(Boolean)));
    if (!unique.length) return [];
    const tags = await Promise.all(
      unique.map((slug) =>
        this.prisma.tag.upsert({
          where: { slug },
          create: { slug, name: slug },
          update: {},
          select: { id: true },
        }),
      ),
    );
    return tags.map((t) => t.id);
  }

  private serialize(
    record: Awaited<ReturnType<PrismaService['post']['findFirstOrThrow']>> & {
      postTags: Array<{ tag: { slug: string; name: string } }>;
      layouts: Array<{
        id: string;
        name: string;
        slug: string;
        isPublished: boolean;
        scheduledAt: Date | null;
        publishedAt: Date | null;
      }>;
    },
  ) {
    return {
      id: record.id,
      title: asLocalized(record.title),
      slug: record.slug,
      body: asLocalized(record.body),
      excerpt: asLocalized(record.excerpt),
      departmentId: record.departmentId,
      status: record.status,
      // Ly do Khoa tra bai lai — don vi phai doc duoc thi moi biet sua gi.
      reviewNote: (record as { reviewNote?: string | null }).reviewNote ?? null,
      coverMediaId: record.coverMediaId,
      coverUrl: record.coverUrl,
      coverAlt: record.coverAlt,
      tags: record.postTags.map((pt) => ({
        slug: pt.tag.slug,
        name: pt.tag.name,
      })),
      eventStartAt: record.eventStartAt,
      eventEndAt: record.eventEndAt,
      eventLocation: record.eventLocation,
      publishedAt: record.publishedAt,
      scheduledAt: record.scheduledAt,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      layouts: record.layouts,
    };
  }

  // Same shape as serialize() but for LIST rows fetched with postListSelect
  // (no `body`). The admin post list doesn't render body, so it never asks for it.
  private serializeListItem(record: PostListRecord) {
    return {
      id: record.id,
      title: asLocalized(record.title),
      slug: record.slug,
      excerpt: asLocalized(record.excerpt),
      departmentId: record.departmentId,
      status: record.status,
      // Ly do Khoa tra bai lai — don vi phai doc duoc thi moi biet sua gi.
      reviewNote: (record as { reviewNote?: string | null }).reviewNote ?? null,
      coverMediaId: record.coverMediaId,
      coverUrl: record.coverUrl,
      coverAlt: record.coverAlt,
      tags: record.postTags.map((pt) => ({
        slug: pt.tag.slug,
        name: pt.tag.name,
      })),
      eventStartAt: record.eventStartAt,
      eventEndAt: record.eventEndAt,
      eventLocation: record.eventLocation,
      // Trình soạn bài đọc lại dữ liệu holder khi mở bài cũ ra sửa.
      ...this.readMedia((record as { metadata?: unknown }).metadata),
      publishedAt: record.publishedAt,
      scheduledAt: record.scheduledAt,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
      trashDaysLeft: record.deletedAt
        ? Math.max(
            0,
            TRASH_RETENTION_DAYS -
              Math.floor(
                (Date.now() - new Date(record.deletedAt).getTime()) / 86400000,
              ),
          )
        : null,
      layouts: record.layouts,
    };
  }
}
