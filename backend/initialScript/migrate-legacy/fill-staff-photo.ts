/**
 * fill-staff-photo.ts — điền ẢNH CHÂN DUNG cho thẻ hồ sơ nhân sự, lấy từ chính
 * nội dung trang.
 *
 * BỐI CẢNH: convert-staff-to-profile.ts lấy ảnh từ `PageHero.bgImage`. Mười
 * trang dựng bằng `Navbar` không có PageHero mang ảnh, nên sau khi chuyển đổi
 * thẻ của họ trống ảnh — trong khi ảnh vẫn nằm trong phần nội dung.
 *
 * AN TOÀN: chỉ nhận trang có ĐÚNG MỘT thẻ <img> trong nội dung. Nhiều ảnh thì
 * bỏ qua, vì không có cách nào chắc chắn ảnh nào là chân dung. Đây là bài học
 * từ lần tự đoán email: trang nào có nhiều ứng viên thì đừng đoán.
 *
 * Ảnh được CHUYỂN (không phải chép): gỡ khỏi nội dung rồi đặt lên thẻ, nếu
 * không chân dung sẽ hiện hai lần trên cùng một trang.
 *
 * Chạy thử (mặc định, không ghi gì):
 *   ... fill-staff-photo.ts --only='slug1,slug2'
 * Chạy thật:
 *   ... fill-staff-photo.ts --apply --only='slug1,slug2'
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith('--only='));
  if (!a) return null;
  const l = a.slice('--only='.length).split(',').map((x) => x.trim()).filter(Boolean);
  return l.length ? l : null;
})();

const STAFF_TYPES = ['StaffProfile', 'StaffProfileEditorial'];
type Node = { type?: string; props?: Record<string, unknown> };

/** Tìm đúng một khối hồ sơ trong cây Puck. */
function findStaff(tree: unknown): Node[] {
  const out: Node[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const node = n as Node;
    if (node.type && STAFF_TYPES.includes(node.type)) out.push(node);
    for (const v of Object.values(n as Record<string, unknown>)) walk(v);
  };
  walk(tree);
  return out;
}

const getHtml = (v: unknown): string =>
  typeof v === 'string' ? v : (((v as { vi?: string })?.vi ?? '') as string);

const setHtml = (orig: unknown, next: string): unknown =>
  typeof orig === 'string' || orig == null
    ? next
    : { ...(orig as object), vi: next };

async function main(): Promise<void> {
  const pages = await prisma.pageLayout.findMany({
    where: ONLY
      ? { slug: { in: ONLY } }
      : { slug: { contains: '/nhan-su/' } },
    select: { id: true, slug: true, puckData: true, publishedPuckData: true },
    orderBy: { slug: 'asc' },
  });
  console.log(`Xét ${pages.length} trang.${APPLY ? '' : '  [CHẠY THỬ]'}\n`);

  let done = 0, skipped = 0;

  for (const page of pages) {
    // Sửa cả bản nháp lẫn bản đang xuất bản, nếu không web không đổi.
    const trees: Array<['puckData' | 'publishedPuckData', unknown]> = [
      ['puckData', page.puckData],
      ['publishedPuckData', page.publishedPuckData],
    ];
    const updates: Record<string, Prisma.InputJsonValue> = {};
    let picked = '';
    let reason = '';

    for (const [field, tree] of trees) {
      if (!tree) continue;
      const nodes = findStaff(tree);
      if (nodes.length !== 1) { reason = `có ${nodes.length} khối hồ sơ`; continue; }
      const props = nodes[0].props ?? {};
      if (typeof props.photo === 'string' && props.photo.trim()) {
        reason = 'đã có ảnh'; continue;
      }
      const html = getHtml(props.html);
      const imgs = [...html.matchAll(/<img[^>]*>/gi)].map((m) => m[0]);
      if (imgs.length !== 1) { reason = `có ${imgs.length} ảnh trong nội dung`; continue; }
      const src = /src="([^"]+)"/i.exec(imgs[0])?.[1] ?? '';
      if (!src) { reason = 'thẻ img không có src'; continue; }

      // Gỡ ảnh khỏi nội dung + dọn thẻ <p> rỗng còn lại.
      let nextHtml = html.replace(imgs[0], '');
      nextHtml = nextHtml.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
      props.photo = src;
      props.html = setHtml(props.html, nextHtml);
      updates[field] = tree as Prisma.InputJsonValue;
      picked = src;
    }

    if (!Object.keys(updates).length) {
      skipped += 1;
      console.log(`  BỎ QUA  ${page.slug}  (${reason || 'không có gì để sửa'})`);
      continue;
    }
    done += 1;
    console.log(`  ${APPLY ? 'ĐẶT   ' : '[thử] '} ${page.slug}`);
    console.log(`          ảnh: ${decodeURIComponent(picked)}`);
    if (APPLY) {
      await prisma.pageLayout.update({ where: { id: page.id }, data: updates });
    }
  }

  console.log(`\nXong.${APPLY ? '' : ' (CHẠY THỬ — chưa ghi gì)'} đặt_ảnh=${done} bỏ_qua=${skipped}`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
