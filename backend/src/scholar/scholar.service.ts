import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import { PublicRevalidateService } from '../shared/services/public-revalidate.service';
import {
  matchAuthors,
  normalizeName,
  suggestNameVariants,
  type CandidateProfile,
} from './name-match';
import { laterOf, pageBySince } from './integration-cursor';
import { parseBibliographyFile } from './resolve/bibliography';
import { ResolveService } from './resolve/resolve.service';
import { StaffPageService } from './staff-page.service';
import {
  normalizeDoi,
  resolveCountYear,
  type ResolvedWork,
} from './resolve/work';
import {
  CannotResolveException,
  NoClaimException,
  NoOrcidException,
  NotAnAuthorException,
  NotEligibleRepresentativeException,
  OrcidTakenException,
  PublicationNotFoundException,
  TooFewAuthorsException,
} from './scholar.error';
import type {
  ClaimResponseBodyType,
  CreatePublicationBodyType,
  IntegrationQueryType,
  ListPublicationsQueryType,
  OrcidImportBodyType,
  SetEducationBodyType,
  SetNameVariantsBodyType,
  UpdatePublicationBodyType,
  UpdateScholarProfileBodyType,
} from './scholar.model';

type AuthorRow = {
  family?: string | null;
  given?: string | null;
  name?: string | null;
  orcid?: string | null;
  sequence?: 'first' | 'additional' | null;
  affiliation?: string | null;
};

/** Một chỗ khai báo duy nhất cho phần include, để kiểu suy ra được thay vì `any`. */
const AUTHOR_INCLUDE = {
  authors: {
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { authorIndex: 'asc' },
  },
} satisfies Prisma.PublicationInclude;

type PublicationWithAuthors = Prisma.PublicationGetPayload<{
  include: typeof AUTHOR_INCLUDE;
}>;

@Injectable()
export class ScholarService {
  private readonly logger = new Logger(ScholarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ResolveService,
    private readonly publicRevalidate: PublicRevalidateService,
    private readonly bus: EventBusService,
    private readonly staffPage: StaffPageService,
  ) {}

