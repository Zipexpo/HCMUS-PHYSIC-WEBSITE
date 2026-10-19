import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import { PublicRevalidateService } from '../shared/services/public-revalidate.service';
import {
  danhGiaCap,
  hangCuaNguoi,
  joinAuthorName,
  matchAuthors,
  normalizeName,
  suggestNameVariants,
  type CandidateProfile,
} from './name-match';
import {
  laKhaiTay,
  soatTacGia,
  type BaiSoat,
  type NguoiSoat,
} from './soat-tac-gia';
import { laterOf, pageBySince } from './integration-cursor';
import { tacGiaBaoCao } from './report-authors';
import {
  laEmailGmail,
  laEmailSinhVien,
  splitVietnameseName,
} from '../auth/physoom-sso';
import { parseBibliographyFile } from './resolve/bibliography';
import { ResolveService } from './resolve/resolve.service';
import { StaffPageService } from './staff-page.service';
import {
  khoaTieuDe,
  laBanThao,
  normalizeDoi,
  resolveCountYear,
  type ResolvedWork,
} from './resolve/work';
import {
  CannotResolveException,
  HangDaCoNguoiException,
  HangNgoaiDanhSachException,
  KhongPhaiBanTrungException,
  LastSaiViTriException,
  MotTacGiaChuaXacNhanException,
  SoatKhongConDungException,
  SoTacGiaLechException,
  TrungCongBoException,
  NoClaimException,
  NoOrcidException,
  NotAnAuthorException,
  NotEligibleRepresentativeException,
  OrcidTakenException,
  PositionalRoleException,
  PublicationNotFoundException,
  ShareSetByRepresentativeException,
  TooFewAuthorsException,
  TotalShareExceededException,
} from './scholar.error';
import type {
  ClaimResponseBodyType,
  CoAuthorRoleType,
  CreatePublicationBodyType,
  IntegrationQueryType,
  ListPublicationsQueryType,
  OrcidImportBodyType,
  SetEducationBodyType,
  SetNameVariantsBodyType,
  SoatTacGiaQueryType,
  SoatThaoTacBodyType,
  TrungQueryType,
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
  isNonSchool?: boolean | null;
};

