/**
 * find-user.ts — CHỈ ĐỌC. Tìm tài khoản theo một phần tên hoặc email.
 *
 * Dùng khi thấy một dòng lạ trong /admin/staff và muốn biết nó từ đâu ra: tạo
 * lúc nào (ngày di trú hay người thêm tay), đã đăng nhập chưa, gắn đơn vị nào,
 * có trang nhân sự không.
 *
 * Dùng:
 *   ... find-user.ts "Phạm Lê Việt"
 *   ... find-user.ts @student.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const Q = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();

async function main(): Promise<void> {
  if (!Q) {
    console.error('Dùng: find-user.ts "<một phần tên hoặc email>"');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: Q, mode: 'insensitive' } },
        { firstName: { contains: Q, mode: 'insensitive' } },
        { lastName: { contains: Q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      department: { select: { name: true } },
      scholarProfile: { select: { staffPageSlug: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 40,
  });

  if (!rows.length) {
    console.log(`Không có tài khoản nào khớp "${Q}".`);
    await prisma.$disconnect();
    return;
  }

  console.log(`${rows.length} tài khoản khớp "${Q}":\n`);
  for (const u of rows) {
    const name = `${u.lastName ?? ''} ${u.firstName ?? ''}`.trim() || '(không tên)';
    console.log(`  ${name}`);
    console.log(`    email     : ${u.email}`);
    console.log(`    vai trò   : ${u.role}   ${u.isActive ? 'đang dùng' : 'ĐÃ VÔ HIỆU'}`);
    console.log(`    đơn vị    : ${u.department?.name ?? '(chưa gắn)'}`);
    console.log(`    tạo lúc   : ${u.createdAt.toISOString().slice(0, 10)}`);
    console.log(`    đăng nhập : ${u.lastLoginAt?.toISOString().slice(0, 16) ?? '(chưa bao giờ)'}`);
    console.log(`    trang NS  : ${u.scholarProfile?.staffPageSlug ?? '(không gắn)'}`);
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
