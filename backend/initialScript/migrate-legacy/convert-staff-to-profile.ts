/**
 * convert-staff-to-profile.ts — đổi khung trang nhân sự từ LegacyPageBody sang
 * StaffProfile (ảnh chân dung thành card bên trái thay vì bị chôn làm nền banner).
 *
 * KHÔNG cần MariaDB legacy: mọi dữ liệu cần thiết đã nằm trong Postgres từ lần
 * migrate trước —
 *   ảnh chân dung ← PageHero.bgImage   (build-class-staff-pages.ts đã nhét vào đây)
 *   nội dung      ← LegacyPageBody.html (giữ NGUYÊN, không dựng lại từ dump nên
 *                                        chỉnh sửa của biên tập viên không mất)
 *   họ tên        ← PageHero.title
 *   email         ← mailto: trong chính nội dung
 *
 * An toàn khi chạy lại: trang đã chuyển rồi thì bỏ qua; trang đã dựng tay (khung
 * khác 4 khối chuẩn) cũng bỏ qua và in tên ra để người xem lại.
 *
 * Chạy thử (không ghi gì):
 *   corepack pnpm --filter backend exec tsx initialScript/migrate-legacy/convert-staff-to-profile.ts --dry
 * Chạy thật:
 *   corepack pnpm --filter backend exec tsx initialScript/migrate-legacy/convert-staff-to-profile.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';
import { flushCache } from './flush-cache';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const DRY = process.argv.includes('--dry') || process.env.DRY_RUN === '1';
// Nhận mọi khung miễn còn khối LegacyPageBody — dùng cho 25 trang dựng bằng
// `Navbar` thay vì `Header` (khung chuẩn chỉ lệch đúng khối đầu).
const LOOSE = process.argv.includes('--loose');
// Đổi sang bố cục tạp chí (StaffProfileEditorial) thay vì StaffProfile.
const EDITORIAL = process.argv.includes('--editorial');
// --only=<slug>[,<slug>...] — CHỈ đụng vào đúng những trang này.
// Cần vì --loose bắt mọi trang còn LegacyPageBody, trong đó có các trang TRÙNG
// (một người hai slug). Chuyển cả trang trùng thì người đó hiện HAI dòng trong
// danh sách nhân sự. Có --only thì nhắm đúng người cần, không đụng phần còn lại.
const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  const list = arg
    .slice('--only='.length)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
})();

type PuckNode = { type?: string; props?: Record<string, unknown> };
type PuckTree = { root?: unknown; content?: PuckNode[] };

// KHÔNG tự đoán email từ nội dung. Bản chạy thử cho thấy nhiều trang nhắc email
// của NGƯỜI KHÁC (người hướng dẫn, đầu mối liên hệ) nên "lấy mailto: đầu tiên"
// gán nhầm hàng loạt: Lê Đức Anh ra email của Nguyễn Mạnh Bảo, một loạt trang ra
// email của Trần Quang Trung. Email sai trên hồ sơ công khai tệ hơn là để trống —
// dù sao nội dung trang vẫn hiện email đúng của họ. Biên tập viên điền vào ô
// Email trong Puck nếu muốn hiện trên danh thiếp.

/**
 * Đổi một cây Puck sang khung StaffProfile.
 *
 * Mặc định CHỈ nhận đúng khung 4 khối do migrate sinh ra (Header → PageHero →
 * LegacyPageBody → Footer) — trang nào khác thì để yên, vì khác khung nghĩa là
 * có người đã dựng lại bằng tay.
 *
 * `--loose`: nhận mọi khung, miễn là còn khối LegacyPageBody — đổi ĐÚNG khối đó
 * tại chỗ, các component khác giữ nguyên vị trí. Dùng cho các trang trùng lặp mà
 * chế độ chặt bỏ qua.
 */
