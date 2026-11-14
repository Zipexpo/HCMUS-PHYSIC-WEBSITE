/**
 * delete-user.ts — xoá VĨNH VIỄN một tài khoản. Không có thùng rác.
 *
 * CHỈ dùng cho tài khoản TRÙNG đã được gộp sạch. Quan hệ trong schema là
 * onDelete: Cascade, nên xoá tài khoản sẽ kéo theo bài viết, bố cục trang, ảnh,
 * bình luận, hồ sơ khoa học, công bố, đề tài… của người đó.
 *
 * RÀO CHẮN: script TỰ ĐẾM lại trước khi xoá. Còn bất kỳ nội dung nào thì TỪ
 * CHỐI xoá và bảo chuyển chủ sở hữu trước (merge-user-accounts.ts). Không có
 * cờ nào ép qua được — muốn xoá tài khoản còn dữ liệu thì phải dọn dữ liệu đã.
 *
 * Hồ sơ khoa học RỖNG thì cho xoá theo, vì nó không có nội dung gì để mất; hồ
 * sơ CÓ khai (biến thể tên / quá trình đào tạo / mã định danh) thì chặn, vì đó
 * là thứ chính người ta tự nhập bên phys-profile.
 *
 * Xem trước (mặc định, không xoá gì):
 *   ... delete-user.ts --email=abc@x.vn
 * Xoá thật:
 *   ... delete-user.ts --email=abc@x.vn --apply
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
const EMAIL = arg('email');
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  if (!EMAIL) {
    console.error('Dùng: delete-user.ts --email=<email> [--apply]');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const u = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      department: { select: { name: true } },
    },
  });
  if (!u) {
    console.error(`Không có tài khoản nào email = ${EMAIL}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  console.log('SẼ XOÁ VĨNH VIỄN tài khoản:');
  console.log(`  email     : ${u.email}`);
  console.log(`  id        : ${u.id}`);
  console.log(`  tên       : ${`${u.lastName ?? ''} ${u.firstName ?? ''}`.trim() || '(trống)'}`);
  console.log(`  vai trò   : ${u.role}   ${u.isActive ? 'đang dùng' : 'đã vô hiệu'}`);
  console.log(`  đơn vị    : ${u.department?.name ?? '(chưa gắn)'}`);
  console.log(`  đăng nhập : ${u.lastLoginAt?.toISOString().slice(0, 16) ?? '(chưa bao giờ)'}`);

  const id = u.id;
  const counts: Array<[string, number]> = [
    ['Bài viết', await prisma.post.count({ where: { createdBy: id } })],
    ['Bố cục trang', await prisma.pageLayout.count({ where: { createdBy: id } })],
    ['Tệp/ảnh', await prisma.media.count({ where: { createdBy: id } })],
    ['Mẫu (Template)', await prisma.template.count({ where: { createdBy: id } })],
    ['FAQ', await prisma.fAQ.count({ where: { createdBy: id } })],
    ['Bình luận', await prisma.postComment.count({ where: { userId: id } })],
    ['Tác giả công bố', await prisma.publicationAuthor.count({ where: { userId: id } })],
    ['Thành viên đề tài', await prisma.projectMember.count({ where: { userId: id } })],
  ];

  console.log('\n  --- nội dung đang giữ ---');
  let blocking = 0;
  for (const [label, n] of counts) {
    if (n) blocking += n;
    console.log(`  ${n ? '!!' : '  '} ${label.padEnd(20)} ${n}`);
  }

  // Hồ sơ khoa học: rỗng thì cho xoá theo, có khai thì chặn.
  const prof = await prisma.scholarProfile.findUnique({
    where: { userId: id },
    include: {
      nameVariants: { select: { id: true } },
      education: { select: { id: true } },
    },
  });
  let profBlocks = false;
  if (prof) {
    const declared =
      prof.nameVariants.length +
      prof.education.length +
      [prof.orcid, prof.scopusAuthorId, prof.researcherId, prof.googleScholarId,
       prof.researchGateUrl, prof.staffPageSlug, prof.homeInstitution,
       prof.affiliationType, prof.gradStudyLevel]
        .filter((v) => v !== null && v !== undefined && v !== '').length;
    profBlocks = declared > 0;
    console.log('\n  --- hồ sơ khoa học ---');
    console.log(`  ${profBlocks ? '!!' : '  '} số mục đã khai     ${declared}`);
    console.log(`     biến thể tên       ${prof.nameVariants.length}`);
    console.log(`     quá trình đào tạo  ${prof.education.length}`);
    console.log(`     trang nhân sự gắn  ${prof.staffPageSlug ?? '(chưa gắn)'}`);
  } else {
    console.log('\n  --- hồ sơ khoa học: không có ---');
  }

  if (blocking || profBlocks) {
    console.log('\nTỪ CHỐI XOÁ — tài khoản này còn dữ liệu.');
    console.log('Chuyển chủ sở hữu trước bằng merge-user-accounts.ts rồi chạy lại.');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  console.log('\n  => Tài khoản RỖNG, xoá sẽ không mất nội dung nào.');
  if (prof) console.log('     (hồ sơ khoa học rỗng sẽ bị xoá theo)');

  if (!APPLY) {
    console.log('\n(XEM TRƯỚC — chưa xoá gì. Thêm --apply để xoá thật. KHÔNG hoàn lại được.)');
    await prisma.$disconnect();
    return;
  }

  await prisma.user.delete({ where: { id } });
  console.log(`\nĐÃ XOÁ VĨNH VIỄN ${u.email}.`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
