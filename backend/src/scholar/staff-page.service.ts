import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../shared/services/event-bus.service';
import { PublicRevalidateService } from '../shared/services/public-revalidate.service';
import {
  NoStaffPageException,
  StaffBlockAmbiguousException,
  StaffBlockNotFoundException,
} from './scholar.error';
import type { UpdateStaffPageBodyType } from './scholar.model';

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

    return {
      slug,
      layoutId: layout.id,
      photo: asPlain(p.photo),
      eyebrow: asText(p.eyebrow),
      eyebrowEn: asEn(p.eyebrow),
      name: asText(p.name),
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

  async update(userId: string, body: UpdateStaffPageBodyType) {
    const { layout, node, slug } = await this.locate(userId);
    const prev = node.props ?? {};
    const next: Record<string, unknown> = { ...prev };

    if (body.photo !== undefined) next.photo = body.photo ?? '';
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
   * Tự điền hồ sơ học thuật (ORCID / Scopus / Google Scholar / ResearcherID) vào
   * MỌI khối hồ sơ trên trang nhân sự — chỉ quản trị. Ghép khối ↔ người theo
   * EMAIL (`props.email` của khối, cùng cách updateProfileCards ghép thẻ danh
   * sách), lấy ID từ ScholarProfile. CHỈ ghi đè ô nào nguồn CÓ giá trị — không
   * xoá ID người dùng đã tự điền trên khối. Ghi cả puckData (trình dựng) lẫn
   * publishedPuckData (trang công khai) rồi revalidate.
   */
  async backfillScholarLinks() {
    const profiles = await this.prisma.scholarProfile.findMany({
      select: {
        orcid: true,
        scopusAuthorId: true,
        researcherId: true,
        googleScholarId: true,
        user: { select: { email: true } },
      },
    });
    const byEmail = new Map<string, Record<string, string>>();
    for (const p of profiles) {
      const email = p.user?.email?.toLowerCase();
      if (!email) continue;
      byEmail.set(email, {
        orcid: p.orcid ?? '',
        scopus: p.scopusAuthorId ?? '',
        googleScholar: p.googleScholarId ?? '',
        researcherId: p.researcherId ?? '',
      });
    }

    // Trang nhân sự = layout có khối StaffProfileEditorial trong puckData/published.
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "PageLayout"
      WHERE "deletedAt" IS NULL
        AND (position('StaffProfileEditorial' in "puckData"::text) > 0
          OR position('StaffProfileEditorial' in coalesce("publishedPuckData"::text, '')) > 0)
    `;

    const report = { doi: 0, boQua: 0, khongKhop: [] as string[] };
    const touched = new Set<string>();
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
      // Đếm/báo cáo từ bản nháp (puckData tồn tại ở mọi trang); bản published chỉ
      // ghi theo, không đếm lại để khỏi nhân đôi cùng một khối.
      const d = this.setScholarLinksOnStaffBlocks(
        layout.puckData,
        byEmail,
        report,
      );
      const p = layout.isPublished
        ? this.setScholarLinksOnStaffBlocks(
            layout.publishedPuckData,
            byEmail,
            null,
          )
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
      touched.add(layout.slug);
    }
    if (touched.size) {
      await this.cache.clear();
      this.publicRevalidate.trigger([
        ...[...touched].map((s) => `page:${s}`),
        'sitemap',
      ]);
    }
    return { ...report, khongKhop: [...new Set(report.khongKhop)] };
  }

  /**
   * Nhân bản cây, điền ID học thuật cho mọi khối hồ sơ khớp EMAIL. Chỉ set ô nào
   * nguồn CÓ giá trị (không xoá ô người dùng đã điền). `report` = null khi duyệt
   * bản published (đã đếm ở bản nháp) để khỏi đếm trùng.
   */
  private setScholarLinksOnStaffBlocks(
    root: unknown,
    byEmail: Map<string, Record<string, string>>,
    report: { doi: number; boQua: number; khongKhop: string[] } | null,
  ): { tree: unknown; changed: number } {
    let changed = 0;
    const walk = (n: unknown): unknown => {
      if (Array.isArray(n)) return n.map(walk);
      if (!n || typeof n !== 'object') return n;
      const node = n as PuckNode;
      if (node.type && STAFF_TYPES.includes(node.type) && node.props) {
        const email = String(node.props.email ?? '').toLowerCase();
        if (!email) {
          if (report) report.boQua++;
          return node;
        }
        const links = byEmail.get(email);
        if (!links) {
          if (report) report.khongKhop.push(email);
          return node;
        }
        const props = { ...node.props };
        let hit = false;
        for (const key of [
          'orcid',
          'scopus',
          'googleScholar',
          'researcherId',
        ] as const) {
          const val = links[key];
          if (val && props[key] !== val) {
            props[key] = val;
            hit = true;
          }
        }
        if (!hit) {
          if (report) report.boQua++;
          return node;
        }
        changed++;
        if (report) report.doi++;
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
}
