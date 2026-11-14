/**
 * audit-user-data.ts — CHỈ ĐỌC. Một tài khoản đang giữ những dữ liệu gì?
 *
 * Dùng trước khi quyết định gộp hay xoá tài khoản trùng. Liệt kê đúng những
 * bảng sẽ BỊ XOÁ THEO nếu xoá tài khoản (onDelete: Cascade trong schema) —
 * nên con số ở đây cũng chính là "sẽ mất gì nếu xoá".
 *
 * Dùng:
 *   docker compose -f docker-compose.sandbox.yml exec -T backend \
 *     node_modules/.bin/tsx initialScript/migrate-legacy/audit-user-data.ts a@x.vn b@x.vn
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const EMAILS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

async function report(email: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      departmentId: true,
      department: { select: { name: true, slug: true } },
      createdAt: true,
      lastLoginAt: true,
    },
  });
  console.log('='.repeat(70));
  if (!u) {
    console.log(`${email}  —  KHÔNG CÓ tài khoản nào`);
    return;
  }
  console.log(`${email}`);
  console.log(`  id        : ${u.id}`);
  console.log(`  tên       : ${u.lastName ?? ''} ${u.firstName ?? ''}`.trimEnd());
  console.log(`  vai trò   : ${u.role}   trạng thái: ${u.isActive ? 'đang dùng' : 'ĐÃ VÔ HIỆU'}`);
  console.log(`  đơn vị    : ${u.department?.name ?? '(chưa gắn)'}`);
  console.log(`  tạo lúc   : ${u.createdAt.toISOString().slice(0, 10)}`);
  console.log(`  đăng nhập : ${u.lastLoginAt?.toISOString().slice(0, 16) ?? '(chưa bao giờ)'}`);

  const id = u.id;
  const counts: Array<[string, number]> = [
    ['Bài viết (Post)', await prisma.post.count({ where: { createdBy: id } })],
    ['Bố cục trang (PageLayout)', await prisma.pageLayout.count({ where: { createdBy: id } })],
    ['Tệp/ảnh (Media)', await prisma.media.count({ where: { createdBy: id } })],
    ['Bình luận', await prisma.postComment.count({ where: { userId: id } })],
    ['Hồ sơ khoa học', await prisma.scholarProfile.count({ where: { userId: id } })],
    ['Tác giả công bố', await prisma.publicationAuthor.count({ where: { userId: id } })],
    ['Thành viên đề tài', await prisma.projectMember.count({ where: { userId: id } })],
  ];
  const total = counts.reduce((s, [, n]) => s + n, 0);
  console.log('  --- dữ liệu đang giữ (sẽ MẤT nếu xoá tài khoản) ---');
  for (const [label, n] of counts) {
    console.log(`  ${n > 0 ? '*' : ' '} ${label.padEnd(30)} ${n}`);
  }
  console.log(`    ${'TỔNG'.padEnd(30)} ${total}`);

  const prof = await prisma.scholarProfile.findUnique({
    where: { userId: id },
    select: { staffPageSlug: true, showOnWeb: true },
  });
  if (prof) {
    console.log('  --- hồ sơ khoa học ---');
    console.log(`    trang nhân sự gắn : ${prof.staffPageSlug ?? '(chưa gắn)'}`);
    console.log(`    hiện trên web     : ${prof.showOnWeb ? 'có' : 'KHÔNG'}`);
  }
}

async function main(): Promise<void> {
  if (!EMAILS.length) {
    console.error('Dùng: audit-user-data.ts <email> [email2 ...]');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  for (const e of EMAILS) await report(e);
  console.log('='.repeat(70));
  console.log('(chỉ đọc — script này không ghi gì)');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
