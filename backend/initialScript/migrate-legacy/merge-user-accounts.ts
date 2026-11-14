/**
 * merge-user-accounts.ts — gộp một tài khoản TRÙNG (do di trú sinh ra) vào tài
 * khoản THẬT mà người đó đang dùng.
 *
 * NGUYÊN TẮC AN TOÀN:
 *  1. CHỈ ĐIỀN VÀO Ô TRỐNG bên giữ lại. Không bao giờ ghi đè giá trị đã có —
 *     bên giữ lại có thể là thứ chính người đó tự khai bên phys-profile.
 *  2. KHÔNG đụng nameVariants / education / affiliationType của hồ sơ giữ lại.
 *  3. Chuyển CHỦ SỞ HỮU nội dung (bài, trang, ảnh…) sang tài khoản giữ lại, để
 *     sau này xoá tài khoản cũ không kéo theo dữ liệu (quan hệ là Cascade).
 *  4. Họ tên chỉ đổi khi được truyền vào rõ ràng — hai bên thường đều sai, đoán
 *     bừa còn tệ hơn để nguyên.
 *  5. Ghi thật chạy trong MỘT giao dịch: hỏng giữa chừng thì không để lại trạng
 *     thái nửa vời.
 *
 * Chạy thử (mặc định):
 *   ... merge-user-accounts.ts --from=cu@x.vn --to=that@x.vn
 * Ghi thật:
 *   ... merge-user-accounts.ts --from=... --to=... --last-name=... --first-name=... --apply
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const arg = (n: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : null;
};
const FROM = arg('from');
const TO = arg('to');
const LAST = arg('last-name');
const FIRST = arg('first-name');
const APPLY = process.argv.includes('--apply');

/** Trường của User được phép mang sang — chỉ khi bên giữ lại đang trống. */
const USER_CARRY = [
  'departmentId',
  'teacherId',
  'degree',
  'rank',
  'positionKey',
  'employmentType',
  'phone',
  'position',
  'bio',
  'physoomId',
] as const;

/** Trường của hồ sơ khoa học được phép mang sang — cũng chỉ khi đang trống. */
const PROFILE_CARRY = [
  'staffPageSlug',
  'orcid',
  'scopusAuthorId',
  'researcherId',
  'googleScholarId',
  'researchGateUrl',
  'homeInstitution',
] as const;

const empty = (v: unknown): boolean => v === null || v === undefined || v === '';

