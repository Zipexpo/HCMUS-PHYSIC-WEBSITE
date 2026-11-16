/**
 * audit-roles.ts — CHỈ ĐỌC. Ai vào được trang quản trị, ai không?
 *
 * AuthGuard của trang quản trị chỉ cho vai trò ADMIN và SUPER_ADMIN; vai trò
 * khác (LECTURER) sẽ bị ĐÁ VỀ /login ngay sau khi đăng nhập thành công — nhìn
 * y như "đăng nhập không được", dù mật khẩu đúng.
 *
 * Dùng:
 *   ... audit-roles.ts                 # tổng quan + tài khoản của đơn vị
 *   ... audit-roles.ts <email>         # xem một tài khoản cụ thể
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const EMAIL = process.argv.slice(2).find((a) => !a.startsWith('--'));
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

async function main(): Promise<void> {
  if (EMAIL) {
    const u = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: {
        email: true, role: true, isActive: true, lastLoginAt: true,
        department: { select: { name: true, kind: true } },
      },
    });
    if (!u) {
      console.log(`Không có tài khoản nào email = ${EMAIL}`);
    } else {
      const ok = ADMIN_ROLES.includes(u.role);
      console.log(`  email      : ${u.email}`);
      console.log(`  vai trò    : ${u.role}`);
      console.log(`  hoạt động  : ${u.isActive ? 'có' : 'ĐÃ VÔ HIỆU'}`);
      console.log(`  đơn vị     : ${u.department?.name ?? '(chưa gắn)'}`);
      console.log(`  đăng nhập  : ${u.lastLoginAt?.toISOString().slice(0, 16) ?? '(chưa bao giờ)'}`);
      console.log(
        `  => vào được trang quản trị: ${ok && u.isActive ? 'CÓ' : 'KHÔNG'}` +
          (!ok ? '  (vai trò không phải ADMIN/SUPER_ADMIN -> bị đá về /login)' : '') +
          (!u.isActive ? '  (tài khoản đã vô hiệu)' : ''),
      );
    }
    await prisma.$disconnect();
    return;
  }

  const groups = await prisma.user.groupBy({ by: ['role'], _count: true });
  console.log('Tổng số tài khoản theo vai trò:');
  for (const g of groups) {
    const mark = ADMIN_ROLES.includes(g.role) ? 'vào được ' : 'KHÔNG vào';
    console.log(`  ${g.role.padEnd(14)} ${String(g._count).padStart(4)}   ${mark} trang quản trị`);
  }

  const units = await prisma.user.findMany({
    where: { department: { kind: 'unit' } },
    select: {
      email: true, role: true, isActive: true, lastLoginAt: true,
      department: { select: { name: true } },
    },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
  });
  console.log(`\nTài khoản thuộc ĐƠN VỊ (${units.length}):`);
  for (const u of units) {
    const bad = !ADMIN_ROLES.includes(u.role);
    console.log(
      `  ${bad ? '!!' : '  '} ${u.email.padEnd(32)} ${u.role.padEnd(13)}` +
        `${u.isActive ? '' : '[vô hiệu] '}${u.department?.name ?? ''}`,
    );
  }

  // Người từng đăng nhập mà vai trò không vào được quản trị — nhóm dễ than
  // "đăng nhập xong bị đá ra" nhất.
  const bounced = await prisma.user.findMany({
    where: { role: { notIn: ADMIN_ROLES as never }, lastLoginAt: { not: null } },
    select: { email: true, role: true, lastLoginAt: true },
    orderBy: { lastLoginAt: 'desc' },
    take: 15,
  });
  console.log(`\nĐÃ từng đăng nhập nhưng vai trò KHÔNG vào được quản trị (${bounced.length} gần nhất):`);
  if (!bounced.length) console.log('  (không có)');
  for (const u of bounced) {
    console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(12)} ${u.lastLoginAt?.toISOString().slice(0, 16)}`);
  }

  console.log('\n(chỉ đọc — script này không ghi gì)');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
