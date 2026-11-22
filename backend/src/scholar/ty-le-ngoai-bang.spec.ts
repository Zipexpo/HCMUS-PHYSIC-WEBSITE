import { describe, expect, it, vi } from 'vitest';
import { ScholarService } from './scholar.service';
import { UpdatePublicationBodySchema } from './scholar.model';

/**
 * TỔNG TỶ LỆ CÁCH 1 & LỜI MỜI NGOÀI DANH SÁCH (22/11/2026).
 *
 * Ca thật, bài BWRX-300: người khai lưu mình 50% + một đồng tác giả 50% «đủ 100%»,
 * trong khi lời mời thứ ba (đã bị bớt khỏi bảng, trỏ ra hàng 4/3) còn giữ 20% →
 * tổng 120%. kiemTyLe chỉ cộng `memberUpdates` của lượt gửi; kiemSuaDanhSach chỉ
 * soát hàng ĐỔI.
 */

type Dong = {
  userId: string;
  claimStatus: 'CONFIRMED' | 'PENDING';
  authorIndex: number;
  isFirst: boolean;
  isCorresponding: boolean;
  isLast: boolean;
  sharePercent: number | null;
  user?: { firstName: string; lastName: string };
};

const SANG: Dong = {
  userId: 'sang',
  claimStatus: 'CONFIRMED',
  authorIndex: 2,
  isFirst: false,
  isCorresponding: false,
  isLast: true,
  sharePercent: 50,
  user: { firstName: 'Sang', lastName: 'Phan Lê Hoàng' },
};
const HIEN: Dong = {
  userId: 'hien',
  claimStatus: 'PENDING',
  authorIndex: 1,
  isFirst: false,
  isCorresponding: false,
  isLast: false,
  sharePercent: 50,
  user: { firstName: 'Hiền', lastName: 'Đoàn Thị' },
};
const THANH: Dong = {
  userId: 'thanh',
  claimStatus: 'PENDING',
  authorIndex: 3, // ngoài danh sách 3 tên
  isFirst: false,
  isCorresponding: false,
  isLast: true,
  sharePercent: 20,
  user: { firstName: 'Thanh', lastName: 'Trần Thiện' },
};

const RAW = [
  { name: 'Thái Phát' },
  { name: 'Đoàn Thị Hiền' },
  { name: 'Phan Lê Hoàng Sang' },
];