function convertTree(
  tree: unknown,
  loose: boolean,
): { next: PuckTree; reason?: never } | { next: null; reason: string } {
  const content = (tree as PuckTree | null)?.content;
  if (!Array.isArray(content)) return { next: null, reason: 'custom' };

  // `--editorial` đổi sang bố cục tạp chí StaffProfileEditorial; nguồn có thể là khối
  // LegacyPageBody (trang chưa chuyển) HOẶC StaffProfile (đã chuyển đợt trước).
  const target = EDITORIAL ? 'StaffProfileEditorial' : 'StaffProfile';
  const sources = EDITORIAL
    ? ['LegacyPageBody', 'StaffProfile']
    : ['LegacyPageBody'];

  const bodyIdx = content.findIndex(
    (c) => typeof c?.type === 'string' && sources.includes(c.type),
  );
  if (bodyIdx === -1)
    return {
      next: null,
      reason: content.some((c) => c?.type === target) ? 'done' : 'custom',
    };

  if (!loose) {
    const types = content.map((c) => c?.type);
    const shaped =
      content.length === 4 &&
      types[0] === 'Header' &&
      types[1] === 'PageHero' &&
      types[3] === 'Footer' &&
      bodyIdx === 2;
    if (!shaped) return { next: null, reason: 'custom' };
  }

  // Ảnh chân dung nằm ở nền banner (do lần migrate trước nhét vào đó).
  const heroIdx = content.findIndex((c) => c?.type === 'PageHero');
  const heroProps = heroIdx >= 0 ? (content[heroIdx].props ?? {}) : {};
  const portrait = typeof heroProps.bgImage === 'string' ? heroProps.bgImage : '';
  const body = content[bodyIdx];
  const bp = body.props ?? {};
  const html = bp.html ?? { vi: '', en: '' };
  // Chuyển từ StaffProfile sang bố cục mới thì GIỮ những gì biên tập viên đã điền
  // (ảnh, tên, chức danh, email, điện thoại) — không nạp đè bằng dữ liệu cũ.
  const photo = (typeof bp.photo === 'string' && bp.photo) || portrait;
  const name = bp.name ?? heroProps.title ?? { vi: '', en: '' };

  return {
    next: {
      ...(tree as PuckTree),
      content: content.map((node, i) => {
        // Ảnh rời khỏi nền banner → banner về nền navy sạch.
        if (i === heroIdx) return { ...node, props: { ...heroProps, bgImage: '' } };
        if (i !== bodyIdx) return node;
        const id = bp.id ?? `body-${i}`;
        return EDITORIAL
          ? {
              type: 'StaffProfileEditorial',
              props: {
                id,
                photo,
                photoFilter: true,
                eyebrow: bp.role ?? { vi: '', en: '' },
                name,
                nameLines: [],
                intro: { vi: '', en: '' },
                researchTitle: { vi: 'Nghiên cứu', en: 'Research' },
                research: [],
                teachingTitle: { vi: 'Giảng dạy', en: 'Teaching' },
                teaching: [],
                projectsTitle: { vi: 'Dự án ứng dụng', en: 'Projects' },
                projects: [],
                pubsTitle: { vi: 'Xuất bản khoa học', en: 'Publications' },
                publications: [],
                pubsMoreUrl: '',
                pubsMoreLabel: {
                  vi: 'Xem toàn bộ danh sách bài báo →',
                  en: 'See all publications →',
                },
                contentTitle: { vi: '', en: '' },
                html,
              },
            }
          : {
              type: 'StaffProfile',
              props: {
                id,
                photo,
                name,
                role: { vi: '', en: '' },
                email: '',
                phone: '',
                html,
              },
            };
      }),
    },
  };
}

async function main(): Promise<void> {
  const pages = await prisma.pageLayout.findMany({
    where: ONLY
      ? { slug: { in: [...ONLY] } }
      : { slug: { contains: '/nhan-su/' } },
    select: { id: true, slug: true, puckData: true, publishedPuckData: true },
    orderBy: { slug: 'asc' },
  });
  if (ONLY) {
    console.log(`--only: nhắm ${ONLY.size} trang, tìm thấy ${pages.length}.`);
    // Gõ sai slug thì im lặng bỏ qua rất dễ tưởng là đã chạy — báo rõ ra.
    const found = new Set(pages.map((p) => p.slug));
    for (const want of ONLY) {
      if (!found.has(want)) console.log(`  KHÔNG TÌM THẤY: ${want}`);
    }
  } else {
    console.log(`Tìm thấy ${pages.length} trang nhân sự.`);
  }

  let converted = 0;
  let alreadyDone = 0;
  let custom = 0;
  let failed = 0;

  for (const page of pages) {
    // Mỗi trang có HAI bản: nháp (puckData) và bản công chúng thấy
    // (publishedPuckData). Chúng có thể lệch khung nhau — xét ĐỘC LẬP.
    // Trước đây nếu bản nháp đã chuyển rồi thì bỏ qua cả trang, nên bản đã xuất
    // bản không bao giờ được đụng tới → ngoài site vẫn y như cũ.
    const draft = convertTree(page.puckData, LOOSE);
    const published = convertTree(page.publishedPuckData, LOOSE);

    if (!draft.next && !published.next) {
      if (draft.reason === 'done') alreadyDone += 1;
      else {
        custom += 1;
        console.log(`  ~ bỏ qua (khung lạ): ${page.slug}`);
      }
      continue;
    }

    const frameOf = (d: unknown) =>
      ((d as PuckTree | null)?.content ?? []).map((c) => c?.type ?? '?').join('>');

    if (DRY) {
      const parts = [
        draft.next ? 'nháp' : null,
        published.next ? 'ĐÃ XUẤT BẢN' : null,
      ].filter(Boolean);
      console.log(
        `  [dry] ${page.slug}\n        đổi: ${parts.join(' + ')}` +
          `\n        nháp     : ${frameOf(page.puckData)}` +
          `\n        xuất bản : ${frameOf(page.publishedPuckData)}`,
      );
      converted += 1;
      continue;
    }

    try {
      await prisma.pageLayout.update({
        where: { id: page.id },
        data: {
          ...(draft.next
            ? { puckData: draft.next as unknown as Prisma.InputJsonValue }
            : {}),
          ...(published.next
            ? {
                publishedPuckData:
                  published.next as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
      converted += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ! lỗi ${page.slug}:`, (err as Error).message);
    }
  }

  console.log(
    `Xong${DRY ? ' (CHẠY THỬ — chưa ghi gì)' : ''}. ` +
      `da_chuyen=${converted} da_chuyen_tu_truoc=${alreadyDone} ` +
      `bo_qua_dung_tay=${custom} loi=${failed}`,
  );
  if (!DRY && converted > 0) await flushCache();
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  void prisma.$disconnect();
  process.exit(1);
});
