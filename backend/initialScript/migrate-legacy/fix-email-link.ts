/**
 * fix-email-link.ts — thay một địa chỉ email SAI bằng địa chỉ ĐÚNG trên một
 * hoặc nhiều trang.
 *
 * VÌ SAO KHÔNG DÙNG audit-mailto-mismatch --fix: script đó sửa theo luật "chữ
 * hiển thị luôn đúng, href là cái bị quên". Luật đó đúng với phần lớn trang,
 * nhưng sai với trang của PGS.TS Đặng Văn Liệt — ở đó CHỮ HIỂN THỊ mới là cái
 * gõ nhầm (`gamil.com`). Chạy luật chung sẽ biến link thành một địa chỉ không
 * tồn tại. Nên ba ca còn lại sửa tay bằng script này, nêu rõ địa chỉ đúng.
 *
 * Cách làm: thay THUẦN CHUỖI trên mọi giá trị chữ trong cây Puck. Nhờ vậy sửa
 * được cùng lúc `href="mailto:..."`, chữ hiển thị, và ô Email của khối hồ sơ —
 * không cần hiểu cấu trúc HTML.
 *
 * Ghi cả bản nháp lẫn bản ĐÃ XUẤT BẢN, vì trang công khai đọc bản đã xuất bản.
 *
 * Chạy thử (mặc định):
 *   ... fix-email-link.ts --slugs='trang-a,trang-b' --match='sai@x.vn' --to='dung@x.vn'
 * Ghi thật: thêm --apply
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const arg = (n: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : null;
};
const list = (s: string | null): string[] =>
  (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

const SLUGS = list(arg('slugs'));
const MATCH = list(arg('match'));
const TO = arg('to');
const APPLY = process.argv.includes('--apply');

/** Thay chuỗi trên mọi giá trị chữ trong cây; trả về số lần thay. */
function replaceDeep(node: unknown, from: string[], to: string): number {
  let hits = 0;
  const walk = (n: unknown): unknown => {
    if (typeof n === 'string') {
      let out = n;
      for (const f of from) {
        if (!out.includes(f)) continue;
        hits += out.split(f).length - 1;
        out = out.split(f).join(to);
      }
      return out;
    }
    if (Array.isArray(n)) return n.map(walk);
    if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
      return o;
    }
    return n;
  };
  walk(node);
  return hits;
}

async function main(): Promise<void> {
  if (!SLUGS.length || !MATCH.length || !TO) {
    console.error(
      "Dùng: --slugs='a,b' --match='sai@x.vn[,sai2@x.vn]' --to='dung@x.vn' [--apply]",
    );
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (MATCH.includes(TO)) {
    console.error('--to trùng với một giá trị trong --match — sẽ không đổi gì. Dừng.');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  console.log(`Thay: ${MATCH.join(' | ')}`);
  console.log(`Bằng: ${TO}`);
  console.log(`Trên ${SLUGS.length} trang.${APPLY ? '' : '   [CHẠY THỬ]'}\n`);

  let totalHits = 0;
  let touched = 0;

  for (const slug of SLUGS) {
    const rows = await prisma.pageLayout.findMany({
      where: { slug, deletedAt: null },
      select: { id: true, slug: true, isPublished: true, puckData: true, publishedPuckData: true },
    });
    if (!rows.length) {
      console.log(`  KHÔNG TÌM THẤY  ${slug}`);
      continue;
    }
    // Slug không duy nhất — sửa HẾT các bản chưa xoá cùng slug thì mới triệt để
    // (trang trùng cũng đang hiện cùng nội dung sai).
    for (const page of rows) {
      const data: Record<string, Prisma.InputJsonValue> = {};
      let hits = 0;
      for (const field of ['puckData', 'publishedPuckData'] as const) {
        const tree = page[field];
        if (!tree) continue;
        const clone = JSON.parse(JSON.stringify(tree)) as unknown;
        const n = replaceDeep(clone, MATCH, TO);
        if (!n) continue;
        hits += n;
        data[field] = clone as Prisma.InputJsonValue;
      }
      if (!hits) continue;
      totalHits += hits;
      touched += 1;
      console.log(
        `  ${APPLY ? 'SỬA  ' : '[thử]'} ${page.slug}${page.isPublished ? '' : '  (nháp)'}  — ${hits} chỗ`,
      );
      if (APPLY) {
        await prisma.pageLayout.update({ where: { id: page.id }, data });
      }
    }
  }

  console.log(
    `\n${APPLY ? 'Xong.' : '(CHẠY THỬ — chưa ghi gì.)'} đổi ${totalHits} chỗ trên ${touched} bản ghi.`,
  );
  if (APPLY && touched) {
    console.log('Nhớ xoá cache trang đã sửa, hoặc đợi 10 phút cho đệm hết hạn.');
  }
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