function dung(rows: Dong[]) {
  const prisma = {
    publicationAuthor: {
      findUnique: vi.fn().mockResolvedValue({
        claimStatus: 'CONFIRMED',
        sharePercent: 50,
        isFirst: false,
        isCorresponding: false,
        isLast: true,
      }),
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    publication: {
      findUnique: vi.fn().mockResolvedValue({
        publishedYear: 2026,
        acceptedYear: null,
        catalogCode: '2.4c',
        schoolAuthors: 3,
        totalAuthors: 3,
        externalMainAuthors: 1,
        authorsRaw: RAW,
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const svc = new ScholarService(
    prisma as never,
    {} as never,
    {} as never,
    { emit: vi.fn() } as never,
    {} as never,
  );
  const lo = svc as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(lo, 'findOne').mockResolvedValue({ id: 'p1' });
  vi.spyOn(lo, 'revalidateStaffPages').mockResolvedValue(undefined);
  vi.spyOn(lo, 'recount').mockResolvedValue(undefined);
  return { svc, prisma };
}

const luu = (o: Record<string, unknown>) =>
  UpdatePublicationBodySchema.parse(o);
const ME = {
  authorIndex: 2,
  isFirst: false,
  isCorresponding: false,
  isLast: true,
};

describe('Tổng tỷ lệ Cách 1 cộng cả người không nằm trong lượt gửi', () => {
  it('50% + 50% gửi lên, người thứ ba (không gửi) còn giữ 20% → chặn', async () => {
    // Thầy Thanh chưa chỉ hàng (−1) — tách riêng khỏi chốt «ngoài danh sách».
    const { svc, prisma } = dung([SANG, HIEN, { ...THANH, authorIndex: -1 }]);
    await expect(
      svc.update(
        'sang',
        'p1',
        luu({
          me: { ...ME, sharePercent: 50 },
          memberUpdates: [{ userId: 'hien', sharePercent: 50, authorIndex: 1 }],
        }),
      ),
    ).rejects.toThrow();
    expect(prisma.publication.update).not.toHaveBeenCalled();
  });

  it('rút lời mời người giữ 20% trong cùng lượt → cho lưu', async () => {
    const { svc } = dung([SANG, HIEN, { ...THANH, authorIndex: -1 }]);
    await expect(
      svc.update(
        'sang',
        'p1',
        luu({
          me: { ...ME, sharePercent: 50 },
          memberUpdates: [{ userId: 'hien', sharePercent: 50, authorIndex: 1 }],
          rutMoi: ['thanh'],
        }),
      ),
    ).resolves.toBeTruthy();
  });

  it('đồng tác giả có trong lượt nhưng KHÔNG gửi tỷ lệ → tính theo số đang lưu', async () => {
    const { svc } = dung([SANG, { ...HIEN, sharePercent: 60 }]);
    await expect(
      svc.update(
        'sang',
        'p1',
        luu({
          me: { ...ME, sharePercent: 50 },
          memberUpdates: [{ userId: 'hien', authorIndex: 1 }],
        }),
      ),
    ).rejects.toThrow();
  });

  it('hạ tỷ lệ của đồng tác giả trong cùng lượt → tính số mới, cho lưu', async () => {
    const { svc } = dung([SANG, { ...HIEN, sharePercent: 60 }]);
    await expect(
      svc.update(
        'sang',
        'p1',
        luu({
          me: { ...ME, sharePercent: 50 },
          memberUpdates: [{ userId: 'hien', sharePercent: 50, authorIndex: 1 }],
        }),
      ),
    ).resolves.toBeTruthy();
  });

  it('xác nhận lời mời: tác giả chính tự đặt 60% khi nhóm đã giữ 50% → chặn', async () => {
    const { svc, prisma } = dung([SANG]);
    prisma.publicationAuthor.findUnique.mockResolvedValue({
      claimStatus: 'PENDING',
      sharePercent: null,
    });
    await expect(
      svc.respondToClaim('thanh', 'p1', {
        accept: true,
        authorship: { authorIndex: 2, isLast: true, sharePercent: 60 },
      }),
    ).rejects.toThrow();
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });
});

describe('Lời mời trỏ ra ngoài danh sách tên', () => {
  it('lưu danh sách mới khi còn lời mời ở hàng 4/3 → chặn, nêu tên người đó', async () => {
    // Không tỷ lệ — để chỉ chốt «ngoài danh sách» lên tiếng.
    const { svc, prisma } = dung([
      { ...SANG, sharePercent: null },
      { ...HIEN, sharePercent: null },
      { ...THANH, sharePercent: null },
    ]);
    const loi = await svc
      .update(
        'sang',
        'p1',
        luu({
          authorsRaw: RAW,
          totalAuthors: 3,
          me: ME,
          memberUpdates: [{ userId: 'hien', authorIndex: 1 }],
        }),
      )
      .then(() => null)
      .catch((e: { getResponse?: () => unknown }) => e);
    expect(loi).not.toBeNull();
    const noiDung = JSON.stringify(loi?.getResponse?.());
    expect(noiDung).toContain('Trần Thiện Thanh');
    expect(noiDung).toContain('hàng 4');
    expect(prisma.publication.update).not.toHaveBeenCalled();
  });

  it('lượt KHÔNG gửi danh sách (ô «hiện trên trang») → không bị chặn vì dữ liệu cũ', async () => {
    const { svc } = dung([SANG, HIEN, { ...THANH, sharePercent: null }]);
    await expect(
      svc.update('sang', 'p1', luu({ me: { ...ME, showOnWeb: false } })),
    ).resolves.toBeTruthy();
  });
});
