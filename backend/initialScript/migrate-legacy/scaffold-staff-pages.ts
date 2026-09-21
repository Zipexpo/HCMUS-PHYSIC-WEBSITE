/**
 * scaffold-staff-pages.ts — dựng SẴN trang nhân sự cá nhân cho những cán bộ đã có
 * tài khoản + đơn vị nhưng CHƯA có trang (nên chưa lên danh sách "Đội ngũ").
 *
 * Vì sao cần: danh sách công khai chỉ gom người từ trang `{bộ-môn}/nhan-su/…`;
 * "Tạo cán bộ" chỉ tạo tài khoản. Người mới (vd Ngô Huỳnh Du – Văn phòng Khoa) có
 * ở ACADsoom mà mất trên trang nhân sự cho tới khi có trang. Từ nay backend tự
 * dựng khi tạo/gán đơn vị; script này vá số đang thiếu.
 *
 * Dùng CHUNG đúng StaffPageService.ensureStaffPage() với backend — không nhân đôi
 * logic. Idempotent: ai đã nối trang còn sống thì bỏ qua.
 *
 * Chạy (mặc định XEM TRƯỚC, không ghi):
 *   pnpm --filter backend exec tsx initialScript/migrate-legacy/scaffold-staff-pages.ts
 * Ghi thật:
 *   pnpm --filter backend exec tsx initialScript/migrate-legacy/scaffold-staff-pages.ts --apply
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createClient } from '@redis/client';
import { PrismaClient } from '../../src/generated/prisma/client';
import { StaffPageService } from '../../src/scholar/staff-page.service';

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({ connectionString: process.env.DATABASE_URL }),
  ),
});

// Cache/revalidate/bus KHÔNG dùng tới khi ghi từ script: afterWrite gọi chúng
// nhưng ta dọn cache Redis một lần ở cuối, và ISR/redeploy lo phần còn lại.
const noop = async () => {};
const svc = new StaffPageService(
  prisma as never,
  { get: noop, set: noop, clear: noop } as never,
  { trigger: () => {} } as never,
  { emit: () => {} } as never,
);

const APPLY = process.argv.includes('--apply');

/** Dọn cache đọc trang + cache danh sách đội ngũ để trang công khai cập nhật. */
async function clearStaffCaches() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('REDIS_URL chưa đặt — bỏ qua dọn cache.');
    return;
  }
  const client = createClient({ url });
  client.on('error', () => {});
  await client.connect();
  try {
    const del: string[] = [];
    for (const pattern of ['*page-layouts*', '*dept-staff*']) {
      for await (const key of client.scanIterator({
        MATCH: pattern,
        COUNT: 500,
      })) {
        for (const k of Array.isArray(key) ? key : [key]) del.push(k);
      }
    }
    if (del.length) await client.del(del);
    console.log(`Đã dọn ${del.length} khoá cache.`);
  } finally {
    await client.destroy();
  }
}

async function main() {
  const users = await prisma.user.findMany({
    where: { role: 'LECTURER', departmentId: { not: null } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      department: { select: { slug: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(
    `${APPLY ? 'GHI THẬT' : 'XEM TRƯỚC (thêm --apply để ghi)'} — soát ${users.length} cán bộ.\n`,
  );

  const tally: Record<string, number> = {};
  const done: string[] = [];
  for (const u of users) {
    const ten = [u.lastName, u.firstName].filter(Boolean).join(' ').trim();
    const r = await svc.ensureStaffPage(u.id, { dryRun: !APPLY });
    tally[r.reason] = (tally[r.reason] ?? 0) + 1;
    if (r.reason === 'da-tao' || r.reason === 'se-tao') {
      done.push(
        `  ${APPLY ? '✓ đã tạo' : '→ sẽ tạo'}: ${ten} (${u.department?.slug}) → ${r.slug}`,
      );
    }
  }

  if (done.length) {
    console.log(done.join('\n'));
    console.log('');
  }
  console.log('Tổng kết theo lý do:');
  for (const [reason, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${n}`);
  }

  if (APPLY && (tally['da-tao'] ?? 0) > 0) {
    console.log('');
    await clearStaffCaches();
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
