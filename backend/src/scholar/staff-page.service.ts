import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import { PublicRevalidateService } from '../shared/services/public-revalidate.service';
import { toSlug } from '../shared/helpers';
import {
  NoStaffPageException,
  StaffBlockAmbiguousException,
  StaffBlockNotFoundException,
} from './scholar.error';
import type { UpdateStaffPageBodyType } from './scholar.model';
import { LISTING_ROSTER } from './listing-roster';

/**
 * Cho giảng viên tự sửa TRANG NHÂN SỰ của chính mình từ app hồ sơ khoa học.
 *
 * Trang nhân sự không phải một thực thể riêng: nó là `PageLayout`, nội dung nằm
 * trong khối `StaffProfileEditorial` bên trong `puckData`. Vì vậy ở đây chỉ đụng
 * ĐÚNG props của khối đó — bố cục, header, footer giữ nguyên. Một lỗi ở đây là
 * hỏng một trang đang chạy thật.
 *
 * Ranh giới quyền: chỉ sửa được layout mà `ScholarProfile.staffPageSlug` của
 * chính người gọi trỏ tới. Không có tham số nào cho phép chỉ định trang khác.
 *
 * Ô `html` (khối "Thông tin chi tiết") nay SỬA ĐƯỢC: app gửi HTML thô, ở đây ghi
 * vào đúng prop `html` của khối theo cùng cách song ngữ như `intro`. Vẫn KHÔNG tự
 * tách sang các ô có cấu trúc — mỗi trang một kiểu, đoán sai là mất nội dung.
 */

type Localized = { vi?: string; en?: string };
type PuckNode = { type?: string; props?: Record<string, unknown> };

/** Một người trên trang danh sách đội ngũ (khối `DepartmentStaffAuto`). */
type DeptPerson = {
  slug: string;
  photo: string;
  name: Localized;
  eyebrow: Localized;
  role: Localized;
  email: string;
  visiting: boolean;
  /** Nhóm lọc: lanh-dao · giang-vien · giao-vu · thinh-giang. */
  category: string;
  /**
   * Chức vụ cấp KHOA (Trưởng/Phó khoa) suy từ `positionKey`, ĐỘC LẬP với `role`
   * hiển thị theo bộ môn — để trang cấp Khoa gom riêng mục "Ban lãnh đạo Khoa".
   * null với người không giữ chức vụ Khoa.
   */
  facultyRole?: Localized | null;
};
type DeptStaffRes = {
  department: string;
  departmentName: string;
  people: DeptPerson[];
};

// ── Chuẩn hoá học vị + tên cho trang danh sách đội ngũ ──────────────────────
// Học vị hiển thị RẤT lộn xộn trên từng trang (name/eyebrow nhập/migrate tay:
// "ThS."·"Thạc sĩ"·"THS."·"GVC.ThS." và EN "MsC."·"MSc."·"PhD."·"Dr."·"Assoc.
// Prof."). Quy về MỘT khoá rồi ra dạng CHUẨN song ngữ — ưu tiên `User.degree`
// (dữ liệu có cấu trúc, sạch) rồi mới đoán từ chữ. Nhờ đó VI và EN đồng nhất.
const DEGREE_VI: Record<string, string> = {
  gs: 'GS.TS.',
  pgs: 'PGS.TS.',
  ts: 'TS.',
  ths: 'ThS.',
  cn: 'CN.',
  ks: 'KS.',
};
const DEGREE_EN: Record<string, string> = {
  gs: 'Prof.',
  pgs: 'Assoc. Prof.',
  ts: 'PhD',
  ths: 'MSc',
  cn: 'BSc',
  ks: 'Eng.',
};

/** Khoá học vị từ `User.degree` (giá trị sạch: GS·PGS·TS·ThS·CN·KS). */
const degreeKeyFromUser = (d?: string | null): string => {
  const k = (d ?? '').toLowerCase().replace(/[.\s]/g, '');
  return k in DEGREE_VI ? k : '';
};

/** Đoán khoá học vị từ chuỗi hiển thị (VI hoặc EN). PGS xét trước GS, TS trước ThS. */
const degreeKeyFromText = (s: string): string => {
  const x = ` ${s} `;
  if (/phó\s*giáo\s*sư|\bpgs\b|assoc\.?\s*prof/i.test(x)) return 'pgs';
  if (/giáo\s*sư|\bgs\b|\bprof\.?\b/i.test(x)) return 'gs';
  if (/tiến\s*sĩ|\bts\b|\bph\.?\s*d\b|\bdr\.?\b/i.test(x)) return 'ts';
  if (/thạc\s*sĩ|\bth\.?s\b|\bm\.?\s*sc\b/i.test(x)) return 'ths';
  if (/cử\s*nhân|\bcn\b|\bb\.?\s*sc\b/i.test(x)) return 'cn';
  if (/kỹ\s*sư|\bks\b|\beng\.?\b/i.test(x)) return 'ks';
  return '';
};

/** Bỏ cụm học vị/ngạch dính đầu tên (VI + EN), bỏ dấu phẩy, gom khoảng trắng. */
const stripDegreePrefix = (s: string): string => {
  const re =
    /^\s*(?:(?:gs|pgs|ts|th\.?s|cn|ks|gvcc|gvch|gvc|ncs|prof|assoc|dr|ph\.?d|m\.?sc|b\.?sc|eng)\b\.?[\s.,]*)+/i;
  const out = s
    .replace(re, '')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || s.replace(/,\s*/g, ' ').trim();
};

/** TÊN IN HOA toàn bộ (dữ liệu cũ) → về dạng tên riêng (mỗi từ hoa chữ đầu). */
const fixNameCase = (s: string): string => {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toUpperCase()) {
    return s
      .toLowerCase()
      .replace(
        /(^|[\s.\-'])(\p{L})/gu,
        (_m, p: string, ch: string) => p + ch.toUpperCase(),
      );
  }
  return s;
};

/** Tên sạch: bỏ học vị đầu, sửa in hoa. Rỗng thì trả nguyên (khỏi mất tên). */
const cleanPersonName = (s: string): string => {
  if (!s) return s;
  return fixNameCase(stripDegreePrefix(s)) || s;
};

// Suy CHỨC VỤ hiển thị từ dữ liệu có cấu trúc trong DB (nguồn "có hết" như cô nói):
// chức vụ quản lý (positionKey) > thỉnh giảng (employmentType) > NGẠCH (rank).
// Roster (curated) chỉ đè các vai ĐẶC BIỆT (Trưởng/Phó bộ môn, Giáo vụ, Thỉnh
// giảng) mà DB không diễn đạt gọn; còn lại lấy theo ngạch cho ĐÚNG (vd CV = Chuyên
// viên, TrG = Trợ giảng, GVC = Giảng viên chính) thay vì mặc định "Giảng viên".
const POSITION_ROLE: Record<string, Localized> = {
  truong_khoa: { vi: 'Trưởng khoa', en: 'Dean' },
  pho_truong_khoa: { vi: 'Phó Trưởng khoa', en: 'Vice Dean' },
  truong_bo_mon: { vi: 'Trưởng bộ môn', en: 'Head of Department' },
  pho_truong_bo_mon: { vi: 'Phó bộ môn', en: 'Deputy Head' },
  truong_ptn: { vi: 'Trưởng phòng thí nghiệm', en: 'Head of Laboratory' },
};
const RANK_ROLE: Record<string, Localized> = {
  gv: { vi: 'Giảng viên', en: 'Lecturer' },
  gvc: { vi: 'Giảng viên chính', en: 'Senior Lecturer' },
  gvcc: { vi: 'Giảng viên cao cấp', en: 'Principal Lecturer' },
  cv: { vi: 'Chuyên viên', en: 'Specialist' },
  trg: { vi: 'Trợ giảng', en: 'Teaching Assistant' },
  ncv: { vi: 'Nghiên cứu viên', en: 'Researcher' },
  ncvc: { vi: 'Nghiên cứu viên chính', en: 'Senior Researcher' },
};
const roleFromDb = (
  u?: {
    rank?: string | null;
    positionKey?: string | null;
    employmentType?: string | null;
  } | null,
): Localized | null => {
  if (!u) return null;
  const pk = (u.positionKey ?? '').toLowerCase().trim();
  if (pk && POSITION_ROLE[pk]) return POSITION_ROLE[pk];
  if ((u.employmentType ?? '').toLowerCase().trim() === 'thinh_giang') {
    return { vi: 'Thỉnh giảng', en: 'Visiting Lecturer' };
  }
  const rk = (u.rank ?? '').toLowerCase().trim();
  if (rk && RANK_ROLE[rk]) return RANK_ROLE[rk];
  return null;
};

/** Vai ĐẶC BIỆT mà roster curated được ưu tiên hơn DB (leadership/giáo vụ/thỉnh giảng). */
const isSpecialRole = (vi: string): boolean =>
  /trưởng|phó|giáo vụ|thỉnh giảng|chủ nhiệm/i.test(vi ?? '');

/** Nhóm lọc từ chức vụ (VI) + cờ thỉnh giảng — cho thanh lọc trên trang. */
const categoryOf = (roleVi: string, visiting: boolean): string => {
  if (visiting) return 'thinh-giang';
  const r = (roleVi ?? '').toLowerCase();
  if (
    /trưởng bộ môn|phó bộ môn|trưởng khoa|phó\s*(trưởng\s*)?khoa|ban chủ nhiệm|trưởng phòng thí nghiệm|trưởng ptn/.test(
      r,
    )
  ) {
    return 'lanh-dao';
  }
  if (/giáo vụ|giáo\s*vụ/.test(r)) return 'giao-vu';
  return 'giang-vien';
};

const STAFF_TYPES = ['StaffProfileEditorial', 'StaffProfile'];

const asText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  const l = v as Localized | null | undefined;
  return String(l?.vi ?? l?.en ?? '');
};

/** Bản tiếng Anh của một ô song ngữ (chuỗi trần coi như chưa có bản Anh). */
const asEn = (v: unknown): string => {
  if (typeof v === 'string') return '';
  const l = v as Localized | null | undefined;
  return String(l?.en ?? '');
};

