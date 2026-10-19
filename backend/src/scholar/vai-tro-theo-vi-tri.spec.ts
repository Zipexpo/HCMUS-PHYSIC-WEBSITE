import { describe, expect, it, vi } from 'vitest';
import { UpdatePublicationBodySchema } from './scholar.model';
import { ScholarService, vaiTroTheoViTri } from './scholar.service';

/**
 * KHÔNG AI BỎ ĐƯỢC VAI TRÒ THEO VỊ TRÍ (Khoa chốt 4/10/2026). Ca thật: một đồng
 * tác giả bỏ cờ "tác giả cuối" của người đứng 4/4 trên hai bài và cờ "liên hệ"
 * (trang tạp chí ghi rõ) trên bài thứ ba; form ghi lại số tác giả chính ngoài hệ
 * thống = 0 → 455,6 giờ NCKH chuyển sang người sửa.
 */
describe('vaiTroTheoViTri', () => {
  it('hàng đầu là tác giả đầu, hàng cuối là tác giả cuối', () => {
    expect(vaiTroTheoViTri(0, 4)).toEqual({ isFirst: true, isLast: false });
    expect(vaiTroTheoViTri(3, 4)).toEqual({ isFirst: false, isLast: true });
    expect(vaiTroTheoViTri(1, 4)).toEqual({ isFirst: false, isLast: false });
  });
  it('bài một tác giả: là tác giả đầu; chưa chỉ hàng thì không ép gì', () => {
    expect(vaiTroTheoViTri(0, 1)).toEqual({ isFirst: true, isLast: false });
    expect(vaiTroTheoViTri(-1, 4)).toEqual({ isFirst: false, isLast: false });
    expect(vaiTroTheoViTri(null, 4)).toEqual({ isFirst: false, isLast: false });
  });
});

type Dong = {
  userId: string;
  claimStatus?: string;
  authorIndex: number;
  isFirst: boolean;
  isCorresponding: boolean;
  isLast: boolean;
};
const raw4 = [
  { name: 'Huong Tran Thi Mai', isNonSchool: false },
  { name: 'Tien Thanh Nguyen', isNonSchool: false },
  { name: 'Minh Thien Bui', isNonSchool: false },
  { name: 'Truong An Dang', isNonSchool: false },
];
const THANH: Dong = { userId: 'thanh', claimStatus: 'CONFIRMED', authorIndex: 1, isFirst: false, isCorresponding: false, isLast: false };
const AN: Dong = { userId: 'an', claimStatus: 'CONFIRMED', authorIndex: 3, isFirst: false, isCorresponding: true, isLast: true };

function dung(rows: Dong[], hienTai: Record<string, unknown> = {}) {
  const prisma = {
    publicationAuthor: {
      findUnique: vi.fn().mockResolvedValue({ claimStatus: 'CONFIRMED' }),
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    publication: {
      findUnique: vi.fn().mockResolvedValue({
        publishedYear: 2026,
        acceptedYear: null,
        catalogCode: '1.1d',
        schoolAuthors: 4,
        authorsRaw: raw4,
        totalAuthors: 4,
        externalMainAuthors: 1,
        ...hienTai,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ email: 'an@hcmus.edu.vn' }]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const bus = { emit: vi.fn() };
  const svc = new ScholarService(prisma as never, {} as never, {} as never, bus as never, {} as never);
  const lo = svc as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(lo, 'findOne').mockResolvedValue({ id: 'p1' });
  vi.spyOn(lo, 'revalidateStaffPages').mockResolvedValue(undefined);
  vi.spyOn(lo, 'recount').mockResolvedValue(undefined);
  vi.spyOn(lo, 'assertConfirmedAuthor').mockResolvedValue(undefined);
  vi.spyOn(lo, 'attachSelf').mockResolvedValue(undefined);
  return { svc, prisma, bus };
}

/** Thân PATCH như phys-profile gửi khi người sửa là `thanh` (hàng 2/4). */
const than = (o: Record<string, unknown> = {}) =>
  UpdatePublicationBodySchema.parse({
    mainAuthorAtSchool: true,
    me: { authorIndex: 1, isFirst: false, isCorresponding: false, isLast: false },
    externalAuthors: [{ name: 'Huong Tran Thi Mai', isFirst: true }, { name: 'Minh Thien Bui' }],
    ...o,
  });

const loiCua = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { getResponse: () => { message: Array<{ field: string; error: string }> } })
      .getResponse().message[0];
  }
  return null;
};