  // ── Lý lịch khoa học ──────────────────────────────────────────────────────
  /** Tự tạo hồ sơ rỗng ở lần gọi đầu — giảng viên không phải bấm "tạo hồ sơ". */
  async getProfile(userId: string) {
    // Tên và email nằm ở bảng User, không nằm ở hồ sơ khoa học — nhưng giao diện
    // cần chúng ngay ở lần gọi đầu, nên gộp vào đây thay vì bắt gọi thêm một API.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        // Bộ môn ĐÃ được đồng bộ từ PHYsoom vào `User.departmentId` (xem
        // sync-physoom-members.ts). Trả kèm ở đây vì trước nay dữ liệu nằm sẵn
        // trong CSDL mà không màn nào hiện ra, nên người dùng tưởng chưa có.
        department: { select: { name: true } },
      },
    });
    const fullName = [user?.lastName, user?.firstName]
      .filter(Boolean)
      .join(' ');
    const danhTinh = {
      displayName: fullName,
      email: user?.email ?? '',
      departmentName: user?.department?.name ?? null,
    };

    const existing = await this.prisma.scholarProfile.findUnique({
      where: { userId },
      include: {
        nameVariants: { orderBy: { isPrimary: 'desc' } },
        // Theo THỜI GIAN như mẫu lý lịch khoa học: cử nhân trước, tiến sĩ sau.
        // Dòng chưa có năm xuống cuối, vì không biết xếp vào đâu cho đúng.
        education: { orderBy: [{ year: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (existing) return { ...existing, ...danhTinh };

    const created = await this.prisma.scholarProfile.create({
      data: {
        userId,
        // Gợi sẵn các dạng tên hay dùng để người mới vào có cái mà bỏ bớt, thay
        // vì đối diện một danh sách trống.
        nameVariants: {
          create: suggestNameVariants(fullName).map((raw, i) => ({
            raw,
            normalized: normalizeName(raw),
            isPrimary: i === 0,
          })),
        },
      },
      include: {
        nameVariants: { orderBy: { isPrimary: 'desc' } },
        // Theo THỜI GIAN như mẫu lý lịch khoa học: cử nhân trước, tiến sĩ sau.
        // Dòng chưa có năm xuống cuối, vì không biết xếp vào đâu cho đúng.
        education: { orderBy: [{ year: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return { ...created, ...danhTinh };
  }

  async updateProfile(userId: string, body: UpdateScholarProfileBodyType) {
    await this.getProfile(userId);
    if (body.orcid) {
      const clash = await this.prisma.scholarProfile.findFirst({
        where: { orcid: body.orcid, userId: { not: userId } },
        select: { id: true },
      });
      if (clash) throw OrcidTakenException;
    }
    await this.prisma.scholarProfile.update({
      where: { userId },
      data: {
        orcid: body.orcid ?? undefined,
        scopusAuthorId: body.scopusAuthorId ?? undefined,
        researcherId: body.researcherId ?? undefined,
        googleScholarId: body.googleScholarId ?? undefined,
        researchGateUrl: body.researchGateUrl ?? undefined,
        staffPageSlug: body.staffPageSlug ?? undefined,
        showOnWeb: body.showOnWeb ?? undefined,
        // Từ đây trở xuống: `undefined` = không đụng tới, `null` = xoá đi. Phải
        // phân biệt "không gửi" với "gửi null", nên không dùng ?? được.
        affiliationType:
          body.affiliationType === undefined ? undefined : body.affiliationType,
        homeInstitution:
          body.homeInstitution === undefined ? undefined : body.homeInstitution,
        gradStudyLevel:
          body.gradStudyLevel === undefined ? undefined : body.gradStudyLevel,
        gradStudyField:
          body.gradStudyField === undefined ? undefined : body.gradStudyField,
        gradStudyInstitution:
          body.gradStudyInstitution === undefined
            ? undefined
            : body.gradStudyInstitution,
        gradStudyCountry:
          body.gradStudyCountry === undefined
            ? undefined
            : body.gradStudyCountry,
        gradStudyStartYear:
          body.gradStudyStartYear === undefined
            ? undefined
            : body.gradStudyStartYear,
        gradStudyEndYear:
          body.gradStudyEndYear === undefined
            ? undefined
            : body.gradStudyEndYear,
        gradStudyFullTime: body.gradStudyFullTime ?? undefined,
        gradStudyNote:
          body.gradStudyNote === undefined ? undefined : body.gradStudyNote,
      },
    });
    // ID học thuật (ORCID/Scopus/…) khai ở Định danh phải hiện thành icon-link
    // trên trang nhân sự → sao sang props khối hồ sơ ngay. Chưa có trang / lỗi
    // đồng bộ không được làm hỏng việc lưu Định danh.
    await this.staffPage
      .syncScholarLinksForUser(userId)
      .catch((err) =>
        this.logger.warn(`syncScholarLinksForUser(${userId}) lỗi: ${err}`),
      );
    this.bus.emit('profile.changed', { userIds: [userId] });
    return this.getProfile(userId);
  }

  /** Thay cả bộ tên thường dùng — đơn giản hơn hẳn thêm/xoá từng dòng. */
  async setNameVariants(userId: string, body: SetNameVariantsBodyType) {
    const profile = await this.getProfile(userId);
    const primaryNorm = body.primary ? normalizeName(body.primary) : null;

    // Chuẩn hoá rồi khử trùng: hai cách gõ khác nhau của cùng một tên là một.
    const seen = new Map<string, string>();
    for (const raw of body.variants) {
      const norm = normalizeName(raw);
      if (norm.length >= 2 && !seen.has(norm)) seen.set(norm, raw.trim());
    }

    await this.prisma.$transaction([
      this.prisma.scholarNameVariant.deleteMany({
        where: { profileId: profile.id },
      }),
      this.prisma.scholarNameVariant.createMany({
        data: [...seen.entries()].map(([normalized, raw], i) => ({
          profileId: profile.id,
          raw,
          normalized,
          isPrimary: primaryNorm ? normalized === primaryNorm : i === 0,
        })),
      }),
    ]);
    return this.getProfile(userId);
  }


  /**
   * Thay CẢ danh sách học vấn.
   *
   * Mọi dòng ghi ở đây đều thành `SELF`, kể cả dòng người dùng không sửa gì:
   * họ đã mở màn hình ra và bấm Lưu, tức là đã nhìn qua. Nhờ vậy đợt đổ từ trang
   * nhân sự chạy lại sau này biết đâu là dòng của máy (còn `STAFF_PAGE`) mà bỏ
   * qua, thay vì đè lên phần người ta vừa sửa tay.
   */
  async setEducation(userId: string, body: SetEducationBodyType) {
    const profile = await this.getProfile(userId);
    await this.prisma.$transaction([
      this.prisma.scholarEducation.deleteMany({
        where: { profileId: profile.id },
      }),
      this.prisma.scholarEducation.createMany({
        data: body.items.map((e) => ({
          profileId: profile.id,
          level: e.level,
          field: e.field ?? null,
          institution: e.institution.trim(),
          country: e.country ?? null,
          year: e.year ?? null,
          note: e.note ?? null,
          source: 'SELF' as const,
        })),
      }),
    ]);
    return this.getProfile(userId);
  }

  // ── Tra cứu ───────────────────────────────────────────────────────────────
  async resolveOne(userId: string, input: string) {
    const work = await this.resolver.resolve(input);
    if (!work) throw CannotResolveException;
    return this.decorate(work, userId);
  }

  async importFile(userId: string, content: string) {
    const works = parseBibliographyFile(content);
    const items = [];
    for (const w of works) items.push(await this.decorate(w, userId));
    return {
      items,
      // Mục thiếu tiêu đề bị bộ đọc bỏ qua — báo số lượng để người dùng biết
      // file của họ không vào trọn vẹn.
      skipped: Math.max(0, countEntries(content) - works.length),
    };
  }

  async importFromOrcid(userId: string, body: OrcidImportBodyType) {
    const profile = await this.getProfile(userId);
    const orcid = body.orcid ?? profile.orcid;
    if (!orcid) throw NoOrcidException;

    const works = await this.resolver.byOrcid(orcid, body.limit ?? 100);
    const items = [];
    for (const w of works) items.push(await this.decorate(w, userId));

    await this.prisma.scholarProfile.update({
      where: { userId },
      data: { lastOrcidSyncAt: new Date() },
    });
    return { items, skipped: 0 };
  }

  /**
   * Gắn thêm hai thứ vào kết quả tra: bài này đã có trong CSDL chưa (trùng DOI),
   * và những ai trong Khoa có thể đang đứng tên trong đó.
   */
  private async decorate(work: ResolvedWork, userId: string) {
    const doi = normalizeDoi(work.doi);
    const existing = doi
      ? await this.prisma.publication.findFirst({
          where: { doi, deletedAt: null },
          select: { id: true },
        })
      : null;

    const candidates = await this.candidates();
    const byId = new Map(candidates.map((c) => [c.userId, c]));
    const matches = matchAuthors(work.authors ?? [], candidates);

    return {
      work,
      existingPublicationId: existing?.id ?? null,
      suggestions: matches.map((m) => ({
        ...m,
        displayName: byId.get(m.userId)?.displayName ?? '',
        email: byId.get(m.userId)?.email ?? '',
        isMe: m.userId === userId,
      })),
    };
  }

  /** Danh sách người có hồ sơ khoa học, dùng để dò tên tác giả. */
  /**
   * Danh sách người trong Khoa để chọn làm đồng tác giả / thành viên đề tài.
   *
   * Công bố không cần cái này: đồng tác giả được dò tự động từ danh sách tác giả
   * của chính bài báo. Đề tài thì KHÔNG có danh sách nào để dò — chủ nhiệm phải
   * tự chọn người, nên phải có chỗ tra.
   *
   * Bỏ TÀI KHOẢN ĐƠN VỊ ra: "Khoa Vật Lý", "BCN Khoa" là hộp thư của văn phòng,
   * không phải người, và gợi ý chúng làm đồng tác giả thì vừa vô nghĩa vừa dễ
   * bấm nhầm. Nhận ra bằng chỗ chúng KHÔNG có tên riêng — tài khoản đơn vị chỉ
   * có một cụm tên, còn người thì luôn đủ họ và tên.
   */
  async people(q?: string) {
    const rows = await this.prisma.user.findMany({
      where: {
        isActive: true,
        scholarProfile: { isNot: null },
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        department: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 300,
    });

    return {
      items: rows
        .filter((u) => (u.firstName ?? '').trim() && (u.lastName ?? '').trim())
        .map((u) => ({
          userId: u.id,
          displayName: [u.lastName, u.firstName].filter(Boolean).join(' '),
          email: u.email,
          departmentName: u.department?.name ?? null,
        })),
    };
  }

  private async candidates(): Promise<
    Array<CandidateProfile & { email: string }>
  > {
    const rows = await this.prisma.scholarProfile.findMany({
      where: { user: { isActive: true } },
      select: {
        userId: true,
        orcid: true,
        nameVariants: { select: { normalized: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      orcid: r.orcid,
      normalizedVariants: r.nameVariants.map((v) => v.normalized),
      displayName: [r.user.lastName, r.user.firstName]
        .filter(Boolean)
        .join(' '),
      email: r.user.email,
    }));
  }

  // ── Công trình ────────────────────────────────────────────────────────────
  async create(userId: string, body: CreatePublicationBodyType) {
    const w = body.work;
    const doi = normalizeDoi(w.doi);

    // Bài đã có (đồng nghiệp khai trước) → KHÔNG tạo bản thứ hai, chỉ gắn thêm
    // người gọi vào bài đó. Đây là điểm mấu chốt: một bài dùng chung cho cả nhóm.
    if (doi) {
      const existing = await this.prisma.publication.findFirst({
        where: { doi, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        await this.attachSelf(existing.id, userId, body);
        // Bài đã có nhưng CHƯA phân loại (ví dụ do nhập hàng loạt từ trang nhân
        // sự) mà người khai có chọn mã — áp vào luôn, đừng bắt họ vào màn khác
        // chọn lại đúng thứ vừa chọn.
        if (body.catalogCode) {
          await this.prisma.publication.updateMany({
            where: { id: existing.id, catalogCode: null },
            data: {
              catalogCode: body.catalogCode,
              quartile: body.quartile ?? null,
              classifiedBy: userId,
              classifiedAt: new Date(),
            },
          });
        }
        await this.recount(existing.id);
        return this.findOne(existing.id, userId);
      }
    }

    const authorsRaw = (w.authors ?? []) as unknown as Prisma.InputJsonValue;
    const publishedYear = body.publishedYear ?? w.publishedYear ?? null;
    const acceptedYear = body.acceptedYear ?? w.acceptedYear ?? null;

    const created = await this.prisma.publication.create({
      data: {
        doi,
        arxivId: w.arxivId ?? null,
        isbn: w.isbn ?? null,
        issn: w.issn ?? null,
        type: w.type || 'journal-article',
        title: w.title,
        containerTitle: w.containerTitle ?? null,
        volume: w.volume ?? null,
        issue: w.issue ?? null,
        pages: w.pages ?? null,
        publisher: w.publisher ?? null,
        url: w.url ?? null,
        status: body.status,
        publishedYear,
        publishedMonth: body.publishedMonth ?? w.publishedMonth ?? null,
        acceptedYear,
        acceptedMonth: body.acceptedMonth ?? w.acceptedMonth ?? null,
        countYear: resolveCountYear({ publishedYear, acceptedYear }),
        authorsRaw,
        source: w.source || 'manual',
        raw: (w as { raw?: unknown }).raw as Prisma.InputJsonValue,
        totalAuthors: body.totalAuthors ?? Math.max(1, w.authors?.length ?? 1),
        // App gửi số tác giả THUỘC Trường (0 khi không ai thuộc — mục 1b). Không
        // ghi thì mặc định Prisma = 1, và recount `max(1, …)` xoá mất số 0. `?? 1`
        // chỉ để phòng path không gửi trường này.
        schoolAuthors: body.schoolAuthors ?? 1,
        // Phân loại chọn ngay lúc khai. Để trống vẫn lưu được, chỉ là bài đó
        // chưa lọt vào API tích hợp nên chưa tính KPI.
        catalogCode: body.catalogCode ?? null,
        quartile: body.quartile ?? null,
        classifiedBy: body.catalogCode ? userId : null,
        classifiedAt: body.catalogCode ? new Date() : null,
        satellite: body.satellite ?? false,
        reprint: body.reprint ?? false,
        fromProject: body.fromProject ?? false,
        stage: body.stage ?? 0,
        // TỔNG tác giả chính NGOÀI Trường — đếm lúc khai; integrationList cộng vào
        // mainAuthorsAtSchool (đếm sống) để ra mainAuthors. recount() không đụng cột này.
        externalMainAuthors: (body.externalAuthors ?? []).filter(
          (a) => a.isFirst || a.isCorresponding || a.isLast,
        ).length,
        createdBy: userId,
      },
      select: { id: true },
    });

    await this.attachSelf(created.id, userId, body);
    await this.invite(created.id, userId, body.coAuthorUserIds ?? []);
    await this.recount(created.id);
    this.bus.emit('publication.changed', {
      id: created.id,
      userIds: [userId, ...(body.coAuthorUserIds ?? [])],
    });
    return this.findOne(created.id, userId);
  }

  /** Người tự khai được CONFIRMED ngay — họ đang nói về chính mình. */
  private async attachSelf(
    publicationId: string,
    userId: string,
    body: { me: CreatePublicationBodyType['me'] },
  ) {
    const me = body.me;
    this.assertRepresentative(me);
    await this.prisma.publicationAuthor.upsert({
      where: { publicationId_userId: { publicationId, userId } },
      create: {
        publicationId,
        userId,
        authorIndex: me.authorIndex ?? -1,
        isFirst: me.isFirst ?? false,
        isCorresponding: me.isCorresponding ?? false,
        isLast: me.isLast ?? false,
        sharePercent: me.sharePercent ?? null,
        showOnWeb: me.showOnWeb ?? true,
        claimStatus: 'CONFIRMED',
        respondedAt: new Date(),
      },
      update: {
        authorIndex: me.authorIndex ?? undefined,
        isFirst: me.isFirst ?? undefined,
        isCorresponding: me.isCorresponding ?? undefined,
        isLast: me.isLast ?? undefined,
        sharePercent: me.sharePercent ?? undefined,
        showOnWeb: me.showOnWeb ?? undefined,
        claimStatus: 'CONFIRMED',
        respondedAt: new Date(),
      },
    });
  }

  /**
   * Gắn tên đồng nghiệp vào bài → họ ở PENDING. Người khai KHÔNG thay mặt đồng
   * nghiệp xác nhận được: giờ NCKH là quyền lợi của từng người, phải chính chủ
   * bấm đồng ý.
   */
  private async invite(
    publicationId: string,
    invitedBy: string,
    userIds: string[],
  ) {
    const others = [...new Set(userIds)].filter((id) => id && id !== invitedBy);
    if (!others.length) return;
    await this.prisma.publicationAuthor.createMany({
      data: others.map((userId) => ({
        publicationId,
        userId,
        invitedBy,
        claimStatus: 'PENDING' as const,
      })),
      skipDuplicates: true,
    });
  }

  private assertRepresentative(me?: Partial<CreatePublicationBodyType['me']>) {
    if (!me?.sharePercent) return;
    if (!me.isFirst && !me.isCorresponding && !me.isLast) {
      throw NotEligibleRepresentativeException;
    }
  }

  /**
   * Cập nhật các con số suy ra được từ danh sách tác giả đã xác nhận.
   *
   *   schoolAuthors      — luôn ít nhất bằng số người đã xác nhận, nhưng có thể
   *                        cao hơn nếu bài còn sinh viên/học viên thuộc Trường
   *                        không có tài khoản. Vì vậy chỉ NÂNG, không hạ. KHÔNG
   *                        sàn lên 1: bài người khai đánh dấu không ai thuộc
   *                        Trường (schoolAuthors 0, chưa ai xác nhận) phải giữ
   *                        được 0 — sàn 1 sẽ tính giờ NV2 cho một bài của nơi khác.
   *   mainAuthorAtSchool — true khi có người đã xác nhận giữ vai trò First,
   *                        Corresponding hoặc Last. Người dùng vẫn đặt tay được
   *                        (tác giả chính có thể là người ngoài hệ thống).
   */
  private async recount(publicationId: string) {
    const pub = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      select: { schoolAuthors: true, totalAuthors: true, authorsRaw: true },
    });
    if (!pub) return;

    const confirmed = await this.prisma.publicationAuthor.findMany({
      where: { publicationId, claimStatus: 'CONFIRMED' },
      select: {
        isFirst: true,
        isCorresponding: true,
        isLast: true,
        authorIndex: true,
      },
    });

    // Tác giả đã xác nhận nhưng GHI ĐỊA CHỈ NGOÀI TRƯỜNG trên bài này
    // (`isNonSchool` ở `authorsRaw[authorIndex]`) KHÔNG phải "tác giả thuộc
    // Trường". Tính họ vào cận dưới sẽ đẩy `schoolAuthors = 0` (mục 1b) lên 1 →
    // xoá sạch ý người khai (ngay ở đường tạo, hoặc lần xác nhận kế ở đường sửa).
    const raw = Array.isArray(pub.authorsRaw)
      ? (pub.authorsRaw as Array<Record<string, unknown>>)
      : [];
    const ngoaiTruong = (idx: number) =>
      idx >= 0 && !!raw[idx] && raw[idx].isNonSchool === true;
    const thuocTruong = confirmed.filter((a) => !ngoaiTruong(a.authorIndex));

    const schoolAuthors = Math.max(pub.schoolAuthors, thuocTruong.length);

    await this.prisma.publication.update({
      where: { id: publicationId },
      data: {
        schoolAuthors,
        totalAuthors: Math.max(pub.totalAuthors, schoolAuthors),
        // Tác giả chính THUỘC TRƯỜNG (loại người ghi địa chỉ ngoài).
        mainAuthorAtSchool: thuocTruong.some(
          (a) => a.isFirst || a.isCorresponding || a.isLast,
        ),
      },
    });
  }

  async update(userId: string, id: string, body: UpdatePublicationBodyType) {
    await this.assertConfirmedAuthor(id, userId);
    const current = await this.prisma.publication.findUnique({
      where: { id },
      select: {
        publishedYear: true,
        acceptedYear: true,
        catalogCode: true,
        schoolAuthors: true,
      },
    });
    if (!current) throw PublicationNotFoundException;

    if (
      body.totalAuthors !== undefined &&
      body.totalAuthors < (body.schoolAuthors ?? current.schoolAuthors)
    ) {
      throw TooFewAuthorsException;
    }
    this.assertRepresentative(body.me);

    const publishedYear =
      body.publishedYear === undefined
        ? current.publishedYear
        : body.publishedYear;
    const acceptedYear =
      body.acceptedYear === undefined
        ? current.acceptedYear
        : body.acceptedYear;

    // Ghi lại ai phân loại và lúc nào — con số KPI phải truy được nguồn gốc.
    const classifying =
      body.catalogCode !== undefined &&
      body.catalogCode !== current.catalogCode;

    await this.prisma.publication.update({
      where: { id },
      data: {
        title: body.title ?? undefined,
        containerTitle: body.containerTitle ?? undefined,
        volume: body.volume ?? undefined,
        issue: body.issue ?? undefined,
        pages: body.pages ?? undefined,
        publisher: body.publisher ?? undefined,
        url: body.url ?? undefined,
        issn: body.issn ?? undefined,
        // Ghi lại authorsRaw KHI giao diện gửi lên — chỉ dùng để lưu `studentType`
        // (diện học viên) cho từng tác giả. GHI NHẬN thuần tuý, không đụng tới bất
        // kỳ con số quy đổi giờ/điểm nào. Bỏ trống thì giữ nguyên danh sách cũ.
        authorsRaw:
          body.authorsRaw === undefined
            ? undefined
            : (body.authorsRaw as unknown as Prisma.InputJsonValue),
        status: body.status ?? undefined,
        publishedYear,
        publishedMonth:
          body.publishedMonth === undefined ? undefined : body.publishedMonth,
        acceptedYear,
        acceptedMonth:
          body.acceptedMonth === undefined ? undefined : body.acceptedMonth,
        countYear: resolveCountYear({ publishedYear, acceptedYear }),
        catalogCode:
          body.catalogCode === undefined ? undefined : body.catalogCode,
        quartile: body.quartile === undefined ? undefined : body.quartile,
        classifiedBy: classifying ? userId : undefined,
        classifiedAt: classifying ? new Date() : undefined,
        satellite: body.satellite ?? undefined,
        reprint: body.reprint ?? undefined,
        fromProject: body.fromProject ?? undefined,
        stage: body.stage ?? undefined,
        totalAuthors: body.totalAuthors ?? undefined,
        schoolAuthors: body.schoolAuthors ?? undefined,
        mainAuthorAtSchool: body.mainAuthorAtSchool ?? undefined,
        // Cập nhật số tác giả chính ngoài Trường khi giao diện gửi externalAuthors.
        externalMainAuthors:
          body.externalAuthors === undefined
            ? undefined
            : body.externalAuthors.filter(
                (a) => a.isFirst || a.isCorresponding || a.isLast,
              ).length,
      },
    });

    if (body.me) await this.attachSelf(id, userId, { me: body.me as never });
    if (body.coAuthorUserIds)
      await this.invite(id, userId, body.coAuthorUserIds);
    if (body.mainAuthorAtSchool === undefined) await this.recount(id);

    await this.revalidateStaffPages(id);
    this.bus.emit('publication.changed', { id, userIds: [userId] });
    return this.findOne(id, userId);
  }

  /** Xoá mềm, và chỉ gỡ tên MÌNH nếu bài còn tác giả khác đã xác nhận. */
  async remove(userId: string, id: string) {
    await this.assertConfirmedAuthor(id, userId);
    const others = await this.prisma.publicationAuthor.count({
      where: {
        publicationId: id,
        claimStatus: 'CONFIRMED',
        userId: { not: userId },
      },
    });

    if (others > 0) {
      await this.prisma.publicationAuthor.updateMany({
        where: { publicationId: id, userId },
        data: { claimStatus: 'REJECTED', respondedAt: new Date() },
      });
      await this.recount(id);
    } else {
      await this.prisma.publication.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    }
    await this.revalidateStaffPages(id);
    this.bus.emit('publication.changed', { id, userIds: [userId] });
    return { removed: true, sharedWithOthers: others > 0 };
  }

  // ── Đọc ───────────────────────────────────────────────────────────────────
  async list(userId: string, query: ListPublicationsQueryType) {
    const where: Prisma.PublicationWhereInput = {
      deletedAt: null,
      authors: {
        some: {
          userId,
          claimStatus:
            query.filter === 'pending'
              ? 'PENDING'
              : { in: ['CONFIRMED', 'PENDING'] },
        },
      },
    };
    if (query.year) where.countYear = query.year;
    if (query.status) where.status = query.status;
    if (query.filter === 'unclassified') where.catalogCode = null;
    if (query.filter === 'classified') where.catalogCode = { not: null };
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { containerTitle: { contains: query.q, mode: 'insensitive' } },
        { doi: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [rows, total, unclassified] = await Promise.all([
      this.prisma.publication.findMany({
        where,
        include: this.authorInclude,
        orderBy: [{ countYear: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.publication.count({ where }),
      this.prisma.publication.count({
        where: {
          deletedAt: null,
          catalogCode: null,
          authors: { some: { userId, claimStatus: 'CONFIRMED' } },
          ...(query.year ? { countYear: query.year } : {}),
        },
      }),
    ]);

    return {
      items: rows.map((r) => this.shape(r, userId)),
      total,
      unclassified,
    };
  }

  async findOne(id: string, userId: string) {
    const row = await this.prisma.publication.findFirst({
      where: { id, deletedAt: null },
      include: this.authorInclude,
    });
    if (!row) throw PublicationNotFoundException;
    return this.shape(row, userId);
  }

  private get authorInclude() {
    return AUTHOR_INCLUDE;
  }

  private shape(row: PublicationWithAuthors, userId: string) {
    const mine = row.authors.find((a) => a.userId === userId);
    return {
      ...row,
      authorsRaw: (row.authorsRaw ?? []) as AuthorRow[],
      isClassified: Boolean(row.catalogCode),
      myClaimStatus: mine?.claimStatus ?? null,
      myShowOnWeb: mine?.showOnWeb ?? true,
      authors: row.authors.map((a) => ({
        id: a.id,
        userId: a.userId,
        displayName: [a.user?.lastName, a.user?.firstName]
          .filter(Boolean)
          .join(' '),
        email: a.user?.email ?? '',
        authorIndex: a.authorIndex,
        isFirst: a.isFirst,
        isCorresponding: a.isCorresponding,
        isLast: a.isLast,
        sharePercent: a.sharePercent,
        claimStatus: a.claimStatus,
        invitedBy: a.invitedBy,
        respondedAt: a.respondedAt,
        showOnWeb: a.showOnWeb,
      })),
    };
  }

  private async assertConfirmedAuthor(publicationId: string, userId: string) {
    const row = await this.prisma.publicationAuthor.findUnique({
      where: { publicationId_userId: { publicationId, userId } },
      select: { claimStatus: true },
    });
    if (!row || row.claimStatus !== 'CONFIRMED') throw NotAnAuthorException;
  }

  // ── Xác nhận tác giả ──────────────────────────────────────────────────────
  /** "Có bài nào đang chờ bạn xác nhận không?" */
  async pendingClaims(userId: string) {
    const rows = await this.prisma.publicationAuthor.findMany({
      where: {
        userId,
        claimStatus: 'PENDING',
        publication: { deletedAt: null },
      },
      include: {
        publication: {
          select: {
            id: true,
            title: true,
            containerTitle: true,
            countYear: true,
            doi: true,
            authorsRaw: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const inviterIds = [
      ...new Set(rows.map((r) => r.invitedBy).filter(Boolean)),
    ];
    const inviters = await this.prisma.user.findMany({
      where: { id: { in: inviterIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(
      inviters.map((u) => [
        u.id,
        [u.lastName, u.firstName].filter(Boolean).join(' '),
      ]),
    );

    // Gợi ý sẵn "bạn là tác giả thứ mấy" để người xác nhận chỉ phải bấm đồng ý.
    const me = await this.prisma.scholarProfile.findUnique({
      where: { userId },
      select: {
        orcid: true,
        nameVariants: { select: { normalized: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });
    const self: CandidateProfile[] = me
      ? [
          {
            userId,
            orcid: me.orcid,
            normalizedVariants: me.nameVariants.map((v) => v.normalized),
            displayName: [me.user.lastName, me.user.firstName]
              .filter(Boolean)
              .join(' '),
          },
        ]
      : [];

    return rows.map((r) => {
      const authors = (r.publication.authorsRaw ?? []) as AuthorRow[];
      const hit = self.length ? matchAuthors(authors, self)[0] : undefined;
      return {
        publicationId: r.publication.id,
        title: r.publication.title,
        containerTitle: r.publication.containerTitle,
        year: r.publication.countYear,
        doi: r.publication.doi,
        invitedBy: r.invitedBy,
        invitedByName: r.invitedBy ? (nameOf.get(r.invitedBy) ?? null) : null,
        authorsRaw: authors,
        suggestedAuthorIndex: hit?.authorIndex ?? r.authorIndex,
      };
    });
  }

  async respondToClaim(
    userId: string,
    publicationId: string,
    body: ClaimResponseBodyType,
  ) {
    const row = await this.prisma.publicationAuthor.findUnique({
      where: { publicationId_userId: { publicationId, userId } },
      select: { claimStatus: true },
    });
    if (!row) throw NoClaimException;

    const a = body.authorship ?? {};
    this.assertRepresentative(a);

    await this.prisma.publicationAuthor.update({
      where: { publicationId_userId: { publicationId, userId } },
      data: {
        claimStatus: body.accept ? 'CONFIRMED' : 'REJECTED',
        respondedAt: new Date(),
        authorIndex: body.accept ? (a.authorIndex ?? undefined) : undefined,
        isFirst: body.accept ? (a.isFirst ?? undefined) : false,
        isCorresponding: body.accept ? (a.isCorresponding ?? undefined) : false,
        isLast: body.accept ? (a.isLast ?? undefined) : false,
        sharePercent: body.accept ? (a.sharePercent ?? undefined) : null,
        showOnWeb: body.accept ? (a.showOnWeb ?? undefined) : false,
      },
    });
    await this.recount(publicationId);
    await this.revalidateStaffPages(publicationId);
    this.bus.emit('publication.changed', {
      id: publicationId,
      userIds: [userId],
    });
    return this.findOne(publicationId, userId);
  }

  // ── Thống kê ──────────────────────────────────────────────────────────────
  async stats(userId?: string) {
    const scope: Prisma.PublicationWhereInput = {
      deletedAt: null,
      ...(userId
        ? { authors: { some: { userId, claimStatus: 'CONFIRMED' as const } } }
        : {}),
    };

    const [byYearRaw, byQuartileRaw, byStatusRaw, classifiedRaw] =
      await Promise.all([
        this.prisma.publication.groupBy({
          by: ['countYear'],
          where: scope,
          _count: { _all: true },
        }),
        this.prisma.publication.groupBy({
          by: ['quartile'],
          where: scope,
          _count: { _all: true },
        }),
        this.prisma.publication.groupBy({
          by: ['status'],
          where: scope,
          _count: { _all: true },
        }),
        this.prisma.publication.groupBy({
          by: ['countYear'],
          where: { ...scope, catalogCode: { not: null } },
          _count: { _all: true },
        }),
      ]);

    const classifiedByYear = new Map(
      classifiedRaw.map((r) => [r.countYear, r._count._all]),
    );

    return {
      byYear: byYearRaw
        .map((r) => ({
          year: r.countYear,
          total: r._count._all,
          classified: classifiedByYear.get(r.countYear) ?? 0,
        }))
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
      byQuartile: byQuartileRaw.map((r) => ({
        quartile: r.quartile,
        count: r._count._all,
      })),
      byStatus: byStatusRaw.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
    };
  }

  /**
   * Dữ liệu thô toàn Khoa cho trang thống kê admin. Trả từng công bố / đề tài với
   * đúng các trường cần để bên nhận tự lọc (năm, khoảng tháng) và tổng hợp —
   * không quy đổi giờ, không phân trang (vài trăm dòng). `budget` là BigInt trong
   * CSDL nên đổi sang Number để JSON hoá được.
   */
  async facultyDetail() {
    const [publications, projects] = await Promise.all([
      this.prisma.publication.findMany({
        where: { deletedAt: null },
        select: {
          type: true,
          countYear: true,
          publishedMonth: true,
          acceptedMonth: true,
          status: true,
          quartile: true,
          catalogCode: true,
        },
      }),
      this.prisma.researchProject.findMany({
        select: {
          status: true,
          startYear: true,
          startMonth: true,
          endYear: true,
          endMonth: true,
          budget: true,
        },
      }),
    ]);
    return {
      publications,
      projects: projects.map((p) => ({
        ...p,
        budget: p.budget == null ? null : Number(p.budget),
      })),
    };
  }

  /**
   * Báo cáo chi tiết toàn Khoa (danh sách công bố + đề tài) — ghép sẵn tên tác
   * giả / chủ nhiệm / thành viên để bên nhận chỉ việc trải ra bảng Excel.
   */
  async facultyReport() {
    const vietName = (u?: { firstName: string | null; lastName: string | null } | null) =>
      u ? [u.lastName, u.firstName].filter(Boolean).join(' ').trim() : '';

    const [pubs, projects] = await Promise.all([
      this.prisma.publication.findMany({
        where: { deletedAt: null },
        orderBy: [{ countYear: 'desc' }, { publishedMonth: 'desc' }],
        select: {
          type: true,
          countYear: true,
          publishedYear: true,
          publishedMonth: true,
          acceptedYear: true,
          acceptedMonth: true,
          status: true,
          quartile: true,
          catalogCode: true,
          title: true,
          containerTitle: true,
          volume: true,
          issue: true,
          pages: true,
          issn: true,
          doi: true,
          url: true,
          totalAuthors: true,
          authorsRaw: true,
          authors: {
            where: { claimStatus: 'CONFIRMED' },
            select: {
              isFirst: true,
              isCorresponding: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.researchProject.findMany({
        orderBy: [{ startYear: 'desc' }, { startMonth: 'desc' }],
        select: {
          decisionNo: true,
          title: true,
          status: true,
          startYear: true,
          startMonth: true,
          endYear: true,
          endMonth: true,
          members: {
            select: {
              role: true,
              externalName: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    return {
      publications: pubs.map((p) => {
        const raw = (Array.isArray(p.authorsRaw) ? p.authorsRaw : []) as Array<{
          name?: string;
          given?: string;
          family?: string;
        }>;
        const authorNames = raw
          .map((a) => a.name || [a.given, a.family].filter(Boolean).join(' '))
          .map((s) => (s ?? '').trim())
          .filter(Boolean);
        const first = p.authors.find((a) => a.isFirst);
        const corr = p.authors.find((a) => a.isCorresponding);
        return {
          type: p.type,
          countYear: p.countYear,
          publishedYear: p.publishedYear,
          publishedMonth: p.publishedMonth,
          acceptedYear: p.acceptedYear,
          acceptedMonth: p.acceptedMonth,
          status: p.status,
          quartile: p.quartile,
          catalogCode: p.catalogCode,
          title: p.title,
          containerTitle: p.containerTitle,
          volume: p.volume,
          issue: p.issue,
          pages: p.pages,
          issn: p.issn,
          doi: p.doi,
          url: p.url,
          totalAuthors: p.totalAuthors,
          authorNames,
          firstAuthor: vietName(first?.user) || authorNames[0] || '',
          correspondingAuthor: vietName(corr?.user),
        };
      }),
      projects: projects.map((pr) => {
        const lead = pr.members.find((m) => m.role === 'LEAD');
        const memberNames = pr.members
          .map((m) => (m.user ? vietName(m.user) : (m.externalName ?? '')).trim())
          .filter(Boolean);
        return {
          decisionNo: pr.decisionNo,
          title: pr.title,
          status: pr.status,
          startYear: pr.startYear,
          startMonth: pr.startMonth,
          endYear: pr.endYear,
          endMonth: pr.endMonth,
          leadName: lead ? (lead.user ? vietName(lead.user) : (lead.externalName ?? '')) : '',
          memberNames,
          memberCount: pr.members.length,
        };
      }),
    };
  }

  // ── API tích hợp cho ACADsoom ─────────────────────────────────────────────
  /**
   * CHỈ trả bài đã phân loại và tác giả đã xác nhận. Không trả giờ quy đổi —
   * xem ghi chú ở IntegrationPublicationResSchema.
   */
  /**
   * Kênh cho ACADsoom. Hai chế độ, và chế độ thứ hai mới là chỗ bảo đảm:
   *
   *   không `since` — ảnh chụp hiện trạng: chỉ bài còn sống, đã phân loại, tác
   *                   giả đã xác nhận. Dùng cho lần nạp đầu.
   *   có `since`    — phần đã đổi từ mốc đó, KỂ CẢ bài vừa xoá hoặc vừa bị rút
   *                   phân loại (`removed: true`). Không trả mấy cái đó thì bên
   *                   nhận không có đường nào biết mà bỏ đi, và số liệu của họ
   *                   cứ phình mãi.
   *
   * Webhook có thể mất gói; lần quét `since` kế tiếp lấy đúng phần đã sót, nên
   * đồng bộ không phụ thuộc vào việc mỗi cú hích đều tới nơi.
   */
  async integrationList(query: IntegrationQueryType) {
    const { since } = query;
    const years =
      query.from || query.to
        ? {
            countYear: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {};

    const rows = await this.prisma.publicationAuthor.findMany({
      where: {
        ...(query.email
          ? { user: { email: query.email.toLowerCase() } }
          : query.emails
            ? {
                user: {
                  email: {
                    in: query.emails
                      .split(',')
                      .map((e) => e.trim().toLowerCase())
                      .filter(Boolean),
                  },
                },
              }
            : {}),
        ...(since
          ? {
              // Bài đổi mà dòng tác giả không đổi (vd sửa quartile), hoặc ngược
              // lại (vd rút xác nhận) — phải bắt cả hai phía.
              OR: [
                { updatedAt: { gte: since } },
                { publication: { updatedAt: { gte: since } } },
              ],
              publication: years,
            }
          : {
              claimStatus: 'CONFIRMED',
              publication: {
                deletedAt: null,
                catalogCode: { not: null },
                // Bài ĐÃ RÚT không còn là công trình nữa — cùng loại với bài đã
                // xoá, không phải công trình hạng thấp hơn. Để lọt ra kênh tích
                // hợp là nó tiếp tục cộng giờ NCKH sau khi tạp chí đã gỡ bài.
                status: { not: 'RETRACTED' },
                ...years,
              },
            }),
      },
      include: {
        // Kèm các tác giả ĐÃ XÁC NHẬN để đếm được số tác giả chính — xem
        // `mainAuthorsAtSchool` ở dưới.
        publication: {
          include: {
            authors: {
              where: { claimStatus: 'CONFIRMED' },
              select: { isFirst: true, isCorresponding: true, isLast: true },
            },
          },
        },
        user: { select: { email: true } },
      },
      orderBy: { publication: { countYear: 'desc' } },
    });

    const mapped = rows.map((r) => {
      const p = r.publication;
      // Người ĐƯỢC HỎI có ghi địa chỉ Trường trên CHÍNH bài này không — câu hỏi
      // theo từng cặp (người × bài) mà 4 con số của cả bài không trả lời được (ca
      // A/B/C). Lấy từ `authorsRaw[authorIndex].isNonSchool`:
      //   true  = có ghi địa chỉ Trường   → false = KHÔNG   → null = chưa xác định
      // ACADsoom hiểu 3 trạng thái: false → 0 giờ, null → tính như cũ.
      const raw = Array.isArray(p.authorsRaw)
        ? (p.authorsRaw as Array<Record<string, unknown>>)
        : [];
      const nguoiDuocHoi =
        r.authorIndex != null && r.authorIndex >= 0 ? raw[r.authorIndex] : null;
      const authorAtSchool =
        nguoiDuocHoi && typeof nguoiDuocHoi === 'object'
          ? nguoiDuocHoi.isNonSchool === true
            ? false
            : true
          : null;
      return {
        changedAt: laterOf(r.updatedAt, p.updatedAt),
        item: {
          publicationId: p.id,
          doi: p.doi,
          // CÁCH NHẬP, để ACADsoom quyết có đòi minh chứng không: nguồn tự truy
          // xuất (crossref/openalex/orcid/arxiv/…) thì miễn; 'Khai tay'/'manual'/
          // import file thì tự khai → phải nộp minh chứng (yêu cầu của trưởng khoa).
          source: p.source ?? null,
          title: p.title,
          venue: p.containerTitle,
          url: p.url,
          status: p.status,
          countYear: p.countYear,
          publishedYear: p.publishedYear,
          publishedMonth: p.publishedMonth,
          acceptedYear: p.acceptedYear,
          acceptedMonth: p.acceptedMonth,
          catalogCode: p.catalogCode,
          quartile: p.quartile,
          satellite: p.satellite,
          reprint: p.reprint,
          fromProject: p.fromProject,
          stage: p.stage,
          totalAuthors: p.totalAuthors,
          schoolAuthors: p.schoolAuthors,
          mainAuthorAtSchool: p.mainAuthorAtSchool,
          // ĐẾM, không phải cờ đúng/sai. Cách 2 của Phụ lục 2 chia phần của tác
          // giả chính là `1/3 ÷ số tác giả chính thuộc Trường` — mẫu số đó không
          // suy ra được từ một boolean. ACADsoom trước đây buộc phải đoán bằng 1,
          // nên bài có HAI tác giả chính cùng thuộc Trường thì mỗi người nhận
          // 1/3 thay vì 1/6: cộng gấp đôi, và tổng phần chia cho Trường vượt 100%.
          //
          // Đếm tại chỗ từ danh sách đã xác nhận thay vì thêm cột: `recount()` đã
          // giữ đúng dữ liệu cần, thêm cột chỉ tạo thêm một chỗ để lệch.
          mainAuthorsAtSchool: p.authors.filter(
            (a) => a.isFirst || a.isCorresponding || a.isLast,
          ).length,
          // TỔNG tác giả chính CỦA BÀI = (chính thuộc Trường, đếm sống) + (chính
          // NGOÀI Trường, lưu lúc khai). Đây mới là mẫu số thật của phần 1/3 (mục 1).
          mainAuthors:
            p.authors.filter(
              (a) => a.isFirst || a.isCorresponding || a.isLast,
            ).length + (p.externalMainAuthors ?? 0),
          isMainAuthor: r.isFirst || r.isCorresponding || r.isLast,
          sharePercent: r.sharePercent,

          // Vị trí của CHÍNH người được hỏi. Không ảnh hưởng công thức — Phụ lục
          // 2 chỉ phân biệt tác giả chính với đồng tác giả — nhưng khi số giờ ra
          // không như mong đợi, bên ACADsoom cần chỉ được rằng sai nằm ở dữ liệu
          // vị trí tác giả chứ không phải ở phép tính.
          authorIndex: r.authorIndex,
          isFirst: r.isFirst,
          isCorresponding: r.isCorresponding,
          isLast: r.isLast,
          // Người được hỏi có ghi địa chỉ Trường trên bài này (3 trạng thái).
          authorAtSchool,
          email: r.user?.email ?? null,
          // Ba đường dẫn tới "thôi không tính nữa", gộp thành một cờ để bên nhận
          // khỏi phải tự suy luận: xoá bài, rút phân loại, rút xác nhận.
          // Bốn đường dẫn tới "thôi không tính nữa", gộp thành một cờ để bên
          // nhận khỏi phải tự suy luận: xoá bài, rút phân loại, rút xác nhận,
          // và tạp chí rút bài.
          removed:
            p.deletedAt !== null ||
            p.catalogCode === null ||
            p.status === 'RETRACTED' ||
            r.claimStatus !== 'CONFIRMED',
        },
      };
    });

    if (!since) return { items: mapped.map((m) => m.item) };
    return pageBySince(mapped, query.limit);
  }

  /**
   * Diện đang học sau đại học cho ACADsoom. Hai chế độ như các kênh khác:
   *
   *   không `since` — ảnh chụp: mọi người ĐANG khai một diện học (gradStudyLevel
   *                   khác trống). Dùng cho lần nạp đầu.
   *   có `since`    — hồ sơ đổi từ mốc đó, KỂ CẢ người vừa GỠ diện học
   *                   (`removed: true`, `level = null`). Không trả cái đó thì bên
   *                   nhận không có đường nào biết mà thôi giảm định mức, và
   *                   người học xong vẫn được giảm mãi.
   *
   * Chỉ trả dữ kiện — bậc, quốc gia, năm bắt đầu/dự kiến xong, có được cử đi toàn
   * thời gian không. Việc chọn diện nào và áp hệ số bao nhiêu là của ACADsoom.
   */
  async gradStudyIntegrationList(query: IntegrationQueryType) {
    const { since } = query;
    const rows = await this.prisma.scholarProfile.findMany({
      where: {
        ...(query.email
          ? { user: { email: query.email.toLowerCase() } }
          : query.emails
            ? {
                user: {
                  email: {
                    in: query.emails
                      .split(',')
                      .map((e) => e.trim().toLowerCase())
                      .filter(Boolean),
                  },
                },
              }
            : {}),
        // Ảnh chụp: chỉ người đang khai một diện. Chế độ `since`: mọi hồ sơ vừa
        // đổi, kể cả người vừa xoá diện học (để gửi `removed`).
        ...(since
          ? { updatedAt: { gte: since } }
          : { gradStudyLevel: { not: null } }),
      },
      include: { user: { select: { email: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    const mapped = rows.map((r) => ({
      changedAt: r.updatedAt,
      item: {
        email: r.user?.email ?? null,
        level: r.gradStudyLevel,
        field: r.gradStudyField,
        institution: r.gradStudyInstitution,
        country: r.gradStudyCountry,
        startYear: r.gradStudyStartYear,
        endYear: r.gradStudyEndYear,
        fullTime: r.gradStudyFullTime,
        note: r.gradStudyNote,
        // Ảnh chụp đã lọc `gradStudyLevel != null` nên luôn false ở đó; ở chế độ
        // `since`, hồ sơ vừa gỡ diện học (level = null) thành removed: true.
        removed: r.gradStudyLevel === null,
      },
    }));

    if (!since) return { items: mapped.map((m) => m.item) };
    return pageBySince(mapped, query.limit);
  }

  /**
   * Hồ sơ nhân sự cho ACADsoom (Mục 10). Web Khoa LÀM CHỦ; đây là chỗ ACADsoom
   * kéo về. Trả dữ kiện người + danh sách đơn vị, KHÔNG trả giờ/định mức. Hai chế
   * độ như các kênh khác. `id` = physoomId (định danh bất biến); chưa có thì tạm
   * dùng `User.id` để không rỗng — lượt nạp lần đầu sẽ điền physoomId.
   */
  async staffIntegrationList(query: IntegrationQueryType) {
    const { since } = query;
    const units = await this.prisma.department.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, unitKind: true, order: true },
    });
    const users = await this.prisma.user.findMany({
      where: {
        // Chỉ phát NGƯỜI THẬT (role LECTURER). Loại tài khoản chức năng (admin
        // bộ môn vllt_admin…) và bản trùng ADMIN — vd Ngân có 2 bản ADMIN
        // (nguyenvuongthuyngan@ / ngannguyen@) cạnh bản thật nvtngan@ (LECTURER).
        // Không lọc thì PHYsoom/ACADsoom kéo về sẽ tạo tài khoản rác/trùng.
        role: 'LECTURER',
        ...(query.email
          ? { email: query.email.toLowerCase() }
          : query.emails
            ? {
                email: {
                  in: query.emails
                    .split(',')
                    .map((e) => e.trim().toLowerCase())
                    .filter(Boolean),
                },
              }
            : {}),
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
      select: {
        id: true,
        physoomId: true,
        email: true,
        firstName: true,
        lastName: true,
        teacherId: true,
        degree: true,
        rank: true,
        positionKey: true,
        positionFrom: true,
        positionTo: true,
        departmentId: true,
        employmentType: true,
        isActive: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const ngay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const mapped = users.map((u) => ({
      changedAt: u.updatedAt,
      item: {
        id: u.physoomId || u.id,
        email: u.email,
        // Tên tiếng Việt: HỌ+ĐỆM (lastName) trước, TÊN GỌI (firstName) sau.
        // splitVietnameseName lưu firstName = từ cuối (tên gọi), lastName = phần
        // còn lại — nên [firstName, lastName] ra "Ngân Nguyễn Vương Thùy" (đảo,
        // PHYsoom thấy sai tùm lum); phải [lastName, firstName] mới đúng
        // "Nguyễn Vương Thùy Ngân".
        name: [u.lastName, u.firstName].filter(Boolean).join(' ') || u.email,
        teacherId: u.teacherId,
        degree: u.degree,
        rank: u.rank,
        position: u.positionKey,
        positionFrom: ngay(u.positionFrom),
        positionTo: ngay(u.positionTo),
        unitId: u.departmentId,
        employmentType: u.employmentType,
        active: u.isActive,
        // Chế độ `since`: người tắt hoạt động thì bên nhận ẩn đi.
        removed: !u.isActive,
      },
    }));

    const unitItems = units.map((u) => ({
      id: u.id,
      name: u.name,
      kind: u.unitKind,
      order: u.order,
    }));

    if (!since) return { units: unitItems, items: mapped.map((m) => m.item) };
    return { units: unitItems, ...pageBySince(mapped, query.limit) };
  }

  /**
   * Physoom ĐẨY một người sang: thêm tài khoản ở web Khoa khi bên đó tạo user.
   *
   * Ghép người theo physoomId trước (định danh bất biến), không có thì theo email.
   * Physoom CHỈ phát định danh (email + tên) — không phát chức vụ/vai trò; web
   * Khoa tự giữ role. Nên:
   *  - TẠO MỚI: role LECTURER, isActive true (như luồng SSO). Người mới do Physoom
   *    thêm không được là ADMIN (default của schema là ADMIN — phải ép LECTURER).
   *  - ĐÃ CÓ: chỉ vá physoomId/teacherId, cập nhật tên; KHÔNG đụng role/isActive
   *    (đăng nhập lại mà bị hạ quyền là mất trang quản trị).
   */
  async upsertUserFromPhysoom(data: {
    email: string;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    physoomId?: string | null;
    teacherId?: string | null;
  }) {
    const email = String(data.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Thiếu email');

    // Physoom gửi `name` nguyên khối; nếu không tách sẵn first/last thì đặt cả
    // tên vào firstName để phần hiển thị `first + last` ra đúng nguyên tên.
    const firstName = (data.firstName ?? data.name ?? '').trim() || null;
    const lastName = (data.lastName ?? '').trim() || null;
    const physoomId = (data.physoomId ?? '').trim() || null;
    const teacherId = (data.teacherId ?? '').trim() || null;

    // Ưu tiên ghép theo physoomId; chưa có thì theo email.
    const existing = physoomId
      ? await this.prisma.user.findFirst({
          where: { OR: [{ physoomId }, { email }] },
          select: { id: true },
        })
      : await this.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });

    if (existing) {
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          email,
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          ...(physoomId ? { physoomId } : {}),
          ...(teacherId ? { teacherId } : {}),
          // KHÔNG đặt role / isActive ở đây.
        },
        select: { id: true, email: true, physoomId: true },
      });
      return { created: false, ...updated };
    }

    const createdUser = await this.prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        physoomId,
        teacherId,
        role: 'LECTURER',
        isActive: true,
      },
      select: { id: true, email: true, physoomId: true },
    });
    return { created: true, ...createdUser };
  }

  /**
   * NẠP LẦN ĐẦU (Mục 10.7) — đổ ngược dữ liệu nhân sự từ ACADsoom lên web Khoa
   * MỘT LƯỢT, rồi từ đó web Khoa làm gốc. ~38 ngạch Khoa vá tay + đơn vị hiện chỉ
   * có ở ACADsoom. Ghép người theo EMAIL (web Khoa chưa có physoomId), điền
   * physoomId/teacherId/rank/positionKey + đơn vị (khớp theo tên). KHÔNG đụng
   * name/degree/employmentType (ACADsoom không phát hai cái sau; name giữ nguyên).
   */
  async staffInitialLoad() {
    const base = (process.env.ACADSOOM_BASE_URL || '').replace(/\/$/, '');
    const secret = process.env.WEBKHOA_PULL_SECRET || '';
    if (!base || !secret) {
      return { error: 'Chưa đặt ACADSOOM_BASE_URL / WEBKHOA_PULL_SECRET' };
    }
    let data: {
      items?: Array<{
        email: string;
        physoomId?: string;
        teacherId?: string;
        rank?: string;
        position?: string;
        unit?: string;
      }>;
    };
    try {
      const res = await fetch(`${base}/api/integration/staff`, {
        headers: { 'x-webkhoa-secret': secret },
      });
      if (!res.ok) return { error: `ACADsoom trả ${res.status}` };
      data = await res.json();
    } catch (e) {
      return { error: `Không gọi được ACADsoom: ${(e as Error).message}` };
    }

    const depts = await this.prisma.department.findMany({
      select: { id: true, name: true },
    });

    // ── Cầu tên bộ môn ─────────────────────────────────────────────────────
    // ACADsoom và web Khoa đặt tên khác quy ước: ACADsoom có tiền tố "Bộ môn ",
    // hoa/thường và dấu gạch khác nhau ("Hải Dương - Khí tượng Thủy văn" vs
    // "Hải dương - Khí tượng- Thủy văn"), Unicode có thể ở NFC/NFD khác nhau.
    // Khớp nguyên văn trượt cả 7 bộ môn. Quy hai bên về một dạng chuẩn rồi mới
    // ghép — KHÔNG đổi tên bên nào (xem Mục 10, docs/yeu-cau-web-khoa.md).
    const chuan = (s: string) =>
      s
        .normalize('NFC')
        .toLowerCase()
        .replace(/^bộ môn\s+/u, '') // chỉ ACADsoom có tiền tố này
        .replace(/[\s\-–—]+/gu, ' ') // gộp gạch nối + khoảng trắng
        .trim();
    // Alias tên→id cho ca không có chữ chung với tên web Khoa. TRỐNG có chủ
    // đích: "Văn phòng Khoa" KHÔNG gộp vào Khoa Vật lý — nó là đơn vị riêng.
    // Khi nào web Khoa có Department "Văn phòng Khoa" thì cầu tự khớp nguyên
    // văn, không cần alias; tới đó nhóm này còn nằm trong donViLa (giữ nguyên
    // departmentId), đúng ý "Văn phòng Khoa là Văn phòng Khoa".
    const ALIAS: Record<string, string> = {};
    const deptByChuan = new Map(depts.map((d) => [chuan(d.name), d.id]));
    const tenById = new Map(depts.map((d) => [d.id, d.name]));
    const timDept = (unitName: string): string | null => {
      if (!unitName) return null;
      const key = chuan(unitName);
      if (ALIAS[key]) return ALIAS[key];
      const exact = deptByChuan.get(key);
      if (exact) return exact;
      // Tên web Khoa dài hơn ("vật lý hạt nhân kthn vlyk" ⊃ "vật lý hạt nhân").
      // Chỉ nhận khi DUY NHẤT một bộ môn có tiền tố khớp — mơ hồ thì bỏ.
      const hits = depts.filter((d) => chuan(d.name).startsWith(key));
      return hits.length === 1 ? hits[0].id : null;
    };

    const report = {
      doi: 0,
      khongKhopEmail: [] as string[],
      donViLa: new Set<string>(),
      mapDonVi: {} as Record<string, string>, // tên ACADsoom → tên web Khoa (soát ghép)
    };
    for (const it of data.items ?? []) {
      const email = String(it.email ?? '').toLowerCase();
      if (!email) continue;
      const unitName = String(it.unit ?? '').trim();
      const deptId = timDept(unitName);
      if (unitName && !deptId) report.donViLa.add(unitName);
      if (unitName && deptId && !report.mapDonVi[unitName])
        report.mapDonVi[unitName] = tenById.get(deptId) ?? deptId;
      const res = await this.prisma.user.updateMany({
        where: { email },
        data: {
          physoomId: it.physoomId || undefined,
          teacherId: it.teacherId || undefined,
          rank: it.rank || undefined,
          positionKey: it.position || undefined,
          ...(deptId ? { departmentId: deptId } : {}),
        },
      });
      if (res.count) report.doi++;
      else report.khongKhopEmail.push(email);
    }
    return { ...report, donViLa: [...report.donViLa] };
  }

  // ── Trang nhân sự ─────────────────────────────────────────────────────────
  /**
   * Trang nhân sự chạy ISR nên phải báo Next dựng lại; cùng CSDL nên không có
   * bước đồng bộ nào khác. Hỏng thì bỏ qua — không để việc khai báo thất bại chỉ
   * vì webhook không gọi được.
   */
  private async revalidateStaffPages(publicationId: string) {
    try {
      const authors = await this.prisma.publicationAuthor.findMany({
        where: { publicationId, claimStatus: 'CONFIRMED' },
        select: {
          user: {
            select: { scholarProfile: { select: { staffPageSlug: true } } },
          },
        },
      });
      const tags = authors
        .map((a) => a.user.scholarProfile?.staffPageSlug)
        .filter((s): s is string => Boolean(s))
        .map((slug) => `page:${slug}`);
      if (tags.length) this.publicRevalidate.trigger([...new Set(tags)]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Không revalidate được trang nhân sự: ${msg}`);
    }
  }
}

/** Đếm thô số mục trong file thư mục, để báo bao nhiêu mục bị bỏ qua. */
function countEntries(content: string): number {
  const bib = content.match(/@\w+\s*\{/g)?.length ?? 0;
  const ris = content.match(/^\s*TY\s{2}-\s/gm)?.length ?? 0;
  return Math.max(bib, ris);
}
