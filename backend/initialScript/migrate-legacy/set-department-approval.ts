/**
 * set-department-approval.ts — bật/tắt KIỂM DUYỆT cho một đơn vị.
 *
 * Đơn vị đã bật: tài khoản của đơn vị KHÔNG tự đăng bài lên web Khoa được —
 * bấm đăng = gửi duyệt, admin cấp Khoa duyệt thì bài mới lên. Chặn ở backend
 * (PostService.publishAttachedLayouts) nên gọi thẳng API cũng không lách được.
 *
 * Xem hiện trạng:
 *   docker compose -f docker-compose.sandbox.yml exec backend \
 *     node_modules/.bin/tsx initialScript/migrate-legacy/set-department-approval.ts
 * Bật / tắt:
 *   ... set-department-approval.ts cau-lac-bo on
 *   ... set-department-approval.ts cau-lac-bo off
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const [slug, mode] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!slug) {
    const rows = await prisma.department.findMany({
      select: { slug: true, name: true, kind: true, requiresApproval: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    console.log('Hiện trạng kiểm duyệt:\n');
    for (const d of rows) {
      console.log(
        `  ${d.requiresApproval ? '[DUYỆT]' : '[     ]'} ` +
          `${d.kind === 'unit' ? 'ĐƠN VỊ' : 'bộ môn'} ${d.slug.padEnd(24)} ${d.name}`,
      );
    }
    console.log('\nBật : ... set-department-approval.ts <slug> on');
    console.log('Tắt : ... set-department-approval.ts <slug> off');
    await prisma.$disconnect();
    return;
  }

  if (mode !== 'on' && mode !== 'off') {
    console.error('Thiếu "on" hoặc "off".');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const dept = await prisma.department.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!dept) {
    console.error(`Không có đơn vị nào slug = ${slug}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  await prisma.department.update({
    where: { id: dept.id },
    data: { requiresApproval: mode === 'on' },
  });
  console.log(
    mode === 'on'
      ? `Đã BẬT kiểm duyệt cho "${dept.name}" — bài của đơn vị này phải chờ Khoa duyệt.`
      : `Đã TẮT kiểm duyệt cho "${dept.name}" — đơn vị tự đăng như trước.`,
  );

  // Bật duyệt giữa chừng: bài đang chờ xuất bản mà chưa lên web sẽ rơi vào
  // hàng đợi duyệt. Cho biết trước để khỏi bất ngờ.
  if (mode === 'on') {
    const waiting = await prisma.post.count({
      where: {
        departmentId: dept.id,
        status: 'PENDING',
        deletedAt: null,
        NOT: { layouts: { some: { isPublished: true, deletedAt: null } } },
      },
    });
    if (waiting) {
      console.log(`Lưu ý: ${waiting} bài của đơn vị này sẽ vào hàng chờ duyệt.`);
    }
  }
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  void prisma.$disconnect();
  process.exit(1);
});
