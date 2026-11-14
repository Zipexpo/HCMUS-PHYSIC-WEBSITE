/**
 * audit-dead-domain.ts — CHỈ ĐỌC. Dò mọi địa chỉ email dùng TÊN MIỀN ĐÃ CHẾT
 * trên toàn bộ trang.
 *
 * `hcmuns.edu.vn` (và `phys.hcmuns.edu.vn`) là tên miền cũ của Trường, không
 * còn nhận thư. Gửi vào đó là mất hút, không báo lỗi về.
 *
 * KHÁC audit-mailto-mismatch: script kia so CHỮ HIỂN THỊ với HREF, nên chỉ thấy
 * khi hai bên lệch nhau. Nếu cả hai cùng ghi tên miền chết thì nó không thấy gì.
 * Script này dò thẳng theo tên miền nên bắt được cả loại đó.
 *
 * Với mỗi địa chỉ chết, script dò xem phần trước @ có xuất hiện cùng tên miền
 * SỐNG ở đâu đó không — nếu có thì đã biết chắc địa chỉ đúng, khỏi phải đoán.
 *
 * Dùng:
 *   ... audit-dead-domain.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const DEAD = /[\w.+-]+@[\w.-]*hcmuns\.edu\.vn/gi;
const LIVE_DOMAIN = 'hcmus.edu.vn';

/** Gom mọi chuỗi trong cây Puck thành một khối chữ để dò. */
function flatten(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) flatten(v, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) flatten(v, out);
  }
}

async function main(): Promise<void> {
  const pages = await prisma.pageLayout.findMany({
    where: { deletedAt: null },
    select: { slug: true, isPublished: true, puckData: true, publishedPuckData: true },
    orderBy: { slug: 'asc' },
  });

  // địa chỉ chết -> các trang chứa nó
  const byAddr = new Map<string, Set<string>>();
  // phần trước @ -> địa chỉ SỐNG đã thấy ở đâu đó (để biết đúng là gì)
  const liveLocal = new Map<string, string>();

  for (const p of pages) {
    const chunks: string[] = [];
    flatten(p.publishedPuckData ?? p.puckData, chunks);
    const text = chunks.join('\n');

    for (const m of text.matchAll(DEAD)) {
      const addr = m[0].toLowerCase();
      if (!byAddr.has(addr)) byAddr.set(addr, new Set());
      byAddr.get(addr)!.add(p.slug);
    }
    for (const m of text.matchAll(/([\w.+-]+)@hcmus\.edu\.vn/gi)) {
      liveLocal.set(m[1].toLowerCase(), `${m[1].toLowerCase()}@${LIVE_DOMAIN}`);
    }
  }

  if (!byAddr.size) {
    console.log('Không còn địa chỉ nào dùng tên miền chết.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Quét ${pages.length} trang.\n`);
  console.log(`${'địa chỉ CHẾT'.padEnd(34)} ${'trang'.padStart(5)}  địa chỉ đúng (nếu suy được)`);
  console.log('-'.repeat(86));

  const sure: string[] = [];
  const unsure: string[] = [];

  for (const [addr, slugs] of [...byAddr.entries()].sort()) {
    const local = addr.split('@')[0];
    const guess = liveLocal.get(local);
    console.log(
      `${addr.padEnd(34)} ${String(slugs.size).padStart(5)}  ${guess ?? '(KHÔNG suy được — phải hỏi)'}`,
    );
    (guess ? sure : unsure).push(addr);
  }

  console.log('\n── chi tiết trang ' + '─'.repeat(45));
  for (const [addr, slugs] of [...byAddr.entries()].sort()) {
    console.log(`  ${addr}`);
    for (const s of [...slugs].sort()) console.log(`     - ${s}`);
  }

  console.log('\n' + '='.repeat(86));
  console.log(`Tổng: ${byAddr.size} địa chỉ chết.`);
  console.log(`  suy được địa chỉ đúng : ${sure.length}`);
  console.log(`  phải hỏi người ta     : ${unsure.length}${unsure.length ? '  -> ' + unsure.join(', ') : ''}`);
  console.log('(chỉ đọc — script này không ghi gì)');
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
