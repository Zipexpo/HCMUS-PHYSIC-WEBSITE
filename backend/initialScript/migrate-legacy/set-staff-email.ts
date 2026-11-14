/**
 * set-staff-email.ts — đặt EMAIL trên thẻ hồ sơ của một trang nhân sự.
 *
 * VÌ SAO CẦN: email hiện trên thẻ nằm trong ô `email` của khối StaffProfile ở
 * chính trang đó, KHÔNG phải lấy từ tài khoản. Nên vô hiệu hoá hay xoá tài
 * khoản đều không đổi được email ngoài web.
 *
 * ĐỪNG XOÁ TRẮNG ô này: danh sách bộ môn có bước lùi `r.email || acctEmail`,
 * ô trống sẽ khiến thẻ lấy email của TÀI KHOẢN đang gắn — có thể vẫn là email
 * sai. Điền email đúng vào thì chắc chắn.
 *
 * Ghi cả bản nháp lẫn bản ĐÃ XUẤT BẢN, vì trang công khai đọc bản đã xuất bản.
 *
 * Xem hiện trạng (mặc định, không ghi gì):
 *   ... set-staff-email.ts --slug='vat-ly-chat-ran/nhan-su/ts-le-duy-nam'
 * Đặt email:
 *   ... set-staff-email.ts --slug='...' --email='lednam@hcmus.edu.vn' --apply
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const arg = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const SLUG = arg('slug');
const EMAIL = arg('email');
const APPLY = process.argv.includes('--apply');

const STAFF_TYPES = ['StaffProfile', 'StaffProfileEditorial'];
type Node = { type?: string; props?: Record<string, unknown> };

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

async function main(): Promise<void> {
  if (!SLUG) {
    console.error("Thiếu --slug='<đường dẫn trang>'");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  // Slug KHÔNG duy nhất trong bảng này — chọn nhầm dòng là sửa nhầm trang.
  const rows = await prisma.pageLayout.findMany({
    where: { slug: SLUG, deletedAt: null },
    select: {
      id: true,
      slug: true,
      isPublished: true,
      puckData: true,
      publishedPuckData: true,
    },
  });
  if (!rows.length) {
    console.error(`Không có trang nào slug = ${SLUG}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  const published = rows.filter((r) => r.isPublished);
  if (rows.length > 1 && published.length !== 1) {
    console.error(`Có ${rows.length} trang cùng slug này, không rõ sửa cái nào:`);
    for (const r of rows) {
      console.error(`   ${r.id}  ${r.isPublished ? 'đã xuất bản' : 'nháp'}`);
    }
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  const page = published[0] ?? rows[0];

  const data: Record<string, Prisma.InputJsonValue> = {};
  for (const field of ['puckData', 'publishedPuckData'] as const) {
    const tree = page[field];
    if (!tree) continue;
    const nodes = findStaff(tree);
    if (nodes.length !== 1) {
      console.log(`  ${field}: có ${nodes.length} khối hồ sơ — bỏ qua cho an toàn`);
      continue;
    }
    const props = nodes[0].props ?? {};
    const before = (props.email as string) ?? '';
    console.log(`  ${field.padEnd(18)} hiện tại: ${before || '(trống)'}`);
    if (!EMAIL) continue;
    if (before === EMAIL) {
      console.log(`  ${' '.repeat(18)} -> đã đúng rồi, không đổi`);
      continue;
    }
    props.email = EMAIL;
    data[field] = tree as Prisma.InputJsonValue;
    console.log(`  ${' '.repeat(18)} -> đặt thành: ${EMAIL}`);
  }

  if (!EMAIL) {
    console.log('\n(chỉ xem — thêm --email= và --apply để đổi)');
  } else if (!Object.keys(data).length) {
    console.log('\nKhông có gì để đổi.');
  } else if (APPLY) {
    await prisma.pageLayout.update({ where: { id: page.id }, data });
    console.log(`\nĐÃ GHI vào trang ${page.id}.`);
    console.log('Danh sách bộ môn có cache 5 phút — đợi một lát rồi xem lại.');
  } else {
    console.log('\n(CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.)');
  }
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
