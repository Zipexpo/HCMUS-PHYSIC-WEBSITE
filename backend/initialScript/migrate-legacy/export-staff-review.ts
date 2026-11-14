/**
 * export-staff-review.ts — CHỈ ĐỌC. Xuất TSV danh sách MỌI người đang hiện trên
 * trang nhân sự của web Khoa, để Khoa rà soát ai còn công tác.
 *
 * Lấy đúng nguồn mà web Khoa đọc: các PageLayout đã xuất bản có đường dẫn chứa `/nhan-su/`
 * có đúng một khối hồ sơ. Nhờ vậy bảng khớp với cái người ngoài nhìn thấy, chứ
 * không phải khớp với bảng tài khoản.
 *
 * Cột `co_tai_khoan` cho biết người đó có tài khoản trong /admin/staff không —
 * nối theo staffPageSlug trước, không có thì khớp theo email trên trang.
 *
 * Dùng (chuyển hướng ra tệp):
 *   ... export-staff-review.ts > staff.tsv
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
const joinLines = (v: unknown): string =>
  Array.isArray(v)
    ? v.map((l) => asVi((l as { text?: unknown })?.text)).filter(Boolean).join(' ').trim()
    : '';

/**
 * Độ dài phần GIỚI THIỆU. Khối editorial KHÔNG để nội dung trong `html` (ô đó
 * thường chỉ còn `<p><br></p>` sau khi chuyển đổi) mà để ở `intro`. Đếm nhầm ô
 * `html` sẽ báo "trang trống" cho cả những trang đã điền đầy đủ.
 */
const introLen = (p: Record<string, unknown>): number =>
  [asVi(p.intro), asVi(p.html).replace(/<[^>]+>/g, '')]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim().length;

/** Số mục nội dung: nghiên cứu, giảng dạy, dự án, công bố, mục tự đặt tên. */
const sectionCount = (p: Record<string, unknown>): number =>
  ['research', 'teaching', 'projects', 'publications', 'extras']
    .map((k) => (Array.isArray(p[k]) ? (p[k] as unknown[]).length : 0))
    .reduce((a, b) => a + b, 0);

/** Bỏ ký tự tab/xuống dòng để không vỡ cột TSV. */
const cell = (s: string): string => s.replace(/[\t\r\n]+/g, ' ').trim();

async function main(): Promise<void> {
  const depts = await prisma.department.findMany({ select: { slug: true, name: true } });
  const deptName = new Map(depts.map((d) => [d.slug, d.name]));

  const pages = await prisma.pageLayout.findMany({
    where: { slug: { contains: '/nhan-su/' }, isPublished: true, deletedAt: null },
    select: { slug: true, puckData: true, publishedPuckData: true },
    orderBy: { slug: 'asc' },
  });

  const users = await prisma.user.findMany({
    select: { id: true, email: true, isActive: true },
  });
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byId = new Map(users.map((u) => [u.id, u]));
  const profiles = await prisma.scholarProfile.findMany({
    where: { staffPageSlug: { not: null } },
    select: { staffPageSlug: true, userId: true },
  });
  const userBySlug = new Map(profiles.map((p) => [p.staffPageSlug as string, p.userId]));

  console.log(
    [
      'bo_mon', 'ho_ten', 'hoc_ham_hoc_vi', 'chuc_vu_tren_web',
      'email_tren_web', 'co_anh', 'co_tai_khoan', 'tai_khoan_hoat_dong',
      'do_dai_gioi_thieu', 'so_muc_noi_dung', 'duong_dan_trang',
    ].join('\t'),
  );

  for (const pg of pages) {
    const nodes = findStaff(pg.publishedPuckData ?? pg.puckData);
    if (nodes.length !== 1) continue;
    const p = nodes[0].props ?? {};
    const name = joinLines(p.nameLines) || asVi(p.name);
    if (!name) continue;

    const slugDept = pg.slug.split('/')[0];
    const email = asVi(p.email).toLowerCase();
    const viaSlug = userBySlug.get(pg.slug);
    const user = viaSlug ? byId.get(viaSlug) : byEmail.get(email);

    console.log(
      [
        cell(deptName.get(slugDept) ?? slugDept),
        cell(name),
        cell(asVi(p.eyebrow)),
        cell(asVi(p.role)),
        cell(email || user?.email || ''),
        asVi(p.photo) ? 'co' : 'khong',
        user ? 'co' : 'KHONG',
        user ? (user.isActive ? 'co' : 'da vo hieu') : '',
        String(introLen(p)),
        String(sectionCount(p)),
        `https://phys.hcmus.edu.vn/vi/${pg.slug}`,
      ].join('\t'),
    );
  }

  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