/**
 * Chuỗi trần — URL ảnh, năm. Khác `asText` vốn dành cho ô song ngữ. Gặp object
 * thì trả rỗng: dữ liệu sai hình dạng mà để lọt ra trang thành "[object Object]"
 * còn tệ hơn là bỏ trống.
 */
const asPlain = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

/** Giữ nguyên hình dạng song ngữ mà trình dựng trang mong đợi. */
const toLocalized = (vi: string, prev: unknown): Localized => {
  const p = (typeof prev === 'object' && prev ? prev : {}) as Localized;
  return { vi, en: p.en ?? '' };
};

/**
 * Như `toLocalized` nhưng có bản tiếng Anh do app gửi: gửi `en` (kể cả chuỗi
 * rỗng để xoá) thì dùng nó; KHÔNG gửi (undefined/null) thì giữ nguyên `en` cũ.
 * Nhờ vậy lần lưu nào không đụng tiếng Anh cũng không vô tình xoá mất nó.
 */
const toLoc2 = (vi: string, en: string | null | undefined, prev: unknown): Localized => {
  const p = (typeof prev === 'object' && prev ? prev : {}) as Localized;
  return { vi, en: en != null ? en : (p.en ?? '') };
};

type EntryIn = {
  title: string;
  desc?: string;
  titleEn?: string;
  descEn?: string;
};
type PubIn = { year?: string; title: string; meta?: string; url?: string };

@Injectable()
export class StaffPageService {
  private readonly logger = new Logger(StaffPageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly publicRevalidate: PublicRevalidateService,
    private readonly bus: EventBusService,
  ) {}

  /** Tìm layout của chính người gọi, và vị trí khối hồ sơ trong cây Puck. */
  private async locate(userId: string) {
    const profile = await this.prisma.scholarProfile.findUnique({
      where: { userId },
      select: { staffPageSlug: true },
    });
    if (!profile?.staffPageSlug) throw NoStaffPageException;

    const layout = await this.prisma.pageLayout.findFirst({
      where: { slug: profile.staffPageSlug, deletedAt: null },
      // Trang đã xuất bản là bản người đọc thấy — ưu tiên nó.
      orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, slug: true, puckData: true, isPublished: true },
    });
    if (!layout) throw NoStaffPageException;