describe('ScholarService.update — chặn bỏ vai trò theo vị trí', () => {
  it('bỏ "tác giả cuối" của người đứng cuối → chặn, KHÔNG ghi gì', async () => {
    const { svc, prisma } = dung([THANH, AN]);
    const loi = await loiCua(
      svc.update('thanh', 'p1', than({ memberUpdates: [{ userId: 'an', isFirst: false, isCorresponding: true, isLast: false }] })),
    );
    expect(loi?.field).toBe('memberUpdates');
    expect(loi?.error).toContain('«Truong An Dang» đứng cuối danh sách tác giả (4/4)');
    expect(prisma.publication.update).not.toHaveBeenCalled();
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });

  it('tự bỏ "tác giả cuối" của chính mình khi vẫn đứng cuối → cũng chặn', async () => {
    const { svc, prisma } = dung([THANH, AN]);
    const loi = await loiCua(
      svc.update('an', 'p1', than({ me: { authorIndex: 3, isFirst: false, isCorresponding: true, isLast: false } })),
    );
    expect(loi?.field).toBe('memberUpdates');
    expect(prisma.publication.update).not.toHaveBeenCalled();
  });

  it('bỏ "tác giả đầu" của người ngoài hệ thống (số tác giả chính ngoài tụt) → chặn', async () => {
    const { svc, prisma } = dung([THANH, AN]);
    const loi = await loiCua(
      svc.update('thanh', 'p1', than({ externalAuthors: [{ name: 'Huong Tran Thi Mai' }, { name: 'Minh Thien Bui' }] })),
    );
    expect(loi?.error).toContain('«Huong Tran Thi Mai» đứng đầu danh sách tác giả');
    expect(prisma.publication.update).not.toHaveBeenCalled();
  });

  it('dữ liệu cũ đang THIẾU cờ: lưu lại không bị chặn (chỉ chặn việc bỏ)', async () => {
    const anThieu = { ...AN, isLast: false };
    const { svc, prisma } = dung([THANH, anThieu], { externalMainAuthors: 0 });
    await svc.update(
      'thanh',
      'p1',
      than({ memberUpdates: [{ userId: 'an', isLast: false }], externalAuthors: [{ name: 'Huong Tran Thi Mai' }, { name: 'Minh Thien Bui' }] }),
    );
    expect(prisma.publication.update).toHaveBeenCalledTimes(1);
  });

  it('vai trò giữa danh sách (liên hệ) vẫn sửa được — và người bị bỏ được báo tin', async () => {
    const { svc, prisma, bus } = dung([THANH, AN]);
    await svc.update(
      'thanh',
      'p1',
      than({ memberUpdates: [{ userId: 'an', isFirst: false, isCorresponding: false, isLast: true }] }),
    );
    expect(prisma.publicationAuthor.update).toHaveBeenCalledWith({
      where: { publicationId_userId: { publicationId: 'p1', userId: 'an' } },
      data: { isFirst: false, isCorresponding: false, isLast: true },
    });
    expect(bus.emit).toHaveBeenCalledWith('publication.role-removed', {
      id: 'p1',
      userIds: ['an'],
      emails: ['an@hcmus.edu.vn'],
      key: 'isCorresponding',
    });
  });

  it('form gửi mainAuthorAtSchool=false nhưng tác giả cuối thuộc Trường → vẫn ghi true', async () => {
    const { svc, prisma } = dung([THANH, AN]);
    await svc.update('thanh', 'p1', than({ mainAuthorAtSchool: false }));
    expect(prisma.publication.update.mock.calls[0][0].data.mainAuthorAtSchool).toBe(true);
  });

  it('bài chưa có danh sách tác giả lẫn tổng số → không xét gì (khỏi chặn nhầm bài khai tay)', async () => {
    const { svc, prisma } = dung([THANH, AN], { authorsRaw: [], totalAuthors: null });
    await svc.update('thanh', 'p1', than({ externalAuthors: [] }));
    expect(prisma.publication.update).toHaveBeenCalledTimes(1);
  });
});