/** Một tài khoản trên bài, sau khi áp các thay đổi hàng của lần lưu này. */
type HangTaiKhoan = {
  userId: string;
  authorIndex: number;
  /** Hàng đổi trong lần lưu này — chỉ hàng ĐỔI mới bị soát trùng/ngoài danh sách. */
  doi: boolean;
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

/** First / Corresponding / Last — người được làm ĐẠI DIỆN nhóm khai Cách 1. */
const laTacGiaChinh = (
  x?: {
    isFirst?: boolean | null;
    isCorresponding?: boolean | null;
    isLast?: boolean | null;
  } | null,
) => !!(x?.isFirst || x?.isCorresponding || x?.isLast);

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
    return this.decorate(work, userId, true);
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
  private async decorate(
    work: ResolvedWork,
    userId: string,
    timBanDaDang = false,
  ) {
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

    // Bản thảo (arXiv…) không được tính — tra luôn bản đã đăng khi xem MỘT bài
    // (nhập hàng loạt từ ORCID thì chỉ gắn cờ, khỏi gọi Crossref trăm lần).
    const banThao = laBanThao(work);
    const banDaDang =
      banThao && timBanDaDang
        ? await this.resolver.timBanDaDang(work).catch(() => null)
        : null;

    return {
      work,
      existingPublicationId: existing?.id ?? null,
      suggestions: matches.map((m) => ({
        ...m,
        displayName: byId.get(m.userId)?.displayName ?? '',
        email: byId.get(m.userId)?.email ?? '',
        isMe: m.userId === userId,
      })),
      laBanThao: banThao,
      ...(timBanDaDang ? { banDaDang } : {}),
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

    // Người khai đã thấy bài CÙNG TÊN trên hệ thống và chọn gắn tên mình vào đó.
    if (body.ganVaoBai) return this.ganVaoBaiCo(userId, body);

    // Bài đã có (đồng nghiệp khai trước) → KHÔNG tạo bản thứ hai, chỉ gắn thêm
    // người gọi vào bài đó. Đây là điểm mấu chốt: một bài dùng chung cho cả nhóm.
    if (doi) {
      const existing = await this.prisma.publication.findFirst({
        where: { doi, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        await this.kiemHangCuaToi(existing.id, userId, body.me);
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

    // Chốt danh sách tác giả + chặn công trình trùng tên — trước MỌI lệnh ghi.
    this.kiemKhaiMoi(body);
    // Cách 1: đại diện (tác giả chính) khai tỷ lệ cho cả nhóm — xem kiemTyLe.
    this.kiemTyLe({
      daiDien: laTacGiaChinh(body.me),
      cuaToi: body.me?.sharePercent,
      dongTacGia: body.memberUpdates,
      ngoai: body.externalAuthors,
    });
    if (!body.khongTrung) {
      const trung = await this.timTrung(w.title, doi, userId);
      if (trung.length) {
        throw TrungCongBoException(
          trung.map((b) => ({ title: b.title, nam: b.year, nguoiKhai: b.nguoiKhai })),
        );
      }
    }

    const authorsRaw = (w.authors ?? []) as unknown as Prisma.InputJsonValue;
    const publishedYear = body.publishedYear ?? w.publishedYear ?? null;
    const acceptedYear = body.acceptedYear ?? w.acceptedYear ?? null;

    const pubData: Prisma.PublicationUncheckedCreateInput = {
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
    };

    // Hồi sinh dòng cùng DOI đã XOÁ MỀM thay vì insert bản mới. Unique index trên
    // `doi` GỒM cả dòng đã xoá mềm, nên khai lại một bài từng bị xoá sẽ đụng ràng
    // buộc và văng 500 (đúng lỗi người dùng gặp). Ghi đè toàn bộ dữ liệu mới lên
    // dòng cũ, dựng lại danh sách tác giả từ đầu — kết quả như một lần khai mới,
    // giữ nguyên id nên không đụng khoá ngoài nào.
    if (doi) {
      const dead = await this.prisma.publication.findFirst({
        where: { doi, deletedAt: { not: null } },
        select: { id: true },
      });
      if (dead) {
        await this.prisma.publicationAuthor.deleteMany({
          where: { publicationId: dead.id },
        });
        await this.prisma.publication.update({
          where: { id: dead.id },
          data: { ...pubData, deletedAt: null },
        });
        await this.attachSelf(dead.id, userId, body);
        await this.invite(
          dead.id,
          userId,
          body.coAuthorUserIds ?? [],
          body.memberUpdates,
        );
        await this.ganVaiTroDongTacGia(
          dead.id,
          userId,
          body.memberUpdates,
          laTacGiaChinh(body.me),
        );
        await this.recount(dead.id);
        this.bus.emit('publication.changed', {
          id: dead.id,
          userIds: [userId, ...(body.coAuthorUserIds ?? [])],
        });
        return this.findOne(dead.id, userId);
      }
    }

    const created = await this.prisma.publication
      .create({ data: pubData, select: { id: true } })
      .catch((e: unknown) => {
        // Chốt an toàn: nếu VẪN đụng unique DOI (đua giữa hai lần khai cùng lúc,
        // hoặc dữ liệu lạ) thì báo tử tế thay vì để Prisma ném thành 500.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new BadRequestException(
            'Công bố có cùng DOI/mã định danh đã tồn tại trong hệ thống.',
          );
        }
        throw e;
      });

    await this.attachSelf(created.id, userId, body);
    await this.invite(
      created.id,
      userId,
      body.coAuthorUserIds ?? [],
      body.memberUpdates,
    );
    await this.ganVaiTroDongTacGia(
      created.id,
      userId,
      body.memberUpdates,
      laTacGiaChinh(body.me),
    );
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
    const cu = await this.prisma.publicationAuthor.findUnique({
      where: { publicationId_userId: { publicationId, userId } },
      select: { sharePercent: true },
    });
    this.kiemTyLe({
      daiDien: laTacGiaChinh(me),
      cuaToi: me.sharePercent,
      cuaToiCu: cu ? cu.sharePercent : undefined,
    });
    // Không phải tác giả chính thì tỷ lệ của mình do ĐẠI DIỆN khai — giữ nguyên
    // thứ đang có (kể cả khi form gửi null). Đại diện: null = xoá (về Cách 2).
    const tyLe = laTacGiaChinh(me) ? me.sharePercent : undefined;
    await this.prisma.publicationAuthor.upsert({
      where: { publicationId_userId: { publicationId, userId } },
      create: {
        publicationId,
        userId,
        authorIndex: me.authorIndex ?? -1,
        isFirst: me.isFirst ?? false,
        isCorresponding: me.isCorresponding ?? false,
        isLast: me.isLast ?? false,
        sharePercent: tyLe ?? null,
        showOnWeb: me.showOnWeb ?? true,
        claimStatus: 'CONFIRMED',
        respondedAt: new Date(),
      },
      update: {
        authorIndex: me.authorIndex ?? undefined,
        isFirst: me.isFirst ?? undefined,
        isCorresponding: me.isCorresponding ?? undefined,
        isLast: me.isLast ?? undefined,
        sharePercent: tyLe,
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
    hang: CoAuthorRoleType[] = [],
  ) {
    const others = [...new Set(userIds)].filter((id) => id && id !== invitedBy);
    if (!others.length) return;
    // Hàng người khai đã gắn cho từng người — để người chưa bấm vẫn có chỗ trên
    // bài (vào mẫu số tác giả chính nếu có vai trò, Khoa chốt 4/10/2026).
    const hangCua = new Map(
      hang
        .filter((m) => m.authorIndex != null && m.authorIndex >= 0)
        .map((m) => [m.userId, m.authorIndex as number] as const),
    );
    await this.prisma.publicationAuthor.createMany({
      data: others.map((userId) => ({
        publicationId,
        userId,
        invitedBy,
        claimStatus: 'PENDING' as const,
        authorIndex: hangCua.get(userId) ?? -1,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Ghi vai trò (First/Corresponding/Last) của ĐỒNG TÁC GIẢ trong Khoa theo bảng
   * tác giả người đang lưu gửi lên — xem CoAuthorRoleSchema.
   *
   * Vai trò được IN TRÊN BÀI chứ không phải lời tự nhận, nên tác giả đã xác nhận
   * nào cũng sửa được cho người khác, như sửa tên tạp chí. Đây là đường DUY NHẤT
   * gỡ được một cờ nhận nhầm (vd hai người cùng tick "Corresponding" lúc xác
   * nhận). Nhưng đổi vai trò là đổi giờ NCKH của người ta, nên mỗi lần sửa dòng
   * của người ĐÃ XÁC NHẬN đều ghi AuditLog: ai sửa, của ai, trước/sau. Dòng còn
   * chờ (lời mời) thì không ghi — chính người được mời sẽ chọn lại lúc xác nhận.
   *
   * Chừa ra: người gọi (vai trò của mình đi qua `me`), người đã TỪ CHỐI, và người
   * không có trên bài — mảng này không thêm được ai, đó là việc của
   * coAuthorUserIds. Chỉ ghi dòng thật sự đổi: lưu lại mà không sửa gì thì không
   * chạm ai. Trả về userId của những người vừa đổi.
   *
   * `choChia` — người lưu là tác giả chính, tức ĐẠI DIỆN nhóm của Cách 1 (Phụ lục
   * 2 tr. 2.5): khi đó áp luôn tỷ lệ chia giờ của từng đồng tác giả, kể cả người
   * còn chờ xác nhận (tỷ lệ nằm sẵn trên dòng, lúc họ bấm đồng ý thì đi sang
   * ACADsoom). Không phải đại diện thì tỷ lệ gửi kèm bị bỏ qua — form nạp lại
   * tỷ lệ của mọi người mỗi lần mở, nên đó chỉ là con số cũ đi một vòng.
   */
  private async ganVaiTroDongTacGia(
    publicationId: string,
    callerId: string,
    updates: CoAuthorRoleType[] = [],
    choChia = false,
  ): Promise<{ doi: string[]; boLienHe: string[] }> {
    const theoNguoi = new Map(
      updates
        .filter((m) => m.userId !== callerId)
        .map((m) => [m.userId, m] as const),
    );
    if (!theoNguoi.size) return { doi: [], boLienHe: [] };

    const rows = await this.prisma.publicationAuthor.findMany({
      where: {
        publicationId,
        userId: { in: [...theoNguoi.keys()] },
        claimStatus: { not: 'REJECTED' },
      },
      select: {
        userId: true,
        claimStatus: true,
        authorIndex: true,
        isFirst: true,
        isCorresponding: true,
        isLast: true,
        sharePercent: true,
      },
    });

    const doi: string[] = [];
    // Người đã xác nhận vừa bị NGƯỜI KHÁC bỏ cờ "liên hệ" — xem baoBoVaiTroLienHe.
    const boLienHe: string[] = [];
    const ghi: Prisma.PrismaPromise<unknown>[] = [];
    for (const r of rows) {
      const m = theoNguoi.get(r.userId);
      if (!m) continue;
      const before = {
        isFirst: r.isFirst,
        isCorresponding: r.isCorresponding,
        isLast: r.isLast,
        sharePercent: r.sharePercent,
      };
      const after = {
        isFirst: m.isFirst ?? r.isFirst,
        isCorresponding: m.isCorresponding ?? r.isCorresponding,
        isLast: m.isLast ?? r.isLast,
        sharePercent:
          choChia && m.sharePercent !== undefined
            ? m.sharePercent
            : r.sharePercent,
      };
      // Hàng đổi khi danh sách tác giả được sửa (bớt/thêm/đổi thứ tự hàng) —
      // đã soát trùng/ngoài danh sách ở kiemSuaDanhSach trước khi tới đây.
      const doiHang =
        m.authorIndex !== undefined && m.authorIndex !== r.authorIndex;
      if (
        !doiHang &&
        after.isFirst === before.isFirst &&
        after.isCorresponding === before.isCorresponding &&
        after.isLast === before.isLast &&
        after.sharePercent === before.sharePercent
      ) {
        continue;
      }
      doi.push(r.userId);
      ghi.push(
        this.prisma.publicationAuthor.update({
          where: { publicationId_userId: { publicationId, userId: r.userId } },
          data: doiHang ? { ...after, authorIndex: m.authorIndex } : after,
        }),
      );
      if (r.claimStatus === 'CONFIRMED') {
        if (before.isCorresponding && !after.isCorresponding) {
          boLienHe.push(r.userId);
        }
        ghi.push(
          this.prisma.auditLog.create({
            data: {
              userId: callerId,
              action: 'publication.coauthor-role',
              entityType: 'Publication',
              entityId: publicationId,
              changes: {
                coAuthorUserId: r.userId,
                before: doiHang ? { ...before, authorIndex: r.authorIndex } : before,
                after: doiHang ? { ...after, authorIndex: m.authorIndex } : after,
              },
            },
          }),
        );
      }
    }
    if (ghi.length) await this.prisma.$transaction(ghi);
    return { doi, boLienHe };
  }

  /**
   * CÁCH 1 — tỷ lệ chia giờ do ĐẠI DIỆN nhóm khai cho cả nhóm (Phụ lục 2 tr. 2.5,
   * Khoa chốt 10/10/2026). Gọi TRƯỚC mọi lệnh ghi.
   *
   *   daiDien     người lưu là tác giả chính theo vai trò SAU lượt lưu này
   *   cuaToi      tỷ lệ của chính mình gửi lên (undefined = không gửi)
   *   cuaToiCu    tỷ lệ đang lưu; undefined = chưa có dòng (khai mới)
   *   dongTacGia  tỷ lệ của đồng tác giả trong Khoa (memberUpdates)
   *   ngoai       tỷ lệ của tác giả ngoài Khoa (externalAuthors)
   *
   * Không phải đại diện: được GỬI LẠI đúng con số đang có — form nạp sẵn tỷ lệ
   * đại diện đã khai — nhưng không được tự đổi. Trước 10/10 chỗ này chặn mọi tỷ
   * lệ của người không phải tác giả chính, nên đồng tác giả có tỷ lệ do đại diện
   * khai sẽ không lưu được bài, cũng không xác nhận được lời mời.
   * Đại diện: tổng cả nhóm không vượt 100%.
   */
  private kiemTyLe({
    daiDien,
    cuaToi,
    cuaToiCu,
    dongTacGia = [],
    ngoai = [],
  }: {
    daiDien: boolean;
    cuaToi?: number | null;
    cuaToiCu?: number | null;
    dongTacGia?: { sharePercent?: number | null }[];
    ngoai?: { sharePercent?: number | null }[];
  }) {
    if (!daiDien) {
      if (cuaToi != null && cuaToi !== (cuaToiCu ?? null)) {
        throw cuaToiCu === undefined
          ? NotEligibleRepresentativeException
          : ShareSetByRepresentativeException;
      }
      return;
    }
    const cong = (ds: { sharePercent?: number | null }[]) =>
      ds.reduce((t, x) => t + (x.sharePercent ?? 0), 0);
    const cuaMinh = cuaToi === undefined ? (cuaToiCu ?? 0) : (cuaToi ?? 0);
    if (cuaMinh + cong(dongTacGia) + cong(ngoai) > 100) {
      throw TotalShareExceededException;
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
        authorsRaw: true,
        totalAuthors: true,
        externalMainAuthors: true,
      },
    });
    if (!current) throw PublicationNotFoundException;

    if (
      body.totalAuthors !== undefined &&
      body.totalAuthors < (body.schoolAuthors ?? current.schoolAuthors)
    ) {
      throw TooFewAuthorsException;
    }
    // Cách 1 — đại diện (tác giả chính) khai tỷ lệ cho cả nhóm. Vai trò lấy theo
    // lượt lưu này, không gửi thì theo dòng đang lưu. Soát TRƯỚC mọi lệnh ghi.
    const meCu = await this.prisma.publicationAuthor.findUnique({
      where: { publicationId_userId: { publicationId: id, userId } },
      select: {
        sharePercent: true,
        isFirst: true,
        isCorresponding: true,
        isLast: true,
      },
    });
    const daiDien = laTacGiaChinh(body.me ?? meCu);
    this.kiemTyLe({
      daiDien,
      cuaToi: body.me?.sharePercent,
      cuaToiCu: meCu?.sharePercent ?? null,
      dongTacGia: body.memberUpdates,
      ngoai: body.externalAuthors,
    });
    // Danh sách tác giả nhất quán (T = số hàng, hàng không trùng, Last đứng cuối).
    await this.kiemSuaDanhSach(id, userId, body, current);
    // Không ai bỏ được vai trò theo vị trí — kiểm TRƯỚC mọi lệnh ghi.
    const chinhTheoViTriThuocTruong = await this.chotVaiTroTheoViTri(
      id,
      userId,
      body,
      current,
    );

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
        // Tác giả đầu/cuối thuộc Trường thì bài CÓ tác giả chính thuộc Trường —
        // form gửi `false` cũng không hạ được (xem chotVaiTroTheoViTri).
        mainAuthorAtSchool:
          body.mainAuthorAtSchool === undefined
            ? undefined
            : body.mainAuthorAtSchool || chinhTheoViTriThuocTruong,
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
      await this.invite(id, userId, body.coAuthorUserIds, body.memberUpdates);
    // SAU invite, để người vừa được thêm cũng nhận vai trò đã chọn cho họ.
    const { doi: doiVaiTro, boLienHe } = await this.ganVaiTroDongTacGia(
      id,
      userId,
      body.memberUpdates,
      daiDien,
    );
    const daRut = body.rutMoi?.length
      ? await this.rutLoiMoi(id, userId, body.rutMoi)
      : [];
    if (body.mainAuthorAtSchool === undefined || daRut.length) await this.recount(id);

    await this.revalidateStaffPages(id);
    this.bus.emit('publication.changed', {
      id,
      userIds: [userId, ...doiVaiTro, ...daRut],
    });
    if (boLienHe.length) await this.baoBoVaiTroLienHe(id, boLienHe);
    return this.findOne(id, userId);
  }

  /**
   * Người lưu RÚT lời mời CHÍNH MÌNH đã gửi (người kia chưa bấm gì) — vd mời nhầm
   * theo gợi ý tên na ná. Chỉ dòng PENDING có invitedBy = người lưu: không ai rút
   * được lời mời của người khác, càng không gỡ được người đã xác nhận. Xoá hẳn dòng
   * chờ (ghi REJECTED thì lời mời đúng sau này bị `skipDuplicates` nuốt) + AuditLog.
   *
   * Khoa KHÔNG có đường huỷ hộ (5/10/2026): soát từng lời mời nghi nhầm thấy có bài
   * mà danh sách tác giả trên web Khoa thiếu người — huỷ hộ là tước bài của tác giả
   * thật. Người trong cuộc tự quyết: người được mời bấm «Không phải tôi», người mời
   * rút lời mời của mình.
   */
  private async rutLoiMoi(
    publicationId: string,
    userId: string,
    ids: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.publicationAuthor.findMany({
      where: {
        publicationId,
        userId: { in: [...new Set(ids)] },
        claimStatus: 'PENDING',
        invitedBy: userId,
      },
      select: {
        userId: true,
        authorIndex: true,
        isFirst: true,
        isCorresponding: true,
        isLast: true,
      },
    });
    if (!rows.length) return [];
    await this.prisma.$transaction([
      this.prisma.publicationAuthor.deleteMany({
        where: {
          publicationId,
          userId: { in: rows.map((r) => r.userId) },
          claimStatus: 'PENDING',
          invitedBy: userId,
        },
      }),
      ...rows.map((r) =>
        this.prisma.auditLog.create({
          data: {
            userId,
            action: 'publication.withdraw-invite',
            entityType: 'Publication',
            entityId: publicationId,
            changes: { invitedUserId: r.userId, before: r },
          },
        }),
      ),
    ]);
    return rows.map((r) => r.userId);
  }

  /**
   * Báo cho người VỪA BỊ đồng tác giả bỏ cờ "tác giả liên hệ" (Khoa chốt
   * 4/10/2026): vai trò đó đổi giờ NCKH của chính họ, và trước đây họ chỉ biết
   * khi số giờ tụt. Web Khoa không gửi thư; ACADsoom có email + thông báo đẩy,
   * nên sự kiện mang theo ĐỊA CHỈ. Không bao giờ làm hỏng việc lưu.
   */
  private async baoBoVaiTroLienHe(publicationId: string, userIds: string[]) {
    try {
      const ds = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { email: true },
      });
      const emails = ds.map((u) => u.email).filter(Boolean);
      if (!emails.length) return;
      this.bus.emit('publication.role-removed', {
        id: publicationId,
        userIds,
        emails,
        key: 'isCorresponding',
      });
    } catch {
      // thông báo là phụ — lỗi thì thôi, bài vẫn lưu
    }
  }

  /**
   * KHÔNG AI BỎ ĐƯỢC VAI TRÒ THEO VỊ TRÍ (Khoa chốt 4/10/2026): người đứng đầu
   * danh sách tác giả là tác giả đầu, người đứng cuối là tác giả cuối — sự thật
   * in trên bài, và Phụ lục 2 tr. 2.5 tính cả hai là tác giả chính. Ca thật: một
   * đồng tác giả bỏ cờ "tác giả cuối" của người đứng 4/4 trên hai bài, form ghi
   * lại số tác giả chính ngoài hệ thống = 0, và giờ NCKH chuyển sang người sửa.
   *
   * Chỉ chặn việc BỎ (cờ đang có → tắt), không bắt sửa dữ liệu cũ đang thiếu cờ:
   * lưu lại một bài không được vì lỗi người khác để lại từ trước thì vô lý. Người
   * ngoài hệ thống không có dòng riêng, chỉ có SỐ (`externalMainAuthors`) — chặn
   * số đó tụt xuống dưới số hàng đầu/cuối không gắn tài khoản.
   *
   * Trả về: bài có tác giả đầu/cuối THUỘC TRƯỜNG không — sàn cho
   * `mainAuthorAtSchool` mà form gửi lên.
   */
  private async chotVaiTroTheoViTri(
    publicationId: string,
    userId: string,
    body: UpdatePublicationBodyType,
    hienTai: {
      authorsRaw?: Prisma.JsonValue;
      totalAuthors?: number | null;
      externalMainAuthors?: number | null;
    },
  ): Promise<boolean> {
    const raw = (
      Array.isArray(body.authorsRaw)
        ? body.authorsRaw
        : Array.isArray(hienTai.authorsRaw)
          ? hienTai.authorsRaw
          : []
    ) as unknown as Array<Record<string, unknown> | null>;
    // Vị trí đếm theo DANH SÁCH TÁC GIẢ (hàng), giống form; chưa có danh sách thì
    // chỉ còn số khai tay — vẫn đủ biết hàng cuối của người có tài khoản.
    const soTacGia =
      raw.length || body.totalAuthors || hienTai.totalAuthors || 0;
    if (soTacGia < 1) return false;
    const rows = await this.prisma.publicationAuthor.findMany({
      where: { publicationId, claimStatus: { not: 'REJECTED' } },
      select: { userId: true, authorIndex: true, isFirst: true, isLast: true },
    });
    const sua = new Map(
      (body.memberUpdates ?? []).map((m) => [m.userId, m] as const),
    );
    const ten = (i: number) => {
      const a = raw[i];
      const t = a
        ? String(a.name ?? [a.given, a.family].filter(Boolean).join(' ')).trim()
        : '';
      return t ? `«${t}»` : `Người đứng hàng ${i + 1}`;
    };
    const daGan = new Set<number>();
    let thuocTruong = false;
    for (const r of rows) {
      const cuaToi = r.userId === userId;
      const moi = cuaToi ? body.me : sua.get(r.userId);
      const viTri =
        cuaToi && body.me?.authorIndex != null
          ? body.me.authorIndex
          : r.authorIndex;
      if (viTri == null || viTri < 0) continue;
      daGan.add(viTri);
      const can = vaiTroTheoViTri(viTri, soTacGia);
      // Người tự dời hàng thì vai trò đi theo hàng mới — chỉ xét hàng giữ nguyên.
      const giuHang = viTri === r.authorIndex;
      if (giuHang && can.isFirst && r.isFirst && moi?.isFirst === false) {
        throw PositionalRoleException(
          `${ten(viTri)} đứng đầu danh sách tác giả`,
        );
      }
      if (giuHang && can.isLast && r.isLast && moi?.isLast === false) {
        throw PositionalRoleException(
          `${ten(viTri)} đứng cuối danh sách tác giả (${viTri + 1}/${soTacGia})`,
        );
      }
      if ((can.isFirst || can.isLast) && raw[viTri]?.isNonSchool !== true) {
        thuocTruong = true;
      }
    }
    // Hàng đầu/cuối KHÔNG gắn tài khoản = tác giả chính ngoài hệ thống.
    const ngoai = (
      raw.length ? [0, ...(soTacGia > 1 ? [soTacGia - 1] : [])] : []
    ).filter((i) => !daGan.has(i));
    if (body.externalAuthors !== undefined && ngoai.length) {
      const moi = body.externalAuthors.filter(
        (a) => a.isFirst || a.isCorresponding || a.isLast,
      ).length;
      const cu = hienTai.externalMainAuthors ?? 0;
      if (moi < cu && moi < ngoai.length) {
        const viTriChu =
          ngoai.length > 1 ? 'đầu và cuối' : ngoai[0] === 0 ? 'đầu' : 'cuối';
        throw PositionalRoleException(
          `${ngoai.map(ten).join(', ')} đứng ${viTriChu} danh sách tác giả`,
        );
      }
    }
    if (ngoai.some((i) => raw[i]?.isNonSchool === false)) thuocTruong = true;
    return thuocTruong;
  }

  // ── Chốt danh sách tác giả (5/10/2026) ────────────────────────────────────
  // Mỗi chốt ứng với một lỗi đã gặp trên dữ liệu thật — xem soat-tac-gia.ts.

  /**
   * Khai MỚI: T = số hàng của danh sách; hàng của mình và của người được gắn nằm
   * trong danh sách, không trùng nhau; Last Author đứng cuối; khai tay một tác
   * giả phải tự xác nhận. Không đọc CSDL.
   */
  private kiemKhaiMoi(body: CreatePublicationBodyType) {
    const w = body.work;
    const soHang = w.authors?.length ?? 0;
    const soTacGia = body.totalAuthors ?? Math.max(1, soHang);
    if (soHang > 0 && soTacGia !== soHang) {
      throw SoTacGiaLechException(soTacGia, soHang);
    }
    const n = soHang || soTacGia;
    const ten = (i: number) => {
      const a = w.authors?.[i];
      return a ? joinAuthorName(a) : '';
    };
    const hang = [
      { userId: '__toi__', authorIndex: body.me.authorIndex ?? -1, last: body.me.isLast },
      ...(body.memberUpdates ?? []).map((m) => ({
        userId: m.userId,
        authorIndex: m.authorIndex ?? -1,
        last: m.isLast === true,
      })),
    ];
    const giu = new Map<number, string>();
    for (const h of hang) {
      if (h.authorIndex < 0) continue;
      if (h.authorIndex >= n) throw HangNgoaiDanhSachException(h.authorIndex, n);
      if (giu.has(h.authorIndex)) {
        throw HangDaCoNguoiException(h.authorIndex, ten(h.authorIndex), 'người khác');
      }
      giu.set(h.authorIndex, h.userId);
      if (h.last && n > 1 && h.authorIndex !== n - 1) {
        throw LastSaiViTriException(
          ten(h.authorIndex) || 'Người này',
          h.authorIndex,
          n,
        );
      }
    }
    if (laKhaiTay(w.source) && soTacGia === 1 && !body.motTacGia) {
      throw MotTacGiaChuaXacNhanException;
    }
  }

  /**
   * SỬA bài: T khớp danh sách gửi lên; hàng ĐỔI trong lần lưu này (của mình,
   * của đồng tác giả) không trùng ai và nằm trong danh sách; Last Author MỚI
   * đánh dấu phải đứng cuối. Dữ liệu cũ đang lệch thì không chặn — chỉ chặn tạo
   * lệch mới; lệch cũ hiện ở danh sách soát của Khoa.
   */
  private async kiemSuaDanhSach(
    publicationId: string,
    userId: string,
    body: UpdatePublicationBodyType,
    hienTai: { authorsRaw?: Prisma.JsonValue; totalAuthors?: number | null },
  ) {
    const raw = (
      Array.isArray(body.authorsRaw)
        ? body.authorsRaw
        : Array.isArray(hienTai.authorsRaw)
          ? hienTai.authorsRaw
          : []
    ) as AuthorRow[];
    if (
      Array.isArray(body.authorsRaw) &&
      body.authorsRaw.length > 0 &&
      body.totalAuthors !== undefined &&
      body.totalAuthors !== body.authorsRaw.length
    ) {
      throw SoTacGiaLechException(body.totalAuthors, body.authorsRaw.length);
    }
    const n = raw.length || body.totalAuthors || hienTai.totalAuthors || 0;
    const rows = await this.prisma.publicationAuthor.findMany({
      where: { publicationId, claimStatus: { not: 'REJECTED' } },
      select: {
        userId: true,
        authorIndex: true,
        isLast: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    const sua = new Map((body.memberUpdates ?? []).map((m) => [m.userId, m]));
    const sau: Array<HangTaiKhoan & { ten: string; lastMoi: boolean }> =
      rows.map((r) => {
        const cuaToi = r.userId === userId;
        const moi = cuaToi ? body.me : sua.get(r.userId);
        const idx =
          moi?.authorIndex != null && moi.authorIndex !== undefined
            ? moi.authorIndex
            : r.authorIndex;
        return {
          userId: r.userId,
          authorIndex: idx,
          doi: idx !== r.authorIndex,
          ten: [r.user?.lastName, r.user?.firstName].filter(Boolean).join(' '),
          lastMoi: moi?.isLast === true && !r.isLast,
        };
      });
    const tenHang = (i: number) => (raw[i] ? joinAuthorName(raw[i]) : '');
    for (const h of sau) {
      if (h.authorIndex < 0) continue;
      if (h.doi) {
        if (n > 0 && h.authorIndex >= n) {
          throw HangNgoaiDanhSachException(h.authorIndex, n);
        }
        const khac = sau.find(
          (x) => x.userId !== h.userId && x.authorIndex === h.authorIndex,
        );
        if (khac) {
          throw HangDaCoNguoiException(h.authorIndex, tenHang(h.authorIndex), khac.ten);
        }
      }
      if (h.lastMoi && n > 1 && h.authorIndex !== n - 1) {
        throw LastSaiViTriException(h.ten || tenHang(h.authorIndex), h.authorIndex, n);
      }
    }
  }

  /**
   * Hàng người gọi chọn khi XÁC NHẬN lời mời / gắn mình vào bài đã có: nằm
   * trong danh sách, chưa ai khác nhận, và tick Last thì phải đứng cuối.
   */
  private async kiemHangCuaToi(
    publicationId: string,
    userId: string,
    a: { authorIndex?: number | null; isLast?: boolean | null },
  ) {
    const idx = a.authorIndex ?? -1;
    if (idx < 0) return;
    const pub = await this.prisma.publication.findUnique({
      where: { id: publicationId },
      select: { authorsRaw: true, totalAuthors: true },
    });
    const raw = (Array.isArray(pub?.authorsRaw) ? pub.authorsRaw : []) as AuthorRow[];
    const n = raw.length || pub?.totalAuthors || 0;
    if (n > 0 && idx >= n) throw HangNgoaiDanhSachException(idx, n);
    const khac = await this.prisma.publicationAuthor.findFirst({
      where: {
        publicationId,
        userId: { not: userId },
        claimStatus: { not: 'REJECTED' },
        authorIndex: idx,
      },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    if (khac) {
      throw HangDaCoNguoiException(
        idx,
        raw[idx] ? joinAuthorName(raw[idx]) : '',
        [khac.user.lastName, khac.user.firstName].filter(Boolean).join(' '),
      );
    }
    if (a.isLast && n > 1 && idx !== n - 1) {
      throw LastSaiViTriException(raw[idx] ? joinAuthorName(raw[idx]) : 'Người này', idx, n);
    }
  }

  /** Hồ sơ khớp tên của MỘT người (tên thật + dạng tên + ORCID). */
  private async hoSoNguoi(userId: string): Promise<CandidateProfile | null> {
    const me = await this.prisma.scholarProfile.findUnique({
      where: { userId },
      select: {
        orcid: true,
        nameVariants: { select: { normalized: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (!me) return null;
    return {
      userId,
      orcid: me.orcid,
      normalizedVariants: me.nameVariants.map((v) => v.normalized),
      displayName: [me.user.lastName, me.user.firstName].filter(Boolean).join(' '),
    };
  }

  // ── Công trình trùng tên (5/10/2026) ──────────────────────────────────────
  /**
   * Bài CÙNG TÊN đang có trên hệ thống (khác DOI hoặc không DOI) — để người khai
   * gắn tên mình vào bài đó thay vì tạo bản thứ hai. Ca thật: một bài khai tay ba
   * lần (hai bản "1 tác giả"), một báo cáo hội nghị khai hai lần bởi hai người.
   * So bằng khoá tên (bỏ dấu, bỏ ký tự đặc biệt) trên mọi bài chưa xoá — vài
   * nghìn dòng, đọc thẳng nhanh hơn dựng chỉ mục.
   */
  async timTrung(title: string, doi: string | null, userId: string) {
    const key = khoaTieuDe(title);
    if (key.length < 15) return [];
    const ds = await this.prisma.publication.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, doi: true },
    });
    const ids = ds
      .filter((p) => khoaTieuDe(p.title) === key && (!doi || p.doi !== doi))
      .map((p) => p.id)
      .slice(0, 5);
    if (!ids.length) return [];
    const rows = await this.prisma.publication.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        doi: true,
        containerTitle: true,
        publishedYear: true,
        acceptedYear: true,
        source: true,
        totalAuthors: true,
        createdBy: true,
        authors: {
          where: { claimStatus: { not: 'REJECTED' } },
          select: {
            userId: true,
            claimStatus: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    const ten = (u: { firstName: string | null; lastName: string | null }) =>
      [u.lastName, u.firstName].filter(Boolean).join(' ');
    const nguoiKhai = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: rows.map((r) => r.createdBy).filter((x): x is string => !!x) } },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((u) => [u.id, ten(u)]),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      doi: r.doi,
      containerTitle: r.containerTitle,
      year: r.publishedYear ?? r.acceptedYear,
      source: r.source,
      totalAuthors: r.totalAuthors,
      tacGia: r.authors.filter((a) => a.claimStatus === 'CONFIRMED').map((a) => ten(a.user)),
      nguoiKhai: r.createdBy ? (nguoiKhai.get(r.createdBy) ?? null) : null,
      daCoToi: r.authors.some((a) => a.userId === userId),
    }));
  }

  /** GET /scholar/publications/trung — giao diện hỏi trước khi lưu. */
  async trung(userId: string, q: TrungQueryType) {
    return { items: await this.timTrung(q.title, normalizeDoi(q.doi), userId) };
  }

  /**
   * Gắn tên mình vào bài CÙNG TÊN đã có (người khai chọn ở hộp "đã có bài này").
   * Hàng của mình dò bằng tên trên danh sách của BÀI ĐÃ CÓ (danh sách trong form
   * có thể khác); không chắc thì để −1 — giao diện nhắc mở bài chọn hàng.
   */
  private async ganVaoBaiCo(userId: string, body: CreatePublicationBodyType) {
    const bai = await this.prisma.publication.findFirst({
      where: { id: body.ganVaoBai, deletedAt: null },
      select: { id: true, title: true, authorsRaw: true, catalogCode: true },
    });
    if (!bai) throw PublicationNotFoundException;
    if (khoaTieuDe(bai.title) !== khoaTieuDe(body.work.title)) {
      throw KhongPhaiBanTrungException;
    }
    const raw = (Array.isArray(bai.authorsRaw) ? bai.authorsRaw : []) as AuthorRow[];
    const toi = await this.hoSoNguoi(userId);
    const hit = toi ? hangCuaNguoi(raw, toi) : null;
    let idx = hit?.chac ? hit.authorIndex : -1;
    if (idx >= 0) {
      const khac = await this.prisma.publicationAuthor.count({
        where: {
          publicationId: bai.id,
          userId: { not: userId },
          claimStatus: { not: 'REJECTED' },
          authorIndex: idx,
        },
      });
      if (khac) idx = -1;
    }
    const n = raw.length;
    await this.attachSelf(bai.id, userId, {
      me: {
        ...body.me,
        authorIndex: idx,
        isFirst: idx === 0 ? true : idx > 0 ? false : body.me.isFirst,
        isLast: idx >= 0 ? n > 1 && idx === n - 1 : body.me.isLast,
      },
    });
    if (body.catalogCode && !bai.catalogCode) {
      await this.prisma.publication.update({
        where: { id: bai.id },
        data: {
          catalogCode: body.catalogCode,
          quartile: body.quartile ?? null,
          classifiedBy: userId,
          classifiedAt: new Date(),
        },
      });
    }
    await this.recount(bai.id);
    await this.revalidateStaffPages(bai.id);
    this.bus.emit('publication.changed', { id: bai.id, userIds: [userId] });
    return this.findOne(bai.id, userId);
  }

  // ── Soát nhận diện tác giả cho Khoa (5/10/2026) ────────────────────────────
  /** Mọi bài chưa xoá + mọi người có hồ sơ, đổ vào soatTacGia (hàm thuần). */
  async soatTacGia(q: SoatTacGiaQueryType) {
    const [bais, users] = await Promise.all([
      this.prisma.publication.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          doi: true,
          source: true,
          totalAuthors: true,
          publishedYear: true,
          publishedMonth: true,
          acceptedYear: true,
          acceptedMonth: true,
          createdBy: true,
          authorsRaw: true,
          authors: {
            select: {
              userId: true,
              authorIndex: true,
              claimStatus: true,
              invitedBy: true,
            },
          },
        },
      }),
      this.prisma.user.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          scholarProfile: {
            select: { orcid: true, nameVariants: { select: { raw: true, normalized: true } } },
          },
        },
      }),
    ]);
    const nguoi = new Map<string, NguoiSoat>(
      users.map((u) => [
        u.id,
        {
          userId: u.id,
          orcid: u.scholarProfile?.orcid ?? null,
          normalizedVariants: u.scholarProfile?.nameVariants.map((v) => v.normalized) ?? [],
          displayName: [u.lastName, u.firstName].filter(Boolean).join(' '),
          bienThe: u.scholarProfile?.nameVariants.map((v) => v.raw) ?? [],
        },
      ]),
    );
    const thang = (b: BaiSoat) => {
      const y = b.publishedYear ?? b.acceptedYear;
      const m = (b.publishedYear ? b.publishedMonth : b.acceptedMonth) ?? 1;
      return y ? `${y}-${String(m).padStart(2, '0')}` : null;
    };
    const trongKy = (b: BaiSoat) => {
      if (!q.tu && !q.den) return true;
      const t = thang(b);
      if (!t) return false;
      return (!q.tu || t >= q.tu) && (!q.den || t <= q.den);
    };
    const ds = bais.map(
      (b): BaiSoat => ({
        ...b,
        authorsRaw: (Array.isArray(b.authorsRaw) ? b.authorsRaw : []) as BaiSoat['authorsRaw'],
      }),
    );
    const items = soatTacGia(ds, nguoi, trongKy);
    const dem: Record<string, number> = {};
    for (const x of items) dem[x.loai] = (dem[x.loai] ?? 0) + 1;
    return {
      tu: q.tu ?? null,
      den: q.den ?? null,
      soBai: ds.filter(trongKy).length,
      dem,
      items,
    };
  }

  /**
   * Khoa GÁN HÀNG cho người đã xác nhận mà chưa chỉ hàng — chỉ khi tên khớp CHẮC
   * đúng một hàng, hàng đó chưa ai nhận và không bị đánh dấu ngoài Trường (khi
   * đó gán hàng đổi giờ của người ta — phải có người xem).
   */
  async soatGanHang(adminId: string, b: SoatThaoTacBodyType) {
    const { publicationId, userId } = b;
    const row = await this.prisma.publicationAuthor.findUnique({
      where: { publicationId_userId: { publicationId, userId } },
      select: { claimStatus: true, authorIndex: true },
    });
    if (!row || row.claimStatus !== 'CONFIRMED' || row.authorIndex >= 0) {
      throw SoatKhongConDungException('Người này không còn ở trạng thái "đã xác nhận, chưa chỉ hàng".');
    }
    const pub = await this.prisma.publication.findFirst({
      where: { id: publicationId, deletedAt: null },
      select: { authorsRaw: true },
    });
    const raw = (Array.isArray(pub?.authorsRaw) ? pub.authorsRaw : []) as AuthorRow[];
    const nguoi = await this.hoSoNguoi(userId);
    const hit = nguoi ? hangCuaNguoi(raw, nguoi) : null;
    if (!hit?.chac) {
      throw SoatKhongConDungException('Không còn thấy đúng một hàng khớp chắc tên người này — sửa tay.');
    }
    if (raw[hit.authorIndex]?.isNonSchool === true) {
      throw SoatKhongConDungException('Hàng khớp tên đang đánh dấu ngoài Trường — cần người xem trước khi gán.');
    }
    const khac = await this.prisma.publicationAuthor.count({
      where: {
        publicationId,
        userId: { not: userId },
        claimStatus: { not: 'REJECTED' },
        authorIndex: hit.authorIndex,
      },
    });
    if (khac) throw SoatKhongConDungException('Hàng khớp tên đã có người khác nhận — sửa tay.');
    await this.prisma.$transaction([
      this.prisma.publicationAuthor.update({
        where: { publicationId_userId: { publicationId, userId } },
        data: { authorIndex: hit.authorIndex },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'publication.admin-assign-row',
          entityType: 'Publication',
          entityId: publicationId,
          changes: {
            userId,
            before: { authorIndex: -1 },
            after: { authorIndex: hit.authorIndex },
            tenHang: joinAuthorName(raw[hit.authorIndex]),
          },
        },
      }),
    ]);
    await this.recount(publicationId);
    this.bus.emit('publication.changed', { id: publicationId, userIds: [userId] });
    return {
      ok: true,
      moTa: `Đã gán hàng ${hit.authorIndex + 1} («${joinAuthorName(raw[hit.authorIndex])}»).`,
    };
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
            totalAuthors: true,
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

    const daNhan = await this.prisma.publicationAuthor.findMany({
      where: {
        publicationId: { in: rows.map((r) => r.publication.id) },
        userId: { not: userId },
        claimStatus: { not: 'REJECTED' },
        authorIndex: { gte: 0 },
      },
      select: {
        publicationId: true,
        authorIndex: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });

    return rows.map((r) => {
      const authors = (r.publication.authorsRaw ?? []) as AuthorRow[];
      const hit = self.length ? hangCuaNguoi(authors, self[0]) : null;
      const hangDaNhan = daNhan
        .filter((x) => x.publicationId === r.publication.id)
        .map((x) => ({
          authorIndex: x.authorIndex,
          displayName: [x.user.lastName, x.user.firstName]
            .filter(Boolean)
            .join(' '),
        }));
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
        goiYChac: Boolean(hit?.chac),
        // Không có danh sách thì không kết luận được gì → không cảnh báo.
        tenCoTrenBai: authors.length ? Boolean(hit) : true,
        danhSachThieu:
          authors.length > 0 && (r.publication.totalAuthors ?? 0) > authors.length,
        hangDaNhan,
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
      select: { claimStatus: true, sharePercent: true },
    });
    if (!row) throw NoClaimException;

    const a = body.authorship ?? {};
    // Tỷ lệ Cách 1 trên dòng này do ĐẠI DIỆN nhóm khai sẵn: người không phải tác
    // giả chính xác nhận thì giữ nguyên nó (gửi lại đúng số cũ cũng được), tác
    // giả chính thì được đặt lại. Xem kiemTyLe.
    const daiDien = laTacGiaChinh(a);
    if (body.accept) {
      this.kiemTyLe({
        daiDien,
        cuaToi: a.sharePercent,
        cuaToiCu: row.sharePercent,
      });
    }
    if (body.accept) await this.kiemHangCuaToi(publicationId, userId, a);

    await this.prisma.publicationAuthor.update({
      where: { publicationId_userId: { publicationId, userId } },
      data: {
        claimStatus: body.accept ? 'CONFIRMED' : 'REJECTED',
        respondedAt: new Date(),
        authorIndex: body.accept ? (a.authorIndex ?? undefined) : undefined,
        isFirst: body.accept ? (a.isFirst ?? undefined) : false,
        isCorresponding: body.accept ? (a.isCorresponding ?? undefined) : false,
        isLast: body.accept ? (a.isLast ?? undefined) : false,
        sharePercent: body.accept
          ? daiDien
            ? (a.sharePercent ?? undefined)
            : undefined
          : null,
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
        where: { deletedAt: null },
        select: {
          status: true,
          startYear: true,
          startMonth: true,
          endYear: true,
          endMonth: true,
          finishedYear: true,
          finishedMonth: true,
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
    const vietName = (
      u?: { firstName: string | null; lastName: string | null } | null,
    ) => (u ? [u.lastName, u.firstName].filter(Boolean).join(' ').trim() : '');

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
          publisher: true,
          isbn: true,
          totalAuthors: true,
          authorsRaw: true,
          authors: {
            where: { claimStatus: 'CONFIRMED' },
            select: {
              authorIndex: true,
              isFirst: true,
              isCorresponding: true,
              isLast: true,
              user: { select: { firstName: true, lastName: true, rank: true } },
            },
          },
        },
      }),
      this.prisma.researchProject.findMany({
        // Đề tài đã xoá (vd bản khai trùng đã dọn) không được lên báo cáo.
        where: { deletedAt: null },
        orderBy: [{ startYear: 'desc' }, { startMonth: 'desc' }],
        select: {
          code: true,
          decisionNo: true,
          catalogCode: true,
          title: true,
          status: true,
          startYear: true,
          startMonth: true,
          endYear: true,
          endMonth: true,
          // Báo cáo liệt kê đề tài ĐANG THỰC HIỆN trong khoảng — đã nghiệm thu
          // thì tới tháng nghiệm thu, không phải hạn kế hoạch.
          finishedYear: true,
          finishedMonth: true,
          members: {
            // Người đã TỪ CHỐI lời mời không còn là thành viên.
            where: { claimStatus: { not: 'REJECTED' } },
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
        // Tác giả trong hệ thống đã xác nhận, theo thứ tự trong bài (chưa rõ vị
        // trí thì xếp cuối) — để bên nhận còn có tên mà ghi khi bài khai tay
        // không kèm danh sách tác giả (authorsRaw rỗng).
        const viTri = (i: number) => (i < 0 ? Number.MAX_SAFE_INTEGER : i);
        const systemAuthors = [...p.authors]
          .sort((a, b) => viTri(a.authorIndex) - viTri(b.authorIndex))
          .map((a) => vietName(a.user))
          .filter(Boolean);
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
          publisher: p.publisher,
          isbn: p.isbn,
          totalAuthors: p.totalAuthors,
          authorNames,
          systemAuthors,
          firstAuthor: vietName(first?.user) || authorNames[0] || '',
          correspondingAuthor: vietName(corr?.user),
          authorDetails: tacGiaBaoCao(
            p.authorsRaw,
            p.authors.map((a) => ({
              authorIndex: a.authorIndex,
              isFirst: a.isFirst,
              isCorresponding: a.isCorresponding,
              isLast: a.isLast,
              name: vietName(a.user),
              rank: a.user?.rank ?? null,
            })),
          ),
        };
      }),
      projects: projects.map((pr) => {
        const lead = pr.members.find((m) => m.role === 'LEAD');
        const memberNames = pr.members
          .map((m) =>
            (m.user ? vietName(m.user) : (m.externalName ?? '')).trim(),
          )
          .filter(Boolean);
        return {
          code: pr.code,
          decisionNo: pr.decisionNo,
          catalogCode: pr.catalogCode,
          title: pr.title,
          status: pr.status,
          startYear: pr.startYear,
          startMonth: pr.startMonth,
          endYear: pr.endYear,
          endMonth: pr.endMonth,
          finishedYear: pr.finishedYear,
          finishedMonth: pr.finishedMonth,
          leadName: lead
            ? lead.user
              ? vietName(lead.user)
              : (lead.externalName ?? '')
            : '',
          memberNames,
          memberCount: pr.members.length,
        };
      }),
    };
  }

  /**
   * TIẾN ĐỘ KHAI BÁO toàn Khoa cho tab theo dõi (admin). Mỗi cán bộ giảng dạy /
   * nghiên cứu — giảng viên, cộng tài khoản quản trị mà là cán bộ thật (có MSCB);
   * không gồm văn phòng, chuyên viên, thỉnh giảng (xem phép lọc bên dưới):
   *  - đã khai công bố/đề tài chưa: đếm bản ghi đã XÁC NHẬN của chính họ — bài
   *    người khác gắn tên mà họ chưa xác nhận (PENDING) không tính;
   *  - hồ sơ trên web: `updated` = đã tự bổ sung (giới thiệu / hướng nghiên cứu /
   *    giảng dạy / mục thêm / danh sách bài / ảnh tải mới). Ảnh `/uploads/legacy/`
   *    và khối `html` KHÔNG tính: lượt migrate từ web cũ chép nguyên hai thứ đó
   *    sang, nên có chúng chưa chứng tỏ người đó đã động tay (`legacy`). `empty` =
   *    trang hệ thống tự dựng còn trống, `nopage` = chưa có trang.
   * Lưu trang cá nhân không để lại lịch sử ai sửa, nên chỉ suy được từ nội dung.
   */
  async declareProgress() {
    type ProfileState = 'updated' | 'legacy' | 'empty' | 'nopage';
    const STAFF_TYPES = new Set(['StaffProfileEditorial', 'StaffProfile']);
    const asStr = (v: unknown): string => {
      if (typeof v === 'string') return v.trim();
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return String(o.vi ?? '').trim() || String(o.en ?? '').trim();
      }
      return '';
    };
    const listFilled = (v: unknown): boolean =>
      Array.isArray(v) &&
      v.some(
        (e) =>
          !!e &&
          typeof e === 'object' &&
          Object.values(e as Record<string, unknown>).some((x) => !!asStr(x)),
      );
    // Props của khối hồ sơ trong cây Puck (trang cá nhân chỉ có một khối).
    const staffProps = (x: unknown): Record<string, unknown> | null => {
      if (!x || typeof x !== 'object') return null;
      const node = x as { type?: unknown; props?: Record<string, unknown> };
      if (typeof node.type === 'string' && STAFF_TYPES.has(node.type)) {
        return node.props ?? {};
      }
      for (const v of Array.isArray(x) ? x : Object.values(x)) {
        const hit = staffProps(v);
        if (hit) return hit;
      }
      return null;
    };
    const classify = (p: Record<string, unknown>): ProfileState => {
      const photo = asStr(p.photo);
      if (
        asStr(p.intro) ||
        listFilled(p.research) ||
        listFilled(p.teaching) ||
        listFilled(p.extras) ||
        listFilled(p.publications) ||
        (photo && !photo.includes('/uploads/legacy/'))
      ) {
        return 'updated';
      }
      const html = asStr(p.html)
        .replace(/<[^>]*>|&nbsp;/g, ' ')
        .trim();
      return photo || html ? 'legacy' : 'empty';
    };

    const [taiKhoan, pubCounts, projCounts] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          isActive: true,
          OR: [{ role: 'LECTURER' }, { teacherId: { gt: '' } }],
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          rank: true,
          employmentType: true,
          department: { select: { name: true, kind: true } },
          scholarProfile: {
            select: { staffPageSlug: true, affiliationType: true },
          },
        },
      }),
      this.prisma.publicationAuthor.groupBy({
        by: ['userId'],
        where: { claimStatus: 'CONFIRMED' },
        _count: { _all: true },
      }),
      this.prisma.projectMember.groupBy({
        by: ['userId'],
        where: { claimStatus: 'CONFIRMED', userId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const pubBy = new Map(pubCounts.map((r) => [r.userId, r._count._all]));
    const projBy = new Map(projCounts.map((r) => [r.userId, r._count._all]));

    // Chỉ cán bộ GIẢNG DẠY / NGHIÊN CỨU. Bỏ: tài khoản thuộc đơn vị không phải bộ
    // môn (kind 'unit': Văn phòng Khoa — có cả tài khoản nhóm "BCN Khoa" —, CLB,
    // Đoàn–Hội), chuyên viên/nhân viên (không có nhiệm vụ NCKH), và thỉnh giảng
    // (không tính vào thống kê của Khoa — xem AffiliationType). Lọc ở đây chứ
    // không ở `where`: rank/employmentType có thể NULL, mà NOT IN của SQL loại
    // luôn dòng NULL.
    const KHONG_NCKH = new Set(['CV', 'NV']);
    const users = taiKhoan.filter(
      (u) =>
        u.department?.kind !== 'unit' &&
        !KHONG_NCKH.has(u.rank ?? '') &&
        u.employmentType !== 'thinh_giang' &&
        u.scholarProfile?.affiliationType !== 'VISITING',
    );

    const slugs = [
      ...new Set(
        users
          .map((u) => u.scholarProfile?.staffPageSlug)
          .filter((s): s is string => !!s),
      ),
    ];
    const pages = slugs.length
      ? await this.prisma.pageLayout.findMany({
          where: { slug: { in: slugs }, deletedAt: null },
          select: { slug: true, puckData: true, publishedPuckData: true },
        })
      : [];
    const stateBySlug = new Map<string, ProfileState>();
    for (const pg of pages) {
      // Bản đã xuất bản là thứ người xem thấy; trang chưa xuất bản thì xét nháp.
      const props =
        staffProps(pg.publishedPuckData) ?? staffProps(pg.puckData);
      if (props && !stateBySlug.has(pg.slug)) {
        stateBySlug.set(pg.slug, classify(props));
      }
    }

    const people = users
      .map((u) => {
        const pubCount = pubBy.get(u.id) ?? 0;
        const projCount = projBy.get(u.id) ?? 0;
        const slug = u.scholarProfile?.staffPageSlug;
        const profile: ProfileState =
          (slug && stateBySlug.get(slug)) || 'nopage';
        return {
          email: u.email,
          name: [u.lastName, u.firstName].filter(Boolean).join(' ').trim(),
          department: u.department?.name ?? '',
          rank: u.rank ?? '',
          pubCount,
          projCount,
          declared: pubCount + projCount > 0,
          profile,
        };
      })
      // Theo bộ môn rồi tên; người CHƯA gán bộ môn xếp cuối.
      .sort(
        (a, b) =>
          Number(!a.department) - Number(!b.department) ||
          a.department.localeCompare(b.department, 'vi') ||
          a.name.localeCompare(b.name, 'vi'),
      );
    return { people };
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
        // Kèm các tài khoản CHƯA TỪ CHỐI để đếm được số tác giả chính — xem
        // `chinh` ở dưới.
        publication: {
          include: {
            authors: {
              where: { claimStatus: { not: 'REJECTED' } },
              select: {
                claimStatus: true,
                authorIndex: true,
                isFirst: true,
                isCorresponding: true,
                isLast: true,
              },
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
      // TÁC GIẢ CHÍNH CÓ TÀI KHOẢN — đã xác nhận HOẶC chưa bấm (Khoa chốt
      // 4/10/2026: xác nhận hay chưa thì phần của họ vẫn phải giữ, chỉ "không
      // phải tôi" mới trả phần đó lại). Người chưa bấm chỉ đếm khi đã được chỉ
      // HÀNG: chưa chỉ hàng thì form phys-profile coi hàng của họ là người ngoài
      // hệ thống và đã cộng vào `externalMainAuthors` — đếm thêm là đếm hai lần.
      const laChinh = (a: {
        isFirst: boolean;
        isCorresponding: boolean;
        isLast: boolean;
      }) => a.isFirst || a.isCorresponding || a.isLast;
      const chinh = p.authors.filter(
        (a) =>
          laChinh(a) &&
          (a.claimStatus === 'CONFIRMED' || (a.authorIndex ?? -1) >= 0),
      );
      // Người chưa bấm mà hàng của họ ghi địa chỉ Trường. `mainAuthorAtSchool`
      // lưu trong bài chỉ tính người đã xác nhận (recount), nên thiếu phần này
      // thì đồng tác giả hưởng P/T thay vì 2/3·P/T cho tới khi người kia chịu bấm.
      const chinhChuaBamThuocTruong = chinh.filter(
        (a) =>
          a.claimStatus !== 'CONFIRMED' &&
          raw[a.authorIndex ?? -1]?.isNonSchool !== true,
      );
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
          mainAuthorAtSchool:
            p.mainAuthorAtSchool || chinhChuaBamThuocTruong.length > 0,
          // ĐẾM, không phải cờ đúng/sai. Cách 2 của Phụ lục 2 chia phần của tác
          // giả chính là `1/3 ÷ số tác giả chính thuộc Trường` — mẫu số đó không
          // suy ra được từ một boolean. ACADsoom trước đây buộc phải đoán bằng 1,
          // nên bài có HAI tác giả chính cùng thuộc Trường thì mỗi người nhận
          // 1/3 thay vì 1/6: cộng gấp đôi, và tổng phần chia cho Trường vượt 100%.
          //
          // Đếm tại chỗ thay vì thêm cột: người đã xác nhận (như trước) + người
          // chưa bấm có hàng ghi địa chỉ Trường — xem `chinh` ở trên.
          mainAuthorsAtSchool:
            chinh.filter((a) => a.claimStatus === 'CONFIRMED').length +
            chinhChuaBamThuocTruong.length,
          // TỔNG tác giả chính CỦA BÀI = (chính thuộc Trường, đếm sống) + (chính
          // NGOÀI Trường, lưu lúc khai). Đây mới là mẫu số thật của phần 1/3 (mục 1).
          mainAuthors: chinh.length + (p.externalMainAuthors ?? 0),
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
   *  - Email Gmail → loại công tác "thỉnh giảng" (tạo mới, hoặc điền khi đang
   *    trống — không ghi đè lựa chọn của quản trị). Xem laEmailGmail.
   */
  async upsertUserFromPhysoom(data: {
    email: string;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    physoomId?: string | null;
    teacherId?: string | null;
  }) {
    const email = String(data.email || '')
      .trim()
      .toLowerCase();
    if (!email) throw new BadRequestException('Thiếu email');
    // Cùng luật với đăng nhập qua PHYsoom: sinh viên không bao giờ thành LECTURER.
    // 400 chứ không phải 200-bỏ-qua: bên đẩy cần biết mình đang gửi sai người.
    if (laEmailSinhVien(email)) {
      throw new BadRequestException(
        'Không tạo tài khoản cán bộ cho email sinh viên.',
      );
    }

    // PHYsoom gửi `name` nguyên khối thì TÁCH theo lối tiếng Việt (từ cuối là
    // tên gọi) — y như đăng nhập SSO. Trước đây dồn cả tên vào firstName "để
    // hiển thị first + last", nhưng mọi chỗ hiển thị nay ghép [lastName,
    // firstName]; dồn vào firstName là tên người đó hiện lệch với cả Khoa.
    const tach =
      !data.firstName && !data.lastName && data.name
        ? splitVietnameseName(data.name)
        : null;
    const firstName =
      (tach ? tach.firstName : (data.firstName ?? '')).trim() || null;
    const lastName =
      (tach ? tach.lastName : (data.lastName ?? '')).trim() || null;
    const physoomId = (data.physoomId ?? '').trim() || null;
    const teacherId = (data.teacherId ?? '').trim() || null;

    // Ưu tiên ghép theo physoomId; chưa có thì theo email.
    const chon = {
      id: true,
      firstName: true,
      lastName: true,
      employmentType: true,
    } as const;
    const existing = physoomId
      ? await this.prisma.user.findFirst({
          where: { OR: [{ physoomId }, { email }] },
          select: chon,
        })
      : await this.prisma.user.findUnique({
          where: { email },
          select: chon,
        });
    const thinhGiang = laEmailGmail(email);

    if (existing) {
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          email,
          // KHÔNG GHI ĐÈ HỌ TÊN — web Khoa làm chủ (Khoa chốt 28/8/2026), quản
          // trị sửa ở trang người dùng. Tên PHYsoom lấy từ tài khoản Google, ghi
          // kiểu Tây, và từng đè bản đúng mỗi lượt đẩy (22/9/2026). Chỉ điền ô
          // đang trống.
          ...(firstName && !existing.firstName ? { firstName } : {}),
          ...(lastName && !existing.lastName ? { lastName } : {}),
          ...(physoomId ? { physoomId } : {}),
          ...(teacherId ? { teacherId } : {}),
          ...(thinhGiang && !existing.employmentType
            ? { employmentType: 'thinh_giang' }
            : {}),
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
        ...(thinhGiang ? { employmentType: 'thinh_giang' } : {}),
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

/**
 * VAI TRÒ THEO VỊ TRÍ của một hàng trong danh sách tác giả: hàng đầu là tác giả
 * đầu, hàng cuối (bài từ hai người) là tác giả cuối. Hàng giữa không bị ép gì —
 * "(các) tác giả thứ nhất" có thể nhiều người (đồng tác giả đầu).
 */
export function vaiTroTheoViTri(
  viTri: number | null | undefined,
  soTacGia: number,
): { isFirst: boolean; isLast: boolean } {
  const i = viTri ?? -1;
  return { isFirst: i === 0, isLast: soTacGia > 1 && i === soTacGia - 1 };
}
