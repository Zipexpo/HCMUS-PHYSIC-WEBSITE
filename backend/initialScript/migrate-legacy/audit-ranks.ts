/**
 * audit-ranks.ts — CHỈ ĐỌC. Dữ liệu đang dùng những mã NGẠCH nào?
 *
 * Trang nhân sự suy chức vụ hiển thị từ `User.rank` qua bảng RANK_ROLE trong
 * scholar/staff-page.service.ts. Mã nào KHÔNG có trong bảng đó sẽ rơi xuống
 * mặc định "Giảng viên" — sai cho kỹ thuật viên, nhân viên phòng ban…
 *
 * Dùng:
 *   ... audit-ranks.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

/** Giữ khớp với RANK_ROLE bên staff-page.service.ts. */
const KNOWN = ['gv', 'gvc', 'gvcc', 'cv', 'trg', 'ncv', 'ncvc', 'ktv', 'nv'];

async function main(): Promise<void> {
  const ranks = await prisma.user.groupBy({
    by: ['rank'],
    _count: true,
    orderBy: { _count: { rank: 'desc' } },
  });
  console.log('NGẠCH (User.rank) đang có trong dữ liệu:\n');
  console.log(`  ${'mã'.padEnd(10)} ${'số người'.padStart(8)}   backend hiểu?`);
  console.log('  ' + '-'.repeat(44));
  for (const r of ranks) {
    const key = (r.rank ?? '').toLowerCase().trim();
    const label = r.rank === null ? '(trống)' : r.rank;
    const ok = key && KNOWN.includes(key);
    console.log(
      `  ${label.padEnd(10)} ${String(r._count).padStart(8)}   ` +
        (key === '' ? '—' : ok ? 'có' : 'KHÔNG -> hiện nhầm "Giảng viên"'),
    );
  }

  const positions = await prisma.user.groupBy({
    by: ['positionKey'],
    _count: true,
    orderBy: { _count: { positionKey: 'desc' } },
  });
  console.log('\nCHỨC VỤ (User.positionKey):\n');
  for (const p of positions) {
    console.log(`  ${(p.positionKey ?? '(trống)').padEnd(22)} ${p._count}`);
  }

  // Nhat ky doi ngach. Goi count() cung la cach kiem bang da tao dung chua:
  // chua co bang thi Prisma bao loi ngay o day.
  const soLan = await prisma.rankChange.count();
  console.log(`
NHẬT KÝ ĐỔI NGẠCH: ${soLan} lần đã ghi`);
  if (soLan) {
    const rows = await prisma.rankChange.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { email: true } } },
    });
    for (const r of rows) {
      console.log(
        `  ${r.effectiveFrom.toISOString().slice(0, 10)}  ` +
          `${(r.user?.email ?? '').padEnd(28)} ` +
          `${(r.fromRank ?? '-').padEnd(7)} -> ${(r.toRank ?? '-').padEnd(7)}  ${r.reason}`,
      );
    }
  }

  console.log('\n(chỉ đọc — script này không ghi gì)');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
