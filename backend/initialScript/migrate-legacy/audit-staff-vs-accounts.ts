/**
 * audit-staff-vs-accounts.ts — CHỈ ĐỌC. Ai đang HIỆN trên web Khoa mà KHÔNG có
 * trong danh sách cán bộ (/admin/staff)?
 *
 * Hai nguồn này độc lập nhau:
 *   - Web Khoa dựng danh sách nhân sự từ các TRANG (PageLayout có khối hồ sơ).
 *     Không cần tài khoản nào cả.
 *   - /admin/staff liệt kê TÀI KHOẢN (User).
 * Nên một người có trang mà chưa có tài khoản sẽ hiện ngoài web nhưng không
 * thấy trong trang quản trị — và ngược lại.
 *
 * Script nối hai bên theo thứ tự: hồ sơ khoa học gắn staffPageSlug trước, nếu
 * không có thì khớp theo EMAIL ghi trên trang.
 *
 * Dùng:
 *   ... audit-staff-vs-accounts.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

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

const asVi = (v: unknown): string => {
  if (typeof v === 'string') return v;
  const o = v as { vi?: string; en?: string } | null | undefined;
  return (o?.vi || o?.en || '').trim();
};

const joinLines = (v: unknown): string => {
  if (!Array.isArray(v)) return '';
  return v
    .map((l) => asVi((l as { text?: unknown })?.text))
    .filter(Boolean)
    .join(' ')
    .trim();
};

async function main(): Promise<void> {
  // 1. Mọi trang nhân sự ĐÃ XUẤT BẢN (đúng nguồn mà web Khoa đọc).
  const pages = await prisma.pageLayout.findMany({
    where: {
      slug: { contains: '/nhan-su/' },
      isPublished: true,
      deletedAt: null,
    },
    select: { slug: true, puckData: true, publishedPuckData: true },
    orderBy: { slug: 'asc' },
  });

  // 2. Tài khoản + hồ sơ khoa học để nối.
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
  });
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  const profiles = await prisma.scholarProfile.findMany({
    where: { staffPageSlug: { not: null } },
    select: { staffPageSlug: true, userId: true },
  });
  const userBySlug = new Map(profiles.map((p) => [p.staffPageSlug as string, p.userId]));
  const byId = new Map(users.map((u) => [u.id, u]));

  const orphan: Array<{ slug: string; name: string; email: string }> = [];
  let linked = 0;
  let seen = 0;

  for (const pg of pages) {
    const nodes = findStaff(pg.publishedPuckData ?? pg.puckData);
    if (nodes.length !== 1) continue; // trang mập mờ — web Khoa cũng bỏ qua
    const p = nodes[0].props ?? {};
    const name = joinLines(p.nameLines) || asVi(p.name);
    if (!name) continue; // chưa có tên → web Khoa không hiện
    seen += 1;

    const email = (asVi(p.email) || '').toLowerCase();
    const viaSlug = userBySlug.get(pg.slug);
    const user = viaSlug ? byId.get(viaSlug) : byEmail.get(email);
    if (user) { linked += 1; continue; }
    orphan.push({ slug: pg.slug, name, email: email || '(không có email)' });
  }

  console.log(`Trang nhân sự đang hiện trên web : ${seen}`);
  console.log(`  có tài khoản trong /admin/staff : ${linked}`);
  console.log(`  KHÔNG có tài khoản              : ${orphan.length}\n`);

  if (!orphan.length) {
    console.log('Mọi người hiện trên web đều có tài khoản.');
    await prisma.$disconnect();
    return;
  }

  const byDept = new Map<string, typeof orphan>();
  for (const o of orphan) {
    const dept = o.slug.split('/')[0];
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept)!.push(o);
  }
  for (const [dept, rows] of [...byDept.entries()].sort()) {
    console.log(`[${dept}]  ${rows.length} người`);
    for (const r of rows) {
      console.log(`   ${r.name.padEnd(34)} ${r.email.padEnd(28)} ${r.slug.split('/').pop()}`);
    }
    console.log();
  }
  console.log('(chỉ đọc — script này không ghi gì)');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