async function main(): Promise<void> {
  if (!FROM || !TO) {
    console.error(
      'Dùng: --from=<email cũ> --to=<email giữ lại> [--last-name=] [--first-name=] [--apply]',
    );
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (FROM === TO) {
    console.error('Hai email giống nhau — dừng.');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const from = await prisma.user.findUnique({ where: { email: FROM } });
  const to = await prisma.user.findUnique({ where: { email: TO } });
  if (!from || !to) {
    console.error(`Không tìm thấy: ${!from ? FROM : ''} ${!to ? TO : ''}`.trim());
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const fromProf = await prisma.scholarProfile.findUnique({
    where: { userId: from.id },
  });
  const toProf = await prisma.scholarProfile.findUnique({
    where: { userId: to.id },
  });

  console.log(`CŨ      : ${FROM}  (${from.id})`);
  console.log(`GIỮ LẠI : ${TO}  (${to.id})\n`);

  // ── 1. Trường của tài khoản ──────────────────────────────────────────────
  const userData: Record<string, unknown> = {};
  console.log(`── Tài khoản ${'─'.repeat(50)}`);
  for (const f of USER_CARRY) {
    const a = (from as Record<string, unknown>)[f];
    const b = (to as Record<string, unknown>)[f];
    if (empty(a)) continue;
    if (!empty(b)) {
      console.log(`   ${f.padEnd(16)} giữ nguyên bên mới (${String(b)})`);
      continue;
    }
    userData[f] = a;
    console.log(`   ${f.padEnd(16)} ${String(a)}  -> chép sang`);
  }
  if (LAST || FIRST) {
    const beforeName = `${to.lastName ?? ''} ${to.firstName ?? ''}`.trim();
    const afterName = `${LAST ?? to.lastName ?? ''} ${FIRST ?? to.firstName ?? ''}`.trim();
    if (LAST) userData.lastName = LAST;
    if (FIRST) userData.firstName = FIRST;
    console.log(`   ${'họ tên'.padEnd(16)} "${beforeName}"  ->  "${afterName}"`);
  } else {
    console.log(
      `   ${'họ tên'.padEnd(16)} không đổi (không truyền --last-name/--first-name)`,
    );
  }
  if (!Object.keys(userData).length) console.log('   (không có gì để chép)');

  // ── 2. Hồ sơ khoa học ────────────────────────────────────────────────────
  const profData: Record<string, unknown> = {};
  console.log(`\n── Hồ sơ khoa học ${'─'.repeat(45)}`);
  if (!fromProf) {
    console.log('   bên cũ không có hồ sơ — bỏ qua');
  } else if (!toProf) {
    console.log(
      '   BÊN GIỮ LẠI CHƯA CÓ HỒ SƠ — script này không tạo mới, dừng cho an toàn.',
    );
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  } else {
    for (const f of PROFILE_CARRY) {
      const a = (fromProf as Record<string, unknown>)[f];
      const b = (toProf as Record<string, unknown>)[f];
      if (empty(a)) continue;
      if (!empty(b)) {
        console.log(`   ${f.padEnd(18)} giữ nguyên bên mới (${String(b)})`);
        continue;
      }
      profData[f] = a;
      console.log(`   ${f.padEnd(18)} ${String(a)}  -> chép sang`);
    }
    if (!Object.keys(profData).length) console.log('   (không có gì để chép)');
    console.log(
      '   KHÔNG đụng: nameVariants, education, affiliationType, showOnWeb',
    );
  }

  // ── 3. Chuyển chủ sở hữu nội dung ────────────────────────────────────────
  console.log(`\n── Chủ sở hữu nội dung ${'─'.repeat(40)}`);
  const owned = {
    post: await prisma.post.count({ where: { createdBy: from.id } }),
    pageLayout: await prisma.pageLayout.count({ where: { createdBy: from.id } }),
    media: await prisma.media.count({ where: { createdBy: from.id } }),
    template: await prisma.template.count({ where: { createdBy: from.id } }),
    faq: await prisma.fAQ.count({ where: { createdBy: from.id } }),
  };
  for (const [k, n] of Object.entries(owned)) {
    console.log(
      `   ${k.padEnd(16)} ${n}${n ? '  -> chuyển sang tài khoản giữ lại' : ''}`,
    );
  }

  if (!APPLY) {
    console.log('\n(CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.)');
    await prisma.$disconnect();
    return;
  }

  // Một giao dịch: hoặc xong hết, hoặc không đổi gì.
  await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id: to.id }, data: userData });
    }
    if (Object.keys(profData).length && toProf) {
      await tx.scholarProfile.update({
        where: { id: toProf.id },
        data: profData,
      });
    }
    // Gỡ slug khỏi hồ sơ cũ: hai hồ sơ cùng trỏ một trang sẽ làm danh sách nhân
    // sự tra nhầm hồ sơ (nó tra theo staffPageSlug).
    if (fromProf && profData.staffPageSlug) {
      await tx.scholarProfile.update({
        where: { id: fromProf.id },
        data: { staffPageSlug: null },
      });
    }
    if (owned.post) {
      await tx.post.updateMany({
        where: { createdBy: from.id },
        data: { createdBy: to.id },
      });
    }
    if (owned.pageLayout) {
      await tx.pageLayout.updateMany({
        where: { createdBy: from.id },
        data: { createdBy: to.id },
      });
    }
    if (owned.media) {
      await tx.media.updateMany({
        where: { createdBy: from.id },
        data: { createdBy: to.id },
      });
    }
    if (owned.template) {
      await tx.template.updateMany({
        where: { createdBy: from.id },
        data: { createdBy: to.id },
      });
    }
    if (owned.faq) {
      await tx.fAQ.updateMany({
        where: { createdBy: from.id },
        data: { createdBy: to.id },
      });
    }
  });

  console.log('\nĐÃ GỘP XONG.');
  console.log(
    'Tài khoản cũ giữ nguyên (vẫn vô hiệu hoá) — kiểm lại rồi hãy tính chuyện xoá.',
  );
  console.log('Danh sách nhân sự có cache 5 phút.');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