    // ĐÚNG MỘT khối, không phải "khối đầu tiên". Xem findStaffNodes().
    const nodes = this.findStaffNodes(layout.puckData);
    if (nodes.length === 0) throw StaffBlockNotFoundException;
    if (nodes.length > 1) {
      this.logger.warn(
        `staffPageSlug "${profile.staffPageSlug}" có ${nodes.length} khối hồ sơ — ` +
          `chặn sửa cho user ${userId} để khỏi ghi đè hồ sơ người khác.`,
      );
      throw StaffBlockAmbiguousException;
    }
    return { layout, node: nodes[0], slug: profile.staffPageSlug };
  }

  /**
   * TẤT CẢ khối hồ sơ trong trang, không phải khối đầu tiên.
   *
   * Bản đầu trả về khối đầu tiên tìm thấy. Đúng khi `staffPageSlug` trỏ vào
   * trang riêng của một người — mà hôm nay cả 82 hồ sơ đều vậy, đã kiểm. Nhưng
   * không có gì trong hệ thống buộc phải vậy: slug là ô chữ tự do, và trang
   * `…/nhan-su` (không có tên ai) là trang danh sách cả bộ môn. Trỏ nhầm vào đó
   * thì người này lặng lẽ đổi ảnh và tiểu sử của người đứng đầu danh sách.
   *
   * Đếm rồi chặn thì lỗi nổ ngay lúc mở trang, chứ không phải sau khi đã ghi đè
   * hồ sơ của đồng nghiệp — và không ai đi tìm nổi nguyên nhân.
   */
  private findStaffNodes(root: unknown): PuckNode[] {
    const found: PuckNode[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      const node = n as PuckNode;
      if (node.type && STAFF_TYPES.includes(node.type)) {
        found.push(node);
        // Khối hồ sơ không lồng trong khối hồ sơ — khỏi đi sâu thêm.
        return;
      }
      for (const v of Object.values(n)) {
        if (v && typeof v === 'object') walk(v);
      }
    };
    walk(root);
    return found;
  }

  async read(userId: string) {
    const { layout, node, slug } = await this.locate(userId);
    const p = node.props ?? {};
    const entries = (key: string): EntryIn[] =>
      ((p[key] ?? []) as Array<Record<string, unknown>>).map((e) => ({
        title: asText(e.title),
        desc: asText(e.desc),
        titleEn: asEn(e.title),
        descEn: asEn(e.desc),
      }));

    // Tên hiển thị nằm ở `nameLines` (mỗi dòng một ô song ngữ); gộp lại cho app.
    // Không có nameLines thì lùi về prop `name`.
    const rawLines = (p.nameLines ?? []) as Array<Record<string, unknown>>;
    const joinLines = (pick: (v: unknown) => string) =>
      rawLines
        .map((l) => pick(l.text))
        .filter((s) => s.trim())
        .join(' ');
    const nameVi = joinLines(asText) || asText(p.name);
    const nameEn = joinLines(asEn) || asEn(p.name);

    return {
      slug,
      layoutId: layout.id,
      photo: asPlain(p.photo),
      heroLayout: p.heroLayout === 'full' ? 'full' : 'compact',
      /** Nền hero: mã màu hex (giảng viên chọn) · URL ảnh (admin) · rỗng = tối mặc định. */
      heroBg: asPlain(p.heroBg),
      email: asPlain(p.email),
      eyebrow: asText(p.eyebrow),
      eyebrowEn: asEn(p.eyebrow),
      name: nameVi,
      nameEn,
      intro: asText(p.intro),
      introEn: asEn(p.intro),
      research: entries('research'),
      teaching: entries('teaching'),
      extras: ((p.extras ?? []) as Array<Record<string, unknown>>).map((e) => ({
        section: asText(e.section),
        title: asText(e.title),
        desc: asText(e.desc),
        sectionEn: asEn(e.section),
        titleEn: asEn(e.title),
        descEn: asEn(e.desc),
      })),
      publications: (
        (p.publications ?? []) as Array<Record<string, unknown>>
      ).map((e) => ({
        year: asPlain(e.year),
        title: asText(e.title),
        meta: asText(e.meta),
        url: asPlain(e.url),
      })),
      /** Khối "Thông tin chi tiết" — nay sửa được, xem ghi chú đầu tệp. */
      legacyHtml: asText(p.html),
      legacyHtmlEn: asEn(p.html),
    };
  }

  /**
   * Đội ngũ MỘT bộ môn cho trang danh sách công khai (khối `DepartmentStaffAuto`).
   *
   * NGUỒN DUY NHẤT là các TRANG CÁ NHÂN dưới `{deptSlug}/nhan-su/…`: ảnh · tên ·
   * học vị luôn khớp trang cá nhân (hết cảnh ảnh denormalized như lưới ProfileCard
   * tay), người THỈNH GIẢNG (không phải tài khoản) vẫn hiện vì họ CÓ trang, còn tài
   * khoản rác/trùng tự rụng vì không có trang. Đổi ảnh/tên ở phys-profile là danh
   * sách tự cập nhật — không còn phải sửa hai nơi.
   *
   * Chức vụ + THỨ TỰ lấy từ `LISTING_ROSTER` (hạt giống curated, khớp theo slug rồi
   * email). Ai có trang nhưng chưa có trong roster thì xếp cuối, chức vụ "Giảng viên".
   */
  async departmentStaff(deptSlug: string) {
    const clean = String(deptSlug || '').replace(/^\/+|\/+$/g, '');
    if (!clean) {
      return { department: '', departmentName: '', people: [] as DeptPerson[] };
    }
    const cacheKey = `dept-staff:${clean}`;
    const cached = await this.cache.get<DeptStaffRes>(cacheKey);
    if (cached) return cached;

    const dept = await this.prisma.department.findUnique({
      where: { slug: clean },
      select: { name: true },
    });
    const departmentName = dept?.name ?? '';

    const prefix = `${clean}/nhan-su/`;
    const pages = await this.prisma.pageLayout.findMany({
      where: { slug: { startsWith: prefix }, isPublished: true, deletedAt: null },
      select: { slug: true, puckData: true, publishedPuckData: true },
    });

    type Raw = DeptPerson & { order: number };
    const rawPeople: Raw[] = [];
    for (const pg of pages) {
      const data = pg.publishedPuckData ?? pg.puckData;
      const nodes = this.findStaffNodes(data);
      // ĐÚNG một khối hồ sơ — trang mập mờ thì bỏ để khỏi lấy nhầm người.
      if (nodes.length !== 1) continue;
      const p = nodes[0].props ?? {};
      const rawLines = (p.nameLines ?? []) as Array<Record<string, unknown>>;
      const joinLines = (pick: (v: unknown) => string) =>
        rawLines
          .map((l) => pick(l.text))
          .filter((s) => s.trim())
          .join(' ');
      const nameVi = joinLines(asText) || asText(p.name);
      const nameEn = joinLines(asEn) || asEn(p.name);
      if (!nameVi && !nameEn) continue; // trang chưa có tên → bỏ
      rawPeople.push({
        slug: pg.slug,
        photo: asPlain(p.photo),
        name: { vi: nameVi, en: nameEn },
        eyebrow: { vi: asText(p.eyebrow), en: asEn(p.eyebrow) },
        role: { vi: '', en: '' },
        email: asPlain(p.email),
        visiting: false,
        category: 'giang-vien',
        order: 0,
      });
    }

    // showOnWeb + email tài khoản (ghép theo staffPageSlug).
    const slugs = rawPeople.map((r) => r.slug);
    const profiles = slugs.length
      ? await this.prisma.scholarProfile.findMany({
          where: { staffPageSlug: { in: slugs } },
          select: {
            staffPageSlug: true,
            showOnWeb: true,
            user: {
              select: {
                email: true,
                degree: true,
                rank: true,
                positionKey: true,
                employmentType: true,
              },
            },
          },
        })
      : [];
    const profBySlug = new Map(profiles.map((pr) => [pr.staffPageSlug as string, pr]));

    // Roster: chức vụ + thứ tự curated. Tra theo slug trước, email sau.
    const roster = LISTING_ROSTER[clean] ?? [];
    const orderBySlug = new Map<string, number>();
    const orderByEmail = new Map<string, number>();
    const roleBySlug = new Map<string, Localized>();
    const roleByEmail = new Map<string, Localized>();
    roster.forEach((e, i) => {
      const role = { vi: e.roleVi, en: e.roleEn };
      if (e.slug && e.slug !== '#') {
        orderBySlug.set(e.slug, i);
        roleBySlug.set(e.slug, role);
      }
      if (e.email && !orderByEmail.has(e.email)) {
        orderByEmail.set(e.email, i);
        roleByEmail.set(e.email, role);
      }
    });

    const isVisiting = (vi: string) => /th[ỉi]nh gi[ảa]ng/i.test(vi);
    const people: Raw[] = [];
    for (const r of rawPeople) {
      const prof = profBySlug.get(r.slug);
      if (prof && prof.showOnWeb === false) continue; // tôn trọng ẩn hồ sơ
      const acctEmail = prof?.user?.email ?? '';
      const email = r.email || acctEmail;
      const rosterRole =
        roleBySlug.get(r.slug) ??
        (acctEmail ? roleByEmail.get(acctEmail) : undefined) ??
        (r.email ? roleByEmail.get(r.email) : undefined);
      const dbRole = roleFromDb(prof?.user);
      // Roster ĐẶC BIỆT (Trưởng/Phó BM · Giáo vụ · Thỉnh giảng) đè DB; còn lại lấy
      // theo NGẠCH trong DB (Chuyên viên/Trợ giảng/GV chính…) cho đúng, rồi mới lùi
      // về roster chung, cuối cùng mặc định "Giảng viên".
      const role: Localized =
        (rosterRole && isSpecialRole(rosterRole.vi ?? '')
          ? rosterRole
          : undefined) ??
        dbRole ??
        rosterRole ??
        { vi: 'Giảng viên', en: 'Lecturer' };
      const order =
        orderBySlug.get(r.slug) ??
        (acctEmail ? orderByEmail.get(acctEmail) : undefined) ??
        (r.email ? orderByEmail.get(r.email) : undefined) ??
        1000;
      // Học vị CHUẨN song ngữ: User.degree (sạch) trước, rồi đoán từ eyebrow/tên.
      const degKey =
        degreeKeyFromUser(prof?.user?.degree) ||
        degreeKeyFromText(r.eyebrow.vi ?? '') ||
        degreeKeyFromText(r.eyebrow.en ?? '') ||
        degreeKeyFromText((r.name.vi ?? '').slice(0, 18)) ||
        degreeKeyFromText((r.name.en ?? '').slice(0, 18));
      const eyebrow: Localized = {
        vi: DEGREE_VI[degKey] ?? '',
        en: DEGREE_EN[degKey] ?? '',
      };
      const name: Localized = {
        vi: cleanPersonName(r.name.vi ?? ''),
        en: cleanPersonName(r.name.en ?? ''),
      };
      const visiting = isVisiting(role.vi ?? '');
      // Chức vụ cấp KHOA suy thẳng từ positionKey — giữ NGUYÊN dù `role` hiển thị
      // theo bộ môn (VD Trưởng khoa cũng là Trưởng bộ môn thì thẻ bộ môn ghi
      // "Trưởng bộ môn", còn đây vẫn nhận ra để xếp lên "Ban lãnh đạo Khoa").
      const pk = (prof?.user?.positionKey ?? '').toLowerCase().trim();
      const facultyRole: Localized | null =
        pk === 'truong_khoa' || pk === 'pho_truong_khoa'
          ? POSITION_ROLE[pk]
          : null;
      people.push({
        ...r,
        name,
        eyebrow,
        email,
        role,
        visiting,
        category: categoryOf(role.vi ?? '', visiting),
        order,
        facultyRole,
      });
    }

    // Thứ tự roster; ngoài roster xếp cuối theo tên. Thỉnh giảng roster đã đặt cuối.
    people.sort((a, b) =>
      a.order !== b.order
        ? a.order - b.order
        : (a.name.vi ?? '').localeCompare(b.name.vi ?? '', 'vi'),
    );

    const result: DeptStaffRes = {
      department: clean,
      departmentName,
      people: people.map((p) => ({
        slug: p.slug,
        photo: p.photo,
        name: p.name,
        eyebrow: p.eyebrow,
        role: p.role,
        email: p.email,
        visiting: p.visiting,
        category: p.category,
      })),
    };
    // Cache ngắn; nguồn đổi (sửa trang cá nhân) đã gọi afterWrite → cache.clear().
    await this.cache.set(cacheKey, result, 300_000);
    return result;
  }

  /** Cây con có chứa khối kiểu `type` không (đệ quy qua mọi mảng/props). */
  private subtreeHasType(node: unknown, type: string): boolean {
    let found = false;
    const walk = (n: unknown) => {
      if (found) return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if ((n as PuckNode).type === type) {
        found = true;
        return;
      }
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (v && typeof v === 'object') walk(v);
      }
    };
    walk(node);
    return found;
  }

  /** Node Puck cho khối "Đội ngũ bộ môn (auto)" của MỘT bộ môn. */
  private makeDeptStaffNode(deptSlug: string, title?: unknown): PuckNode {
    return {
      type: 'DepartmentStaffAuto',
      props: {
        id: `dept-staff-${deptSlug.replace(/[^a-z0-9-]/gi, '-')}`,
        title: title ?? { vi: '', en: '' },
        accentColor: '#1e40af',
        visitingLabel: { vi: 'Cán bộ thỉnh giảng', en: 'Visiting Lecturers' },
        separateVisiting: true,
        showHero: true,
        heroEyebrow: { vi: 'Nhân sự', en: 'Staff' },
        // Ghi rõ bộ môn (không phụ thuộc dò URL) — bền hơn khi render.
        departmentSlug: deptSlug,
      },
    };
  }

  private isEmptyLoc(v: unknown): boolean {
    if (!v) return true;
    if (typeof v === 'string') return v.trim() === '';
    const l = v as { vi?: string; en?: string };
    return !((l.vi ?? '').trim() || (l.en ?? '').trim());
  }

  /**
   * Thay lưới ProfileCard dựng tay bằng MỘT khối `DepartmentStaffAuto` CÓ HERO
   * riêng (banner tên bộ môn + số liệu động). GỠ `PageHero` + `Heading` (tiêu đề)
   * cũ vì hero giờ nằm TRONG khối — chuyển chữ song ngữ của Heading (rồi tới phụ đề
   * PageHero) vào ô `title` của khối để khỏi mất bản Anh/Việt. GIỮ Navbar/Footer
   * của bộ môn. Idempotent.
   */
  private transformListingContent(
    data: unknown,
    deptSlug: string,
    deptName: string,
  ): { tree: unknown; changed: boolean } {
    if (!data || typeof data !== 'object') return { tree: data, changed: false };
    const obj = data as Record<string, unknown>;
    const content = obj.content;
    if (!Array.isArray(content)) return { tree: data, changed: false };

    // Lượt 1: thu tiêu đề hero — Heading (song ngữ, giàu nhất) > phụ đề PageHero >
    // dựng từ tên bộ môn.
    let headingText: unknown;
    let heroSubtitle: unknown;
    for (const item of content) {
      const node = item as PuckNode;
      if (node?.type === 'Heading' && node.props && headingText === undefined) {
        headingText = node.props.text;
      }
      if (
        node?.type === 'PageHero' &&
        node.props &&
        heroSubtitle === undefined
      ) {
        heroSubtitle = node.props.subtitle;
      }
    }
    const finalTitle: unknown =
      (!this.isEmptyLoc(headingText) && headingText) ||
      (!this.isEmptyLoc(heroSubtitle) && heroSubtitle) ||
      (deptName ? { vi: `Đội ngũ Bộ môn ${deptName}`, en: '' } : undefined);

    let changed = false;
    let hasAuto = false;
    let removedHeading = false;
    const out: unknown[] = [];
    for (const item of content) {
      const node = item as PuckNode;
      // PageHero: bỏ hẳn — hero giờ nằm TRONG khối (tránh 2 hero chồng nhau).
      if (node?.type === 'PageHero') {
        changed = true;
        continue;
      }
      // Heading ĐẦU TIÊN (tiêu đề trang): bỏ — đã chuyển vào hero. Heading khác giữ.
      if (node?.type === 'Heading' && !removedHeading) {
        removedHeading = true;
        changed = true;
        continue;
      }
      if (node?.type === 'DepartmentStaffAuto' && node.props) {
        hasAuto = true;
        const props: Record<string, unknown> = { ...node.props };
        if (this.isEmptyLoc(props.title) && finalTitle) props.title = finalTitle;
        if (props.showHero === undefined) props.showHero = true;
        if (props.heroEyebrow === undefined) {
          props.heroEyebrow = { vi: 'Nhân sự', en: 'Staff' };
        }
        if (!props.departmentSlug) props.departmentSlug = deptSlug;
        if (JSON.stringify(props) !== JSON.stringify(node.props)) changed = true;
        out.push({ ...node, props });
        continue;
      }
      // Cây con có lưới ProfileCard → bỏ (khối auto thay thế).
      if (this.subtreeHasType(node, 'ProfileCard')) {
        changed = true;
        continue;
      }
      out.push(item);
    }

    if (!hasAuto) {
      const auto = this.makeDeptStaffNode(deptSlug, finalTitle);
      const footerIdx = out.findIndex((n) =>
        ['Footer', 'FooterBlock'].includes((n as PuckNode)?.type ?? ''),
      );
      if (footerIdx >= 0) out.splice(footerIdx, 0, auto);
      else out.push(auto);
      changed = true;
    }
    return { tree: { ...obj, content: out }, changed };
  }

  /**
   * Lắp khối "Đội ngũ bộ môn (auto)" vào trang danh sách `{bộ-môn}/nhan-su` — thay
   * lưới ProfileCard dựng tay, GIỮ Navbar/Header · PageHero · Heading · Footer của
   * chính bộ môn đó (nên header/nav mỗi bộ môn không bị đổi). Chỉ quản trị. Ghi cả
   * puckData lẫn publishedPuckData rồi revalidate. Idempotent.
   */
  async applyListingBlock(opts: {
    department?: string;
    all?: boolean;
    dryRun?: boolean;
  }) {
    const dryRun = !!opts.dryRun;
    let deptSlugs: string[];
    if (opts.all) {
      const depts = await this.prisma.department.findMany({
        where: { kind: 'department' },
        select: { slug: true },
      });
      deptSlugs = depts.map((d) => d.slug);
    } else if (opts.department) {
      deptSlugs = [opts.department.replace(/^\/+|\/+$/g, '')];
    } else {
      deptSlugs = [];
    }

    const pages: { slug: string; action: string }[] = [];
    const revalidate: string[] = [];
    for (const dept of deptSlugs) {
      const listingSlug = `${dept}/nhan-su`;
      const layout = await this.prisma.pageLayout.findFirst({
        where: { slug: listingSlug, deletedAt: null },
        orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          puckData: true,
          publishedPuckData: true,
          isPublished: true,
        },
      });
      if (!layout) {
        pages.push({ slug: listingSlug, action: 'khong-co-trang' });
        continue;
      }
      const deptRow = await this.prisma.department.findUnique({
        where: { slug: dept },
        select: { name: true },
      });
      const name = deptRow?.name ?? '';
      const d = this.transformListingContent(layout.puckData, dept, name);
      const pub = layout.isPublished
        ? this.transformListingContent(layout.publishedPuckData, dept, name)
        : { tree: layout.publishedPuckData, changed: false };
      if (!d.changed && !pub.changed) {
        pages.push({ slug: listingSlug, action: 'khong-doi' });
        continue;
      }
      if (!dryRun) {
        await this.prisma.pageLayout.update({
          where: { id: layout.id },
          data: {
            ...(d.changed ? { puckData: d.tree as Prisma.InputJsonValue } : {}),
            ...(pub.changed
              ? { publishedPuckData: pub.tree as Prisma.InputJsonValue }
              : {}),
          },
        });
        revalidate.push(`page:${listingSlug}`);
      }
      pages.push({ slug: listingSlug, action: dryRun ? 'se-doi' : 'da-doi' });
    }
    if (!dryRun && revalidate.length) {
      await this.cache.clear();
      this.publicRevalidate.trigger([...revalidate, 'sitemap']);
    }
    return { dryRun, pages };
  }

  /** Trích props của khối `Navbar` đầu tiên trong một puckData (deep clone). */
  private navbarPropsFrom(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== 'object') return null;
    const content = (data as Record<string, unknown>).content;
    if (!Array.isArray(content)) return null;
    for (const item of content) {
      const node = item as PuckNode;
      if (node?.type === 'Navbar' && node.props) {
        return JSON.parse(JSON.stringify(node.props)) as Record<string, unknown>;
      }
    }
    return null;
  }

  /**
   * Navbar RIÊNG của bộ môn để chép sang trang nhân sự. Ưu tiên trang giới thiệu
   * rồi trang chủ bộ môn (đều mang Navbar bộ môn); không có thì quét các trang
   * khác của bộ môn tìm khối Navbar đầu tiên. Trả null nếu bộ môn chưa có Navbar.
   */
  private async findDeptNavbarProps(
    deptSlug: string,
  ): Promise<Record<string, unknown> | null> {
    for (const slug of [`${deptSlug}/gioi-thieu`, deptSlug]) {
      const row = await this.prisma.pageLayout.findFirst({
        where: { slug, deletedAt: null },
        orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
        select: { puckData: true, publishedPuckData: true },
      });
      const nav =
        this.navbarPropsFrom(row?.publishedPuckData) ??
        this.navbarPropsFrom(row?.puckData);
      if (nav) return nav;
    }
    const rows = await this.prisma.pageLayout.findMany({
      where: { deletedAt: null, slug: { startsWith: `${deptSlug}/` } },
      orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
      select: { puckData: true, publishedPuckData: true },
      take: 40,
    });
    for (const r of rows) {
      const nav =
        this.navbarPropsFrom(r.publishedPuckData) ??
        this.navbarPropsFrom(r.puckData);
      if (nav) return nav;
    }
    return null;
  }

  /**
   * Thay MỌI khối `Header` (nav Khoa đồng bộ tập trung) bằng `Navbar` RIÊNG của
   * bộ môn. Giữ `id` của Header cũ cho ổn định. Idempotent: không có Header thì
   * không đổi (trang vốn đã dùng Navbar bộ môn được bỏ qua).
   */
  private replaceHeaderWithNavbar(
    data: unknown,
    navbarProps: Record<string, unknown>,
  ): { tree: unknown; changed: boolean } {
    if (!data || typeof data !== 'object') return { tree: data, changed: false };
    const obj = data as Record<string, unknown>;
    const content = obj.content;
    if (!Array.isArray(content)) return { tree: data, changed: false };
    let changed = false;
    const out = content.map((item) => {
      const node = item as PuckNode;
      if (node?.type !== 'Header') return item;
      changed = true;
      const id =
        (node.props?.id as string) ??
        (navbarProps.id as string) ??
        `hdr-${Math.random().toString(36).slice(2, 8)}`;
      return {
        type: 'Navbar',
        props: {
          ...(JSON.parse(JSON.stringify(navbarProps)) as Record<
            string,
            unknown
          >),
          id,
        },
      };
    });
    return changed
      ? { tree: { ...obj, content: out }, changed }
      : { tree: data, changed: false };
  }

  /**
   * Thay khối `Header` (nav Khoa) bằng Navbar RIÊNG của bộ môn trên trang
   * `{bộ-môn}/nhan-su` VÀ mọi hồ sơ cá nhân `{bộ-môn}/nhan-su/{người}` — để nav
   * của trang nhân sự khớp trang giới thiệu của chính bộ môn đó. `department` cho
   * một bộ môn, `all` cho cả 8; `dryRun` xem trước. Chỉ quản trị. Ghi cả puckData
   * lẫn publishedPuckData rồi revalidate. Idempotent.
   */
  async applyDeptNav(opts: {
    department?: string;
    all?: boolean;
    dryRun?: boolean;
  }) {
    const dryRun = !!opts.dryRun;
    let deptSlugs: string[];
    if (opts.all) {
      const depts = await this.prisma.department.findMany({
        where: { kind: 'department' },
        select: { slug: true },
      });
      deptSlugs = depts.map((d) => d.slug);
    } else if (opts.department) {
      deptSlugs = [opts.department.replace(/^\/+|\/+$/g, '')];
    } else {
      deptSlugs = [];
    }

    const pages: { slug: string; action: string }[] = [];
    const revalidate: string[] = [];
    for (const dept of deptSlugs) {
      const navbar = await this.findDeptNavbarProps(dept);
      if (!navbar) {
        pages.push({ slug: `${dept}/nhan-su`, action: 'khong-co-navbar-mau' });
        continue;
      }
      const targets = await this.prisma.pageLayout.findMany({
        where: {
          deletedAt: null,
          OR: [
            { slug: `${dept}/nhan-su` },
            { slug: { startsWith: `${dept}/nhan-su/` } },
          ],
        },
        select: {
          id: true,
          slug: true,
          puckData: true,
          publishedPuckData: true,
          isPublished: true,
        },
      });
      for (const layout of targets) {
        const d = this.replaceHeaderWithNavbar(layout.puckData, navbar);
        const pub = layout.isPublished
          ? this.replaceHeaderWithNavbar(layout.publishedPuckData, navbar)
          : { tree: layout.publishedPuckData, changed: false };
        if (!d.changed && !pub.changed) {
          pages.push({ slug: layout.slug, action: 'khong-doi' });
          continue;
        }
        if (!dryRun) {
          await this.prisma.pageLayout.update({
            where: { id: layout.id },
            data: {
              ...(d.changed
                ? { puckData: d.tree as Prisma.InputJsonValue }
                : {}),
              ...(pub.changed
                ? { publishedPuckData: pub.tree as Prisma.InputJsonValue }
                : {}),
            },
          });
          revalidate.push(`page:${layout.slug}`);
        }
        pages.push({ slug: layout.slug, action: dryRun ? 'se-doi' : 'da-doi' });
      }
    }
    if (!dryRun && revalidate.length) {
      await this.cache.clear();
      this.publicRevalidate.trigger([...revalidate, 'sitemap']);
    }
    return { dryRun, pages };
  }

  /** Node khối "Đội ngũ toàn Khoa" cho trang cơ hữu / thỉnh giảng. */
  private makeFacultyStaffNode(type: 'co-huu' | 'thinh-giang'): PuckNode {
    return {
      type: 'FacultyStaffAuto',
      props: {
        id: `faculty-staff-${type}`,
        facultyType: type,
        title: { vi: '', en: '' },
        heroEyebrow: {
          vi: 'Khoa Vật lý – Vật lý Kỹ thuật',
          en: 'Faculty of Physics',
        },
        accentColor: '#1e40af',
      },
    };
  }

  /** Thay `LegacyPageBody`/PageHero/Heading bằng MỘT khối `FacultyStaffAuto`, giữ
   *  Header/Navbar + Footer. Idempotent. */
  private transformFacultyContent(
    data: unknown,
    type: 'co-huu' | 'thinh-giang',
  ): { tree: unknown; changed: boolean } {
    if (!data || typeof data !== 'object') return { tree: data, changed: false };
    const obj = data as Record<string, unknown>;
    const content = obj.content;
    if (!Array.isArray(content)) return { tree: data, changed: false };
    const DROP = ['PageHero', 'Heading', 'LegacyPageBody'];
    let changed = false;
    let hasNode = false;
    const out: unknown[] = [];
    for (const item of content) {
      const node = item as PuckNode;
      if (node?.type && DROP.includes(node.type)) {
        changed = true;
        continue;
      }
      if (node?.type === 'FacultyStaffAuto' && node.props) {
        hasNode = true;
        const props: Record<string, unknown> = { ...node.props };
        if (props.facultyType !== type) {
          props.facultyType = type;
          changed = true;
        }
        out.push({ ...node, props });
        continue;
      }
      if (this.subtreeHasType(node, 'ProfileCard')) {
        changed = true;
        continue;
      }
      out.push(item);
    }
    if (!hasNode) {
      const n = this.makeFacultyStaffNode(type);
      const footerIdx = out.findIndex((x) =>
        ['Footer', 'FooterBlock'].includes((x as PuckNode)?.type ?? ''),
      );
      if (footerIdx >= 0) out.splice(footerIdx, 0, n);
      else out.push(n);
      changed = true;
    }
    return { tree: { ...obj, content: out }, changed };
  }

  /**
   * Lắp khối "Đội ngũ toàn Khoa" vào 2 trang cấp Khoa (giang-vien-co-huu /
   * giang-vien-thinh-giang) — thay HTML cũ (LegacyPageBody). Chỉ quản trị.
   */
  async applyFacultyPages(opts: { dryRun?: boolean }) {
    const dryRun = !!opts.dryRun;
    const targets: { slug: string; type: 'co-huu' | 'thinh-giang' }[] = [
      { slug: 'giang-vien-co-huu', type: 'co-huu' },
      { slug: 'giang-vien-thinh-giang', type: 'thinh-giang' },
    ];
    const pages: { slug: string; action: string }[] = [];
    const revalidate: string[] = [];
    for (const t of targets) {
      const layout = await this.prisma.pageLayout.findFirst({
        where: { slug: t.slug, deletedAt: null },
        orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          puckData: true,
          publishedPuckData: true,
          isPublished: true,
        },
      });
      if (!layout) {
        pages.push({ slug: t.slug, action: 'khong-co-trang' });
        continue;
      }
      const d = this.transformFacultyContent(layout.puckData, t.type);
      const pub = layout.isPublished
        ? this.transformFacultyContent(layout.publishedPuckData, t.type)
        : { tree: layout.publishedPuckData, changed: false };
      if (!d.changed && !pub.changed) {
        pages.push({ slug: t.slug, action: 'khong-doi' });
        continue;
      }
      if (!dryRun) {
        await this.prisma.pageLayout.update({
          where: { id: layout.id },
          data: {
            ...(d.changed ? { puckData: d.tree as Prisma.InputJsonValue } : {}),
            ...(pub.changed
              ? { publishedPuckData: pub.tree as Prisma.InputJsonValue }
              : {}),
          },
        });
        revalidate.push(`page:${t.slug}`);
      }
      pages.push({ slug: t.slug, action: dryRun ? 'se-doi' : 'da-doi' });
    }
    if (!dryRun && revalidate.length) {
      await this.cache.clear();
      this.publicRevalidate.trigger([...revalidate, 'sitemap']);
    }
    return { dryRun, pages };
  }

  async update(userId: string, body: UpdateStaffPageBodyType) {
    const { layout, node, slug } = await this.locate(userId);
    const prev = node.props ?? {};
    const next: Record<string, unknown> = { ...prev };

    if (body.photo !== undefined) next.photo = body.photo ?? '';
    // Nền hero giảng viên tự chọn: mã màu hex, hoặc rỗng để về nền tối mặc định.
    // (Admin vẫn có thể đặt URL ẢNH nền qua trình soạn thảo Puck — cùng prop.)
    if (body.heroBg !== undefined) next.heroBg = body.heroBg ?? '';
    if (body.heroLayout != null) {
      next.heroLayout = body.heroLayout === 'full' ? 'full' : 'compact';
    }
    // Tên hiển thị: ghi vào `name` VÀ `nameLines` (một dòng song ngữ) vì trình
    // dựng trang ưu tiên `nameLines`. Trang chỉ hiện một dòng nên gộp là đủ.
    // Bỏ qua khi tên (VI) rỗng để không vô tình xoá mất tên trên trang.
    if (body.name != null && body.name.trim()) {
      const loc = toLoc2(body.name, body.nameEn, prev.name);
      next.name = loc;
      next.nameLines = [{ text: loc }];
    }
    if (body.eyebrow !== undefined) {
      next.eyebrow = toLoc2(body.eyebrow ?? '', body.eyebrowEn, prev.eyebrow);
    }
    if (body.intro !== undefined) {
      next.intro = toLoc2(body.intro ?? '', body.introEn, prev.intro);
    }
    // Khối "Thông tin chi tiết": ghi HTML thô vào prop `html` theo ĐÚNG cách song
    // ngữ như `intro` — giữ nguyên `en` cũ, thay `vi`. Chỉ đụng khi app có gửi.
    if (body.legacyHtml !== undefined) {
      next.html = toLoc2(body.legacyHtml ?? '', body.legacyHtmlEn, prev.html);
    }
    for (const key of ['research', 'teaching'] as const) {
      const list = body[key];
      if (!list) continue;
      next[key] = list.map((e: EntryIn) => ({
        title: toLoc2(e.title, e.titleEn, null),
        desc: toLoc2(e.desc ?? '', e.descEn, null),
      }));
    }
    if (body.extras) {
      next.extras = body.extras.map((e) => ({
        section: toLoc2(e.section, e.sectionEn, null),
        title: toLoc2(e.title, e.titleEn, null),
        desc: toLoc2(e.desc ?? '', e.descEn, null),
      }));
    }
    if (body.publications) {
      next.publications = body.publications.map((e: PubIn) => ({
        year: String(e.year ?? ''),
        title: toLocalized(e.title, null),
        meta: toLocalized(e.meta ?? '', null),
        url: e.url ?? '',
      }));
    }

    // Thay props TẠI CHỖ trong cây: nhân bản cây rồi đổi đúng một khối, để mọi
    // thứ khác của layout không bị đụng tới.
    const tree = this.replaceProps(layout.puckData, node, next);

    await this.persist(layout, tree);
    // Ảnh còn được sao vào các thẻ ProfileCard ở trang danh sách (…/nhan-su) —
    // một bản sao denormalized, ghép người theo email. Đổi ảnh thì đồng bộ luôn,
    // nếu không trang cá nhân đổi mà lưới "Đội ngũ" vẫn ảnh cũ.
    const extraSlugs =
      body.photo !== undefined
        ? await this.syncProfileCards(userId, body.photo ?? '')
        : [];
    await this.afterWrite(userId, [slug, ...extraSlugs]);
    return this.read(userId);
  }

  /**
   * Đồng bộ ảnh sang các thẻ ProfileCard trỏ về người này, ghép theo EMAIL.
   *
   * Thẻ danh sách là `ProfileCard` với `props.email` + `props.imageUrl`, nằm rải
   * trong puckData của trang "Đội ngũ" (có thể nhiều trang: VI/EN, khoa/bộ môn).
   * Lọc trước theo email cho hẹp, rồi duyệt cây cập nhật đúng thẻ khớp — cả
   * `puckData` lẫn `publishedPuckData` (trang công khai đọc bản published).
   *
   * Trả về danh sách slug đã đổi để revalidate.
   */
  private async syncProfileCards(
    userId: string,
    imageUrl: string,
  ): Promise<string[]> {
    const profile = await this.prisma.scholarProfile.findUnique({
      where: { userId },
      select: { user: { select: { email: true } } },
    });
    const email = profile?.user?.email?.toLowerCase();
    if (!email) return [];

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "PageLayout"
      WHERE "deletedAt" IS NULL
        AND (position(${email} in lower("puckData"::text)) > 0
          OR position(${email} in lower(coalesce("publishedPuckData"::text, ''))) > 0)
    `;

    const changed: string[] = [];
    for (const { id } of rows) {
      const layout = await this.prisma.pageLayout.findUnique({
        where: { id },
        select: {
          slug: true,
          puckData: true,
          publishedPuckData: true,
          isPublished: true,
        },
      });
      if (!layout) continue;
      const d = this.updateProfileCards(layout.puckData, email, imageUrl);
      const p = layout.isPublished
        ? this.updateProfileCards(layout.publishedPuckData, email, imageUrl)
        : { tree: layout.publishedPuckData, changed: 0 };
      if (!d.changed && !p.changed) continue;
      await this.prisma.pageLayout.update({
        where: { id },
        data: {
          ...(d.changed ? { puckData: d.tree as Prisma.InputJsonValue } : {}),
          ...(p.changed
            ? { publishedPuckData: p.tree as Prisma.InputJsonValue }
            : {}),
        },
      });
      changed.push(layout.slug);
    }
    return changed;
  }

  /** Nhân bản cây, đổi `imageUrl` của mọi ProfileCard khớp email. Không đụng gì khác. */
  private updateProfileCards(
    root: unknown,
    email: string,
    imageUrl: string,
  ): { tree: unknown; changed: number } {
    let changed = 0;
    const walk = (n: unknown): unknown => {
      if (Array.isArray(n)) return n.map(walk);
      if (!n || typeof n !== 'object') return n;
      const node = n as PuckNode;
      if (
        node.type === 'ProfileCard' &&
        node.props &&
        String(node.props.email ?? '').toLowerCase() === email
      ) {
        if (node.props.imageUrl === imageUrl) return node;
        changed++;
        return { ...node, props: { ...node.props, imageUrl } };
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        out[k] = v && typeof v === 'object' ? walk(v) : v;
      }
      return out;
    };
    return { tree: walk(root), changed };
  }

  /**
   * Ghi cây Puck vào layout.
   *
   * Trang công khai phục vụ `publishedPuckData` (bản đã xuất bản), KHÔNG phải
   * `puckData` (bản nháp). Trang nhân sự là tự-phục-vụ: người dùng bấm Lưu là
   * xong, không có bước "xuất bản" riêng như trang thường. Nên với layout ĐÃ xuất
   * bản phải cập nhật CẢ bản công khai — nếu chỉ ghi `puckData` thì ảnh và nội
   * dung mới nằm mãi trong nháp, trang thật vẫn bản cũ dù đã revalidate.
   *
   * Layout còn ở dạng nháp thì chỉ ghi `puckData`: chưa ai thấy trang, và ghi
   * `publishedPuckData` lúc này là tự "xuất bản" hộ một bản chưa được duyệt.
   */
  private async persist(
    layout: { id: string; isPublished: boolean },
    tree: unknown,
  ) {
    await this.prisma.pageLayout.update({
      where: { id: layout.id },
      data: {
        puckData: tree as Prisma.InputJsonValue,
        ...(layout.isPublished
          ? { publishedPuckData: tree as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  /**
   * Sau khi ghi: xoá cache backend rồi báo frontend dựng lại.
   *
   * Endpoint công khai `/slug/*` có CacheInterceptor giữ 10 phút; không xoá thì
   * frontend dựng lại nhưng đọc trúng bản cache cũ, và người đọc vẫn thấy bản cũ
   * tới 10 phút. Xoá cache trước, rồi revalidate ISR — đúng thứ tự trang thường
   * làm khi sửa layout.
   */
  private async afterWrite(userId: string, slugs: string[]) {
    await this.cache.clear();
    const tags = [...new Set(slugs.filter(Boolean))].map((s) => `page:${s}`);
    this.publicRevalidate.trigger([...tags, 'sitemap']);
    this.bus.emit('staff-page.changed', { userIds: [userId], key: slugs[0] });
  }

  /** Nhân bản cây, thay props của đúng một khối (so sánh theo tham chiếu). */
  private replaceProps(
    root: unknown,
    target: PuckNode,
    props: Record<string, unknown>,
  ): unknown {
    if (Array.isArray(root)) {
      return root.map((c) => this.replaceProps(c, target, props));
    }
    if (!root || typeof root !== 'object') return root;
    if (root === target) return { ...(root as PuckNode), props };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      out[k] =
        v && typeof v === 'object' ? this.replaceProps(v, target, props) : v;
    }
    return out;
  }

  /**
   * Sinh danh sách công bố (và đề tài) trên trang TỪ CHÍNH cơ sở dữ liệu.
   *
   * Trước đây trang nhân sự giữ một danh sách gõ tay riêng — tức là bản sao thứ
   * hai của cùng dữ liệu, sớm muộn cũng lệch với mục "Công bố của tôi". Giờ nó
   * được sinh ra, và người dùng điều khiển bằng hai thứ:
   *   · cờ `showOnWeb` trên từng bài / từng đề tài
   *   · `fromYear` để giới hạn phạm vi (vd 5 năm gần nhất)
   *
   * Ghi đè hẳn danh sách cũ — đó là điểm mấu chốt, vì mục đích là bỏ bản chép
   * tay đi. Giao diện phải nói rõ điều này trước khi người dùng bấm.
   */
  async syncFromDatabase(
    userId: string,
    opts: { fromYear?: number | null; includeProjects?: boolean } = {},
  ) {
    const pubs = await this.prisma.publicationAuthor.findMany({
      where: {
        userId,
        claimStatus: 'CONFIRMED',
        showOnWeb: true,
        publication: {
          deletedAt: null,
          ...(opts.fromYear ? { countYear: { gte: opts.fromYear } } : {}),
        },
      },
      include: { publication: true },
    });

    const publications = pubs
      .map((r) => r.publication)
      .sort((a, b) => (b.countYear ?? 0) - (a.countYear ?? 0))
      .map((p) => ({
        year: p.countYear ? String(p.countYear) : '',
        title: p.title,
        // Dòng phụ dựng từ dữ liệu thư mục, không bắt người dùng gõ lại.
        meta: [
          p.containerTitle,
          p.volume ? `Tập ${p.volume}` : null,
          p.issue ? `số ${p.issue}` : null,
          p.pages ? `tr. ${p.pages}` : null,
          p.doi ? `DOI ${p.doi}` : null,
        ]
          .filter(Boolean)
          .join(', '),
        url: p.url ?? (p.doi ? `https://doi.org/${p.doi}` : ''),
      }));

    let projectEntries: Array<{
      section: string;
      title: string;
      desc: string;
    }> = [];
    if (opts.includeProjects) {
      const members = await this.prisma.projectMember.findMany({
        where: {
          userId,
          claimStatus: 'CONFIRMED',
          showOnWeb: true,
          project: {
            deletedAt: null,
            ...(opts.fromYear ? { startYear: { gte: opts.fromYear } } : {}),
          },
        },
        include: { project: true },
      });
      const roleVi = {
        LEAD: 'Chủ nhiệm',
        SECRETARY: 'Thư ký',
        MEMBER: 'Thành viên',
      };
      projectEntries = members
        .sort((a, b) => (b.project.startYear ?? 0) - (a.project.startYear ?? 0))
        .map((m) => ({
          section: 'Đề tài, dự án',
          title: m.project.title,
          desc: [
            m.project.code,
            m.project.funder,
            roleVi[m.role],
            m.project.startYear ? `từ ${m.project.startYear}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }));
    }

    const { node, layout, slug } = await this.locate(userId);
    const prev = node.props ?? {};
    // Giữ nguyên các mục extras KHÁC do người dùng tự đặt; chỉ thay phần đề tài.
    const keptExtras = (
      (prev.extras ?? []) as Array<Record<string, unknown>>
    ).filter((e) => !/đề tài|de tai|project/i.test(asText(e.section)));

    const next: Record<string, unknown> = {
      ...prev,
      publications: publications.map((e) => ({
        year: e.year,
        title: toLocalized(e.title, null),
        meta: toLocalized(e.meta, null),
        url: e.url,
      })),
      ...(opts.includeProjects
        ? {
            extras: [
              ...keptExtras,
              ...projectEntries.map((e) => ({
                section: toLocalized(e.section, null),
                title: toLocalized(e.title, null),
                desc: toLocalized(e.desc, null),
              })),
            ],
          }
        : {}),
    };

    await this.persist(layout, this.replaceProps(layout.puckData, node, next));
    await this.afterWrite(userId, [slug]);
    return this.read(userId);
  }

  /** Đổi ảnh chân dung. Ảnh đã được lưu vào uploads/ bởi tầng nhận tệp. */
  async setPhoto(userId: string, url: string) {
    return this.update(userId, { photo: url });
  }

  /**
   * Đồng bộ MỘT LƯỢT ảnh hiện có cho mọi hồ sơ có trang nhân sự — dùng cho người
   * đã upload ảnh phys-profile TRƯỚC khi có auto-sync (ảnh nằm ở nháp chưa publish,
   * và thẻ danh sách vẫn ảnh cũ). Chỉ đụng ẢNH, KHÔNG publish nội dung nháp khác:
   * lấy ảnh trong khối hồ sơ, ghi vào publishedPuckData của trang cá nhân + đồng
   * bộ các thẻ ProfileCard.
   */
  async backfillPhotos() {
    const profiles = await this.prisma.scholarProfile.findMany({
      where: { staffPageSlug: { not: null } },
      select: {
        userId: true,
        staffPageSlug: true,
        user: { select: { email: true } },
      },
    });
    const report = { nguoi: 0, caNhanDoi: 0, theDoi: 0, boQua: [] as string[] };
    const touched = new Set<string>();
    for (const pr of profiles) {
      try {
        const layout = await this.prisma.pageLayout.findFirst({
          where: { slug: pr.staffPageSlug ?? '', deletedAt: null },
          orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
          select: {
            id: true,
            slug: true,
            puckData: true,
            publishedPuckData: true,
            isPublished: true,
          },
        });
        if (!layout) continue;
        const nodes = this.findStaffNodes(layout.puckData);
        if (nodes.length !== 1) {
          report.boQua.push(pr.staffPageSlug ?? pr.userId);
          continue;
        }
        const photo = asPlain(nodes[0].props?.photo);
        if (!photo) continue;
        report.nguoi++;
        if (layout.isPublished) {
          const pub = this.setPhotoOnStaffBlocks(layout.publishedPuckData, photo);
          if (pub.changed) {
            await this.prisma.pageLayout.update({
              where: { id: layout.id },
              data: { publishedPuckData: pub.tree as Prisma.InputJsonValue },
            });
            report.caNhanDoi++;
            touched.add(layout.slug);
          }
        }
        const slugs = await this.syncProfileCards(pr.userId, photo);
        report.theDoi += slugs.length;
        slugs.forEach((s) => touched.add(s));
      } catch {
        report.boQua.push(pr.staffPageSlug ?? pr.userId);
      }
    }
    if (touched.size) {
      await this.cache.clear();
      this.publicRevalidate.trigger([
        ...[...touched].map((s) => `page:${s}`),
        'sitemap',
      ]);
    }
    return report;
  }

  /** Nhân bản cây, đặt `photo` cho mọi khối hồ sơ (StaffProfile / StaffProfileEditorial). */
  private setPhotoOnStaffBlocks(
    root: unknown,
    photo: string,
  ): { tree: unknown; changed: number } {
    let changed = 0;
    const walk = (n: unknown): unknown => {
      if (Array.isArray(n)) return n.map(walk);
      if (!n || typeof n !== 'object') return n;
      const node = n as PuckNode;
      if (node.type && STAFF_TYPES.includes(node.type) && node.props) {
        if (node.props.photo === photo) return node;
        changed++;
        return { ...node, props: { ...node.props, photo } };
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        out[k] = v && typeof v === 'object' ? walk(v) : v;
      }
      return out;
    };
    return { tree: walk(root), changed };
  }

  /**
   * Sao hồ sơ học thuật (ORCID / Scopus / Google Scholar / ResearcherID) từ Định
   * danh vào props của trang nhân sự để hiện icon-link — chỉ quản trị, một lượt
   * cho MỌI người.
   *
   * Ghép người ↔ trang theo `staffPageSlug` (KHÔNG theo email: khối editorial để
   * `props.email` rỗng nên ghép email luôn trượt — chính là lý do icon không hiện
   * dù đã khai ORCID). CHỈ ghi ô nào nguồn CÓ giá trị, không xoá ID người tự điền.
   */
  async backfillScholarLinks() {
    const profiles = await this.prisma.scholarProfile.findMany({
      where: { staffPageSlug: { not: null } },
      select: {
        staffPageSlug: true,
        orcid: true,
        scopusAuthorId: true,
        researcherId: true,
        googleScholarId: true,
        user: { select: { email: true } },
      },
    });
    const report = { doi: 0, boQua: 0, khongCoTrang: [] as string[] };
    const touched = new Set<string>();
    for (const p of profiles) {
      const changed = await this.writeScholarLinks(p.staffPageSlug!, {
        orcid: p.orcid ?? '',
        scopus: p.scopusAuthorId ?? '',
        googleScholar: p.googleScholarId ?? '',
        researcherId: p.researcherId ?? '',
        email: p.user?.email ?? '',
      });
      if (changed === null) report.khongCoTrang.push(p.staffPageSlug!);
      else if (changed) {
        report.doi++;
        touched.add(p.staffPageSlug!);
      } else report.boQua++;
    }
    if (touched.size) {
      await this.cache.clear();
      this.publicRevalidate.trigger([
        ...[...touched].map((s) => `page:${s}`),
        'sitemap',
      ]);
    }
    return { ...report, khongCoTrang: [...new Set(report.khongCoTrang)] };
  }

  /**
   * Sao ID học thuật sang trang của MỘT người (theo staffPageSlug) rồi revalidate
   * ngay. Gọi sau khi đổi Định danh để icon hiện liền; không có trang thì bỏ qua.
   */
  async syncScholarLinksForUser(userId: string): Promise<void> {
    const p = await this.prisma.scholarProfile.findUnique({
      where: { userId },
      select: {
        staffPageSlug: true,
        orcid: true,
        scopusAuthorId: true,
        researcherId: true,
        googleScholarId: true,
        user: { select: { email: true } },
      },
    });
    if (!p?.staffPageSlug) return;
    const changed = await this.writeScholarLinks(p.staffPageSlug, {
      orcid: p.orcid ?? '',
      scopus: p.scopusAuthorId ?? '',
      googleScholar: p.googleScholarId ?? '',
      researcherId: p.researcherId ?? '',
      email: p.user?.email ?? '',
    });
    if (changed) {
      await this.cache.clear();
      this.publicRevalidate.trigger([`page:${p.staffPageSlug}`, 'sitemap']);
    }
  }

  /**
   * Ghi 4 ID vào MỌI khối hồ sơ của layout khớp `slug` (cả puckData lẫn
   * publishedPuckData). Chỉ set ô nào nguồn CÓ giá trị — không xoá ID người tự
   * điền. KHÔNG revalidate (caller gom lại). Trả về: `null` = không có trang,
   * `true` = có ghi đổi, `false` = có trang nhưng không đổi.
   */
  private async writeScholarLinks(
    slug: string,
    ids: Record<
      'orcid' | 'scopus' | 'googleScholar' | 'researcherId' | 'email',
      string
    >,
  ): Promise<boolean | null> {
    const layout = await this.prisma.pageLayout.findFirst({
      where: { slug, deletedAt: null },
      orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        puckData: true,
        publishedPuckData: true,
        isPublished: true,
      },
    });
    if (!layout) return null;
    const d = this.setScholarLinksOnStaffBlocks(layout.puckData, ids);
    const pub = layout.isPublished
      ? this.setScholarLinksOnStaffBlocks(layout.publishedPuckData, ids)
      : { tree: layout.publishedPuckData, changed: 0 };
    if (!d.changed && !pub.changed) return false;
    await this.prisma.pageLayout.update({
      where: { id: layout.id },
      data: {
        ...(d.changed ? { puckData: d.tree as Prisma.InputJsonValue } : {}),
        ...(pub.changed
          ? { publishedPuckData: pub.tree as Prisma.InputJsonValue }
          : {}),
      },
    });
    return true;
  }

  /**
   * Nhân bản cây, điền ID học thuật cho MỌI khối hồ sơ trong đó (layout đã khớp
   * người theo slug nên khỏi lọc email). Chỉ set ô nào nguồn CÓ giá trị.
   */
  private setScholarLinksOnStaffBlocks(
    root: unknown,
    ids: Record<
      'orcid' | 'scopus' | 'googleScholar' | 'researcherId' | 'email',
      string
    >,
  ): { tree: unknown; changed: number } {
    let changed = 0;
    const walk = (n: unknown): unknown => {
      if (Array.isArray(n)) return n.map(walk);
      if (!n || typeof n !== 'object') return n;
      const node = n as PuckNode;
      if (node.type && STAFF_TYPES.includes(node.type) && node.props) {
        const props = { ...node.props };
        let hit = false;
        for (const key of [
          'orcid',
          'scopus',
          'googleScholar',
          'researcherId',
          'email',
        ] as const) {
          const val = ids[key];
          if (val && props[key] !== val) {
            props[key] = val;
            hit = true;
          }
        }
        if (!hit) return node;
        changed++;
        return { ...node, props };
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        out[k] = v && typeof v === 'object' ? walk(v) : v;
      }
      return out;
    };
    return { tree: walk(root), changed };
  }

  /**
   * Đặt ẢNH NỀN HERO (và tắt lọc ảnh nghệ thuật) cho mọi trang nhân sự thuộc MỘT
   * bộ môn — chỉ quản trị. "Thuộc bộ môn" xác định qua `User.departmentId` (nguồn
   * thật về nhân sự); trang nhân sự KHÔNG stamp departmentId nên không lọc theo
   * PageLayout được. Ghi cả puckData lẫn publishedPuckData rồi revalidate.
   */
  async setHeroBgForDept(departmentId: string, heroBg: string) {
    const report = { nguoi: 0, doi: 0, boQua: [] as string[] };
    if (!departmentId) return report;
    const profiles = await this.prisma.scholarProfile.findMany({
      where: { staffPageSlug: { not: null }, user: { departmentId } },
      select: { staffPageSlug: true },
    });
    const slugs = [
      ...new Set(profiles.map((p) => p.staffPageSlug ?? '')),
    ].filter(Boolean);
    const touched = new Set<string>();
    for (const slug of slugs) {
      const layout = await this.prisma.pageLayout.findFirst({
        where: { slug, deletedAt: null },
        orderBy: [{ isPublished: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          slug: true,
          puckData: true,
          publishedPuckData: true,
          isPublished: true,
        },
      });
      if (!layout) continue;
      const nodes = this.findStaffNodes(layout.puckData);
      if (nodes.length !== 1) {
        report.boQua.push(slug);
        continue;
      }
      report.nguoi++;
      const d = this.setHeroBgOnStaffBlocks(layout.puckData, heroBg);
      const p = layout.isPublished
        ? this.setHeroBgOnStaffBlocks(layout.publishedPuckData, heroBg)
        : { tree: layout.publishedPuckData, changed: 0 };
      if (!d.changed && !p.changed) continue;
      await this.prisma.pageLayout.update({
        where: { id: layout.id },
        data: {
          ...(d.changed ? { puckData: d.tree as Prisma.InputJsonValue } : {}),
          ...(p.changed
            ? { publishedPuckData: p.tree as Prisma.InputJsonValue }
            : {}),
        },
      });
      report.doi += d.changed;
      touched.add(layout.slug);
    }
    if (touched.size) {
      await this.cache.clear();
      this.publicRevalidate.trigger([
        ...[...touched].map((s) => `page:${s}`),
        'sitemap',
      ]);
    }
    return report;
  }

  /** Nhân bản cây, đặt `heroBg` + tắt `photoFilter` cho mọi khối hồ sơ. */
  private setHeroBgOnStaffBlocks(
    root: unknown,
    heroBg: string,
  ): { tree: unknown; changed: number } {
    let changed = 0;
    const walk = (n: unknown): unknown => {
      if (Array.isArray(n)) return n.map(walk);
      if (!n || typeof n !== 'object') return n;
      const node = n as PuckNode;
      if (node.type && STAFF_TYPES.includes(node.type) && node.props) {
        if (node.props.heroBg === heroBg && node.props.photoFilter === false) {
          return node;
        }
        changed++;
        return {
          ...node,
          props: { ...node.props, heroBg, photoFilter: false },
        };
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        out[k] = v && typeof v === 'object' ? walk(v) : v;
      }
      return out;
    };
    return { tree: walk(root), changed };
  }

  /**
   * Chuẩn hoá TRANG CÁ NHÂN sang kiểu editorial cho mọi trang dưới `prefix` còn ở
   * kiểu cũ (Header + PageHero + StaffProfile + Footer) → (Header +
   * StaffProfileEditorial + Footer). GIỮ nội dung: ảnh/tên/chức danh/email/điện
   * thoại/`html` mang sang; các ô cấu trúc để trống — người vốn không có nên block
   * tự ẩn. Bỏ PageHero (editorial có hero riêng), giữ Header/Footer.
   *
   * Idempotent: trang đã editorial (không còn khối StaffProfile) bị bỏ qua.
   */
  async migrateStaffToEditorial(prefix: string) {
    const template = await this.editorialTemplate();
    if (!template) {
      return {
        error: 'Không tìm thấy trang mẫu StaffProfileEditorial để lấy bố cục.',
      };
    }
    const pages = await this.prisma.pageLayout.findMany({
      where: { slug: { startsWith: prefix }, deletedAt: null },
      select: { id: true, slug: true, puckData: true, isPublished: true },
    });
    const report = { doi: [] as string[], boQua: [] as string[] };
    const touched: string[] = [];
    for (const pg of pages) {
      const content = (pg.puckData as { content?: unknown })?.content;
      if (!Array.isArray(content)) {
        report.boQua.push(pg.slug);
        continue;
      }
      const nodes = content as PuckNode[];
      const staff = nodes.find((b) => b.type === 'StaffProfile');
      if (!staff) {
        report.boQua.push(pg.slug);
        continue;
      }
      const header = nodes.find((b) => b.type === 'Header');
      const footer = nodes.find((b) => b.type === 'Footer');
      const editorial: PuckNode = {
        type: 'StaffProfileEditorial',
        props: this.mapToEditorial(template, staff.props ?? {}, pg.slug),
      };
      const newContent = [header, editorial, footer].filter(Boolean);
      const newPuck = {
        root: (pg.puckData as { root?: unknown })?.root ?? {},
        zones: {},
        content: newContent,
      };
      await this.prisma.pageLayout.update({
        where: { id: pg.id },
        data: {
          puckData: newPuck as unknown as Prisma.InputJsonValue,
          ...(pg.isPublished
            ? { publishedPuckData: newPuck as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      report.doi.push(pg.slug);
      touched.push(pg.slug);
    }
    if (touched.length) {
      await this.cache.clear();
      this.publicRevalidate.trigger([
        ...touched.map((s) => `page:${s}`),
        'sitemap',
      ]);
    }
    return report;
  }

  /** Props KHÔNG-cá-nhân của một khối editorial có sẵn, làm khuôn (tiêu đề mục, photoFilter…). */
  private async editorialTemplate(): Promise<Record<
    string,
    unknown
  > | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ publishedPuckData: unknown; puckData: unknown }>
    >`
      SELECT "publishedPuckData", "puckData" FROM "PageLayout"
      WHERE "deletedAt" IS NULL
        AND (position('StaffProfileEditorial' in "publishedPuckData"::text) > 0
          OR position('StaffProfileEditorial' in "puckData"::text) > 0)
      LIMIT 1
    `;
    if (!rows.length) return null;
    const findEd = (root: unknown): PuckNode | null => {
      let hit: PuckNode | null = null;
      const w = (n: unknown) => {
        if (hit) return;
        if (Array.isArray(n)) return n.forEach(w);
        if (n && typeof n === 'object') {
          if ((n as PuckNode).type === 'StaffProfileEditorial') {
            hit = n as PuckNode;
            return;
          }
          Object.values(n).forEach(w);
        }
      };
      w(root);
      return hit;
    };
    const ed = findEd(rows[0].publishedPuckData) ?? findEd(rows[0].puckData);
    if (!ed?.props) return null;
    const t: Record<string, unknown> = { ...ed.props };
    for (const k of [
      'id', 'photo', 'name', 'role', 'email', 'phone', 'html', 'intro',
      'eyebrow', 'research', 'teaching', 'publications', 'extras', 'projects',
      'nameLines',
    ]) {
      delete t[k];
    }
    return t;
  }

  /** Khuôn + dữ liệu cá nhân của khối StaffProfile cũ → props khối editorial. */
  private mapToEditorial(
    template: Record<string, unknown>,
    sp: Record<string, unknown>,
    slug: string,
  ): Record<string, unknown> {
    const empty = { vi: '', en: '' };
    const seg = slug.split('/').filter(Boolean).pop() ?? '';
    return {
      ...template,
      id: `body-${seg}`,
      photo: asPlain(sp.photo),
      name: sp.name ?? empty,
      role: sp.role ?? empty,
      email: asPlain(sp.email),
      phone: asPlain(sp.phone),
      html: sp.html ?? empty,
      intro: empty,
      eyebrow: empty,
      research: [],
      teaching: [],
      publications: [],
      extras: [],
      projects: [],
      nameLines: [],
    };
  }

  /**
   * Trang mẫu editorial ĐẦY ĐỦ để DỰNG TRANG MỚI: Header + Footer + root + props
   * vỏ (đã bỏ field cá nhân). Khác `editorialTemplate` (chỉ props) vì trang mới
   * chưa có Header/Footer sẵn để giữ như đường migrate.
   */
  private async fullEditorialTemplate(): Promise<{
    header: PuckNode | null;
    footer: PuckNode | null;
    root: unknown;
    props: Record<string, unknown>;
  } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ puckData: unknown; publishedPuckData: unknown }>
    >`
      SELECT "puckData", "publishedPuckData" FROM "PageLayout"
      WHERE "deletedAt" IS NULL
        AND position('StaffProfileEditorial' in coalesce("publishedPuckData"::text, "puckData"::text)) > 0
      LIMIT 1
    `;
    if (!rows.length) return null;
    const src = (rows[0].publishedPuckData ?? rows[0].puckData) as {
      content?: unknown;
      root?: unknown;
    };
    const content = Array.isArray(src?.content)
      ? (src.content as PuckNode[])
      : [];
    const header = content.find((b) => b.type === 'Header') ?? null;
    const footer = content.find((b) => b.type === 'Footer') ?? null;
    const ed = content.find((b) => b.type === 'StaffProfileEditorial');
    if (!ed?.props) return null;
    const props: Record<string, unknown> = { ...ed.props };
    for (const k of [
      'id', 'photo', 'name', 'role', 'email', 'phone', 'html', 'intro',
      'eyebrow', 'research', 'teaching', 'publications', 'extras', 'projects',
      'nameLines', 'orcid', 'scopus', 'googleScholar', 'researcherId',
      'heroLayout',
    ]) {
      delete props[k];
    }
    return { header, footer, root: src?.root ?? {}, props };
  }

  /**
   * Tạo trang nhân sự editorial cho người CÓ bộ môn + hồ sơ nhưng CHƯA có
   * `staffPageSlug` — chỉ quản trị. Slug `{bộ môn}/nhan-su/{học vị}-{tên}` (bỏ
   * dấu qua toSlug); tên hiển thị kèm học vị (trang tự tách sang eyebrow). Các
   * mục nội dung để trống — giảng viên tự điền qua phys-profile.
   *
   * `dryRun` chỉ trả slug SẼ tạo (không ghi). `limit`/`emails` để làm mẫu/chọn.
   */
  async createMissingStaffPages(
    createdBy: string,
    opts: {
      dryRun?: boolean;
      limit?: number;
      emails?: string[];
      excludeEmails?: string[];
    } = {},
  ) {
    const DEG: Record<string, { prefix: string; abbr: string }> = {
      CN: { prefix: 'CN.', abbr: 'cn' },
      ThS: { prefix: 'ThS.', abbr: 'ths' },
      TS: { prefix: 'TS.', abbr: 'ts' },
      PGS: { prefix: 'PGS.TS.', abbr: 'pgsts' },
      GS: { prefix: 'GS.TS.', abbr: 'gsts' },
    };
    const emails = opts.emails
      ?.map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const exclude = opts.excludeEmails
      ?.map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const emailFilter =
      emails?.length || exclude?.length
        ? {
            email: {
              ...(emails?.length ? { in: emails } : {}),
              ...(exclude?.length ? { notIn: exclude } : {}),
            },
          }
        : {};
    const profiles = await this.prisma.scholarProfile.findMany({
      where: {
        staffPageSlug: null,
        user: {
          isActive: true,
          departmentId: { not: null },
          ...emailFilter,
        },
      },
      select: {
        userId: true,
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            degree: true,
            departmentId: true,
            department: { select: { slug: true } },
          },
        },
      },
      orderBy: { userId: 'asc' },
    });

    const tpl = opts.dryRun ? null : await this.fullEditorialTemplate();
    if (!opts.dryRun && !tpl) {
      return { error: 'Không có trang mẫu StaffProfileEditorial để lấy bố cục.' };
    }

    const created: Array<{ email: string; name: string; slug: string }> = [];
    const boQua: Array<{ email: string; lyDo: string }> = [];
    let n = 0;
    for (const p of profiles) {
      if (opts.limit && n >= opts.limit) break;
      const u = p.user;
      const email = u?.email ?? '(?)';
      const fullName = [u?.lastName, u?.firstName]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!fullName || !u?.department?.slug) {
        boQua.push({ email, lyDo: 'thiếu tên hoặc bộ môn' });
        continue;
      }
      const hv = DEG[(u.degree ?? '').trim()];
      const slugBase = `${u.department.slug}/nhan-su/${
        hv ? hv.abbr + '-' : ''
      }${toSlug(fullName)}`;
      // Slug đã có trang khác → BỎ QUA (không tạo trùng, tuyệt đối không đụng
      // trang cũ nên không thể xoá ảnh/nội dung ai). Nổi lên report để soi.
      const trung = await this.prisma.pageLayout.findFirst({
        where: { slug: slugBase, deletedAt: null },
        select: { id: true },
      });
      if (trung) {
        boQua.push({ email, lyDo: `slug đã có trang: ${slugBase}` });
        continue;
      }
      const slug = slugBase;
      const nameVi = hv ? `${hv.prefix} ${fullName}` : fullName;
      n++;
      if (opts.dryRun) {
        created.push({ email, name: nameVi, slug });
        continue;
      }

      const editorial: PuckNode = {
        type: 'StaffProfileEditorial',
        props: {
          ...tpl!.props,
          id: `body-${toSlug(fullName)}`,
          photo: '',
          heroLayout: 'compact',
          name: { vi: nameVi, en: '' },
          nameLines: [],
          email: u.email ?? '',
          intro: { vi: '', en: '' },
          eyebrow: { vi: '', en: '' },
          research: [],
          teaching: [],
          publications: [],
          extras: [],
          projects: [],
          html: { vi: '', en: '' },
        },
      };
      const content = [tpl!.header, editorial, tpl!.footer].filter(Boolean);
      const puck = {
        root: tpl!.root ?? {},
        zones: {},
        content,
      } as unknown as Prisma.InputJsonValue;
      await this.prisma.pageLayout.create({
        data: {
          name: nameVi,
          slug,
          isPublished: true,
          publishedAt: new Date(),
          createdBy,
          departmentId: u.departmentId,
          puckData: puck,
          publishedPuckData: puck,
        },
      });
      await this.prisma.scholarProfile.update({
        where: { userId: p.userId },
        data: { staffPageSlug: slug },
      });
      created.push({ email, name: nameVi, slug });
    }

    if (created.length && !opts.dryRun) {
      await this.cache.clear();
      this.publicRevalidate.trigger([
        ...created.map((c) => `page:${c.slug}`),
        'sitemap',
      ]);
    }
    return { dryRun: !!opts.dryRun, tong: created.length, created, boQua };
  }
}
