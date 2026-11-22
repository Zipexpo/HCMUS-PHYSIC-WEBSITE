/**
 * backfill-rank-change.ts — GHI BÙ nhật ký đổi ngạch cho lần đổi xảy ra TRƯỚC
 * khi có tính năng nhật ký (trước 22/11/2026).
 *
 * Từ nay mọi lần đổi ngạch qua trang quản trị đều tự ghi nhật ký (bắt buộc có
 * lý do + ngày hiệu lực). Những lần đổi TRƯỚC đó không có dấu vết nào — script
 * này để ghi bù, và chỉ ghi bù.
 *
 * KHÔNG đổi User.rank. Chỉ thêm dòng vào bảng RankChange. Ngạch hiện tại trong
 * DB coi như đã đúng; việc còn thiếu là cái dòng giải thích vì sao.
 *
 * Xem ai đang thiếu nhật ký (chỉ đọc, mặc định):
 *   docker compose -f docker-compose.sandbox.yml exec backend \
 *     node_modules/.bin/tsx initialScript/migrate-legacy/backfill-rank-change.ts --rank=KTV
 *
 * Ghi bù (phải có --apply, nếu không chỉ in ra xem trước):
 *   ... backfill-rank-change.ts --rank=KTV \
 *       --from-rank=CV --reason="Chuyển vị trí việc làm" --from=2026-11-20 --apply
 *
 * Tham số:
 *   --rank=KTV          nhắm mọi người đang có ngạch này
 *   --email=a@b.c       hoặc nhắm đúng một người (lặp lại được)
 *   --from-rank=CV      ngạch CŨ. Bỏ trống = để trống trong nhật ký (không biết)
 *   --reason="..."      BẮT BUỘC khi ghi. Vì sao đổi
 *   --from=YYYY-MM-DD   BẮT BUỘC khi ghi. Ngày ngạch mới có hiệu lực
 *   --by=admin@...      ai ra quyết định. Bỏ trống = để trống (ghi bù bằng máy)
 *   --force             ghi dù người đó đã có dòng nhật ký cùng ngạch đích
 *   --apply             thật sự ghi. Không có thì chỉ xem trước
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1);
};
const flagAll = (name: string): string[] =>
  argv
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(a.indexOf('=') + 1))
    .filter(Boolean);

const RANK = (flag('rank') ?? '').trim();
const EMAILS = flagAll('email');
const FROM_RANK = (flag('from-rank') ?? '').trim() || null;
const REASON = (flag('reason') ?? '').trim();
const FROM = (flag('from') ?? '').trim();
const BY = (flag('by') ?? '').trim();
const FORCE = argv.includes('--force');
const APPLY = argv.includes('--apply');

async function main(): Promise<void> {
  if (!RANK && !EMAILS.length) {
    console.error('Thiếu --rank=<MÃ> hoặc --email=<địa chỉ>. Xem hướng dẫn ở đầu file.');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const people = await prisma.user.findMany({
    where: EMAILS.length
      ? { email: { in: EMAILS } }
      : { rank: { equals: RANK, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      rank: true,
      department: { select: { name: true } },
      rankChanges: {
        select: { id: true, toRank: true, effectiveFrom: true, reason: true },
        orderBy: { effectiveFrom: 'desc' },
      },
    },
    orderBy: { email: 'asc' },
  });

  if (!people.length) {
    console.log(
      EMAILS.length
        ? `Không có tài khoản nào khớp: ${EMAILS.join(', ')}`
        : `Không có ai đang có ngạch "${RANK}".`,
    );
    await prisma.$disconnect();
    return;
  }

  console.log(`Tìm thấy ${people.length} người:\n`);
  const canDo: typeof people = [];
  for (const p of people) {
    const sameTarget = p.rankChanges.filter(
      (c) => (c.toRank ?? '').toLowerCase() === (p.rank ?? '').toLowerCase(),
    );
    const daCo = sameTarget.length > 0;
    const ten = `${p.lastName ?? ''} ${p.firstName ?? ''}`.trim() || '(chưa có tên)';
    console.log(`  ${ten} — ${p.email}`);
    console.log(
      `    ngạch hiện tại: ${p.rank ?? '(trống)'}` +
        `    đơn vị: ${p.department?.name ?? '(chưa gắn)'}`,
    );
    if (daCo) {
      for (const c of sameTarget) {
        console.log(
          `    ĐÃ CÓ nhật ký: ${c.effectiveFrom.toISOString().slice(0, 10)} ` +
            `-> ${c.toRank ?? '-'}  "${c.reason}"`,
        );
      }
    } else {
      console.log('    chưa có dòng nhật ký nào cho ngạch này');
    }
    console.log('');
    if (!daCo || FORCE) canDo.push(p);
  }

  if (!canDo.length) {
    console.log('Tất cả đã có nhật ký. Không cần ghi bù (dùng --force nếu vẫn muốn ghi).');
    await prisma.$disconnect();
    return;
  }

  // Thiếu lý do hay ngày hiệu lực thì DỪNG, y như trang quản trị chặn người dùng.
  if (!REASON || !FROM) {
    console.log(`${canDo.length} người cần ghi bù, nhưng còn thiếu:`);
    if (!REASON) console.log('  --reason="..."     lý do đổi ngạch');
    if (!FROM) console.log('  --from=YYYY-MM-DD  ngày ngạch mới có hiệu lực');
    console.log('\n(chưa ghi gì — đưa đủ hai tham số trên rồi chạy lại kèm --apply)');
    await prisma.$disconnect();
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM)) {
    console.error(`--from phải dạng YYYY-MM-DD, nhận được "${FROM}".`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  const effectiveFrom = new Date(`${FROM}T00:00:00.000Z`);
  if (Number.isNaN(effectiveFrom.getTime())) {
    console.error(`Ngày không hợp lệ: "${FROM}".`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  let changedBy: string | null = null;
  if (BY) {
    const actor = await prisma.user.findUnique({ where: { email: BY }, select: { id: true } });
    if (!actor) {
      console.error(`--by=${BY}: không có tài khoản nào email này.`);
      process.exitCode = 1;
      await prisma.$disconnect();
      return;
    }
    changedBy = actor.id;
  }

  console.log('Sẽ ghi:\n');
  console.log(`  lý do        : ${REASON}`);
  console.log(`  hiệu lực từ  : ${FROM}`);
  console.log(`  ngạch cũ     : ${FROM_RANK ?? '(để trống — không biết)'}`);
  console.log(`  người quyết  : ${BY || '(để trống — ghi bù bằng máy)'}`);
  console.log(`  số dòng      : ${canDo.length}\n`);

  if (!APPLY) {
    console.log('XEM TRƯỚC — chưa ghi gì. Thêm --apply để ghi thật.');
    await prisma.$disconnect();
    return;
  }

  for (const p of canDo) {
    await prisma.rankChange.create({
      data: {
        userId: p.id,
        fromRank: FROM_RANK,
        toRank: p.rank,
        reason: REASON,
        effectiveFrom,
        changedBy,
      },
    });
    console.log(`  đã ghi: ${p.email}  ${FROM_RANK ?? '-'} -> ${p.rank ?? '-'}`);
  }
  console.log(`\nXong. ${canDo.length} dòng nhật ký đã ghi bù.`);
  console.log('Kiểm lại: ... audit-ranks.ts');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
