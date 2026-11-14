/**
 * compare-user-profiles.ts — CHỈ ĐỌC. So hai tài khoản cạnh nhau, từng trường.
 *
 * Dùng trước khi gộp tài khoản trùng: cho thấy bên nào đang khai gì, trường nào
 * lệch nhau, trường nào chỉ một bên có. Mục đích là KHÔNG ghi đè nhầm phần do
 * chính người đó tự khai bên phys-profile.
 *
 * Quy ước cột "chuyển?":
 *   ->   chỉ bên TRÁI có    → nên chuyển sang phải
 *   KHÁC hai bên khác nhau  → phải xem tay, đừng tự động
 *   (giữ) bên phải đã có    → giữ nguyên bên phải
 *
 * Dùng:
 *   ... compare-user-profiles.ts <email-cũ> <email-giữ-lại>
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const [OLD, KEEP] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const USER_FIELDS = [
  'firstName', 'lastName', 'avatarUrl', 'phone', 'position', 'bio',
  'departmentId', 'physoomId', 'teacherId', 'degree', 'rank',
  'positionKey', 'employmentType', 'googleId', 'role', 'isActive',
] as const;

const PROFILE_FIELDS = [
  'orcid', 'scopusAuthorId', 'researcherId', 'googleScholarId',
  'researchGateUrl', 'staffPageSlug', 'showOnWeb', 'lastOrcidSyncAt',
  'affiliationType', 'homeInstitution', 'gradStudyLevel', 'gradStudyField',
  'gradStudyInstitution', 'gradStudyCountry', 'gradStudyStartYear',
  'gradStudyEndYear', 'gradStudyFullTime', 'gradStudyNote',
] as const;

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 16);
  return String(v);
};

function table(
  title: string,
  fields: readonly string[],
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
  if (!a && !b) { console.log('   (cả hai bên đều không có)'); return; }
  console.log(`   ${'trường'.padEnd(22)} ${'CŨ'.padEnd(26)} ${'GIỮ LẠI'.padEnd(26)} chuyển?`);
  for (const f of fields) {
    const va = show(a?.[f]);
    const vb = show(b?.[f]);
    if (!va && !vb) continue;            // cả hai trống → không cần in
    let flag = '';
    if (va && !vb) flag = '->';
    else if (va && vb && va !== vb) flag = 'KHÁC';
    else if (vb) flag = '(giữ)';
    console.log(`   ${f.padEnd(22)} ${va.slice(0, 25).padEnd(26)} ${vb.slice(0, 25).padEnd(26)} ${flag}`);
  }
}

async function load(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const profile = await prisma.scholarProfile.findUnique({
    where: { userId: user.id },
    include: {
      nameVariants: { select: { id: true } },
      education: { select: { id: true } },
    },
  });
  return { user, profile };
}

async function main(): Promise<void> {
  if (!OLD || !KEEP) {
    console.error('Dùng: compare-user-profiles.ts <email-cũ> <email-giữ-lại>');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  const a = await load(OLD);
  const b = await load(KEEP);
  console.log(`CŨ      : ${OLD}  ${a ? '' : '(KHÔNG CÓ)'}`);
  console.log(`GIỮ LẠI : ${KEEP}  ${b ? '' : '(KHÔNG CÓ)'}`);
  if (!a || !b) { await prisma.$disconnect(); return; }

  table('Tài khoản (User)', USER_FIELDS, a.user as never, b.user as never);
  table('Hồ sơ khoa học (ScholarProfile)', PROFILE_FIELDS,
        a.profile as never, b.profile as never);

  console.log('\n── Dữ liệu con của hồ sơ ' + '─'.repeat(32));
  console.log(`   ${'mục'.padEnd(22)} ${'CŨ'.padEnd(10)} GIỮ LẠI`);
  console.log(`   ${'biến thể tên'.padEnd(22)} ${String(a.profile?.nameVariants.length ?? 0).padEnd(10)} ${b.profile?.nameVariants.length ?? 0}`);
  console.log(`   ${'quá trình đào tạo'.padEnd(22)} ${String(a.profile?.education.length ?? 0).padEnd(10)} ${b.profile?.education.length ?? 0}`);

  console.log('\n(chỉ đọc — script này không ghi gì)');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
