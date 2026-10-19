import { describe, expect, it, vi } from 'vitest';
import {
  CreatePublicationBodySchema,
  UpdatePublicationBodySchema,
} from './scholar.model';
import { ScholarService } from './scholar.service';

/**
 * CHỐT KHAI SAI + NHẬN DIỆN TÁC GIẢ (5/10/2026). Mỗi ca dưới đây ứng với một lỗi
 * đã gặp trên dữ liệu thật — tên giả, cấu trúc thật.
 */
const RAW4 = [
  { name: 'Thai Duong Phung' },
  { name: 'Kieu Tram Thi Huynh' },
  { name: 'Van Tuan Phan' },
  { name: 'Dang Minh An' },
];

type Stub = Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

function dung() {
  const prisma = {
    publication: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'moi' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    publicationAuthor: {
      findUnique: vi.fn().mockResolvedValue({ claimStatus: 'CONFIRMED' }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    scholarProfile: {
      findUnique: vi.fn().mockResolvedValue({
        orcid: null,
        nameVariants: [],
        user: { firstName: 'An', lastName: 'Đặng Minh' },
      }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as Stub;
  const bus = { emit: vi.fn() };
  const svc = new ScholarService(
    prisma as never,
    {} as never,
    {} as never,
    bus as never,
    {} as never,
  );
  const lo = svc as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(lo, 'findOne').mockResolvedValue({ id: 'xong' });
  vi.spyOn(lo, 'revalidateStaffPages').mockResolvedValue(undefined);
  vi.spyOn(lo, 'recount').mockResolvedValue(undefined);
  vi.spyOn(lo, 'assertConfirmedAuthor').mockResolvedValue(undefined);
  return { svc, prisma, bus };
}

/** Lỗi Nest dạng [{ field, error }] → phần tử đầu. */
async function loi(p: Promise<unknown>): Promise<{ field: string; error: string }> {
  try {
    await p;
  } catch (e) {
    return (e as { getResponse: () => { message: Array<{ field: string; error: string }> } }).getResponse().message[0];
  }
  throw new Error('Mong lỗi mà không lỗi');
}

const khai = (o: Record<string, unknown> = {}, work: Record<string, unknown> = {}) =>
  CreatePublicationBodySchema.parse({
    work: {
      doi: '10.1/abc',
      type: 'journal-article',
      title: 'Crop calendar adjustments for rainwater harvesting',
      publishedYear: 2026,
      publishedMonth: 3,
      authors: RAW4,
      source: 'crossref',
      ...work,
    },
    me: { authorIndex: 3, isLast: true },
    totalAuthors: 4,
    schoolAuthors: 1,
    ...o,
  });

describe('khai mới — danh sách tác giả nhất quán', () => {
  it('CA THẬT: T khác số hàng (form cũ xoá hàng) → chặn, bảo tải lại trang', async () => {
    const { svc } = dung();
    const e = await loi(svc.create('u-an', khai({ totalAuthors: 3, me: { authorIndex: 2, isLast: true } })));
    expect(e.field).toBe('totalAuthors');
    expect(e.error).toContain('tải lại trang');
  });

  it('Last Author ở hàng không phải cuối → chặn', async () => {
    const { svc } = dung();
    const e = await loi(svc.create('u-an', khai({ me: { authorIndex: 1, isLast: true } })));
    expect(e.field).toBe('isLast');
  });

  it('hai người cùng một hàng → chặn', async () => {
    const { svc } = dung();
    const e = await loi(
      svc.create('u-an', khai({ coAuthorUserIds: ['u2'], memberUpdates: [{ userId: 'u2', authorIndex: 3 }] })),
    );
    expect(e.field).toBe('authorIndex');
  });

  it('CA THẬT: khai tay MỘT tác giả phải tự xác nhận', async () => {
    const { svc, prisma } = dung();
    const tay = (o: Record<string, unknown>) =>
      khai({ totalAuthors: 1, me: { authorIndex: 0, isFirst: true }, ...o }, {
        doi: null,
        source: 'Khai tay',
        authors: [{ name: 'Dang Minh An' }],
      });
    expect((await loi(svc.create('u-an', tay({})))).field).toBe('motTacGia');
    await svc.create('u-an', tay({ motTacGia: true }));
    expect(prisma.publication.create).toHaveBeenCalledTimes(1);
  });

  it('lời mời mang luôn HÀNG người khai gắn cho đồng tác giả', async () => {
    const { svc, prisma } = dung();
    await svc.create(
      'u-an',
      khai({ coAuthorUserIds: ['u2'], memberUpdates: [{ userId: 'u2', authorIndex: 1, isCorresponding: true }] }),
    );
    expect(prisma.publicationAuthor.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: 'u2', authorIndex: 1, claimStatus: 'PENDING' }),
    ]);
  });
});

describe('khai mới — công trình cùng tên', () => {
  const cu = { id: 'cu', title: 'Crop Calendar Adjustments for Rainwater Harvesting', doi: null };
  function coBanCu() {
    const k = dung();
    k.prisma.publication.findMany.mockImplementation((args: { where?: { id?: unknown } }) =>
      Promise.resolve(
        args.where?.id
          ? [{ ...cu, containerTitle: null, publishedYear: 2025, acceptedYear: null, source: 'Khai tay', totalAuthors: 1, createdBy: 'u9', authors: [] }]
          : [cu],
      ),
    );
    return k;
  }

  it('CA THẬT: bài khai tay lại lần nữa → hỏi trước (409)', async () => {
    const { svc, prisma } = coBanCu();
    const e = await loi(svc.create('u-an', khai()));
    expect(e.field).toBe('work.title');
    expect(prisma.publication.create).not.toHaveBeenCalled();
  });

  it('người khai nói rõ là công trình KHÁC → cho lưu', async () => {
    const { svc, prisma } = coBanCu();
    await svc.create('u-an', khai({ khongTrung: true }));
    expect(prisma.publication.create).toHaveBeenCalledTimes(1);
  });

  it('gắn vào bài cũ: dò hàng của mình theo tên trên bài cũ', async () => {
    const { svc, prisma } = dung();
    prisma.publication.findFirst.mockResolvedValue({ id: 'cu', title: cu.title, authorsRaw: RAW4, catalogCode: null });
    await svc.create('u-an', khai({ ganVaoBai: 'cu', catalogCode: '1.1c', me: { authorIndex: 0, isFirst: true } }));
    expect(prisma.publication.create).not.toHaveBeenCalled();
    expect(prisma.publicationAuthor.upsert.mock.calls[0][0].create).toMatchObject({
      publicationId: 'cu',
      authorIndex: 3,
      isFirst: false,
      isLast: true,
      claimStatus: 'CONFIRMED',
    });
    expect(prisma.publication.update.mock.calls[0][0].data).toMatchObject({ catalogCode: '1.1c' });
  });

  it('gắn vào bài KHÁC tên → chặn', async () => {
    const { svc } = dung();
    const k = dung();
    k.prisma.publication.findFirst.mockResolvedValue({ id: 'x', title: 'Hoàn toàn khác', authorsRaw: [], catalogCode: null });
    expect((await loi(k.svc.create('u-an', khai({ ganVaoBai: 'x' })))).field).toBe('ganVaoBai');
    void svc;
  });
});

describe('sửa bài / xác nhận lời mời — hàng không trùng', () => {
  const sua = (o: Record<string, unknown>) => UpdatePublicationBodySchema.parse(o);
  function coBai() {
    const k = dung();
    k.prisma.publication.findUnique.mockResolvedValue({
      publishedYear: 2026,
      acceptedYear: null,
      catalogCode: '1.1c',
      schoolAuthors: 2,
      authorsRaw: RAW4,
      totalAuthors: 4,
      externalMainAuthors: 1,
    });
    k.prisma.publicationAuthor.findMany.mockResolvedValue([
      { userId: 'u-an', authorIndex: 3, isFirst: false, isLast: true, user: { firstName: 'An', lastName: 'Đặng Minh' } },
      { userId: 'u2', authorIndex: 2, isFirst: false, isLast: false, user: { firstName: 'Tuấn', lastName: 'Phan Văn' } },
    ]);
    return k;
  }

  it('dời đồng tác giả sang hàng người khác đang giữ → chặn', async () => {
    const { svc } = coBai();
    const e = await loi(svc.update('u-an', 'p1', sua({ memberUpdates: [{ userId: 'u2', authorIndex: 3 }] })));
    expect(e.field).toBe('authorIndex');
    expect(e.error).toContain('Đặng Minh An');
  });

  it('T khác danh sách gửi lên → chặn', async () => {
    const { svc } = coBai();
    const e = await loi(svc.update('u-an', 'p1', sua({ authorsRaw: RAW4, totalAuthors: 3 })));
    expect(e.field).toBe('totalAuthors');
  });

  it('xác nhận lời mời vào hàng đã có người → chặn, nói tên người giữ', async () => {
    const { svc, prisma } = dung();
    prisma.publicationAuthor.findUnique.mockResolvedValue({ claimStatus: 'PENDING' });
    prisma.publication.findUnique.mockResolvedValue({ authorsRaw: RAW4, totalAuthors: 4 });
    prisma.publicationAuthor.findFirst.mockResolvedValue({ user: { firstName: 'Tuấn', lastName: 'Phan Văn' } });
    const e = await loi(svc.respondToClaim('u-an', 'p1', { accept: true, authorship: { authorIndex: 2 } }));
    expect(e.error).toContain('Phan Văn Tuấn');
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });
});

describe('xác nhận lời mời — gợi ý hàng', () => {
  it('gợi ý hàng theo tên (chắc) + báo hàng đã có người nhận', async () => {
    const { svc, prisma } = dung();
    prisma.publicationAuthor.findMany
      .mockResolvedValueOnce([
        {
          authorIndex: -1,
          invitedBy: null,
          publication: { id: 'p1', title: 'T', containerTitle: null, countYear: 2026, doi: null, authorsRaw: RAW4 },
        },
      ])
      .mockResolvedValueOnce([
        { publicationId: 'p1', authorIndex: 2, user: { firstName: 'Tuấn', lastName: 'Phan Văn' } },
      ]);
    prisma.scholarProfile.findUnique.mockResolvedValue({
      orcid: null,
      nameVariants: [],
      user: { firstName: 'An', lastName: 'Đặng Minh' },
    });
    const [c] = await svc.pendingClaims('u-an');
    expect(c).toMatchObject({
      suggestedAuthorIndex: 3,
      goiYChac: true,
      tenCoTrenBai: true,
      danhSachThieu: false,
      hangDaNhan: [{ authorIndex: 2, displayName: 'Phan Văn Tuấn' }],
    });
  });

  it('CA THẬT: tên không có trên bài → cờ cảnh báo; danh sách ngắn hơn số tác giả → "có thể thiếu"', async () => {
    const { svc, prisma } = dung();
    prisma.publicationAuthor.findMany
      .mockResolvedValueOnce([
        {
          authorIndex: -1,
          invitedBy: 'u-thanh',
          publication: {
            id: 'p1', title: 'T', containerTitle: null, countYear: 2024, doi: null,
            authorsRaw: [{ name: 'Thi Huong Le' }, { name: 'Tran Thien Thanh' }],
            totalAuthors: 4,
          },
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.scholarProfile.findUnique.mockResolvedValue({ orcid: null, nameVariants: [], user: { firstName: 'Hiên', lastName: 'Lê Thị' } });
    const [c] = await svc.pendingClaims('u-hien');
    expect(c).toMatchObject({ tenCoTrenBai: false, danhSachThieu: true, suggestedAuthorIndex: -1 });
  });
});

describe('lời mời nghi nhầm — người trong cuộc tự quyết, Khoa không huỷ hộ', () => {
  it('Khoa KHÔNG có đường huỷ lời mời của người khác', () => {
    const { svc } = dung();
    expect((svc as unknown as Record<string, unknown>).soatHuyLoiMoi).toBeUndefined();
  });

  it('người lưu rút lời mời CHÍNH MÌNH đã gửi — chỉ dòng chờ do mình mời', async () => {
    const { svc, prisma, bus } = dung();
    prisma.publication.findUnique.mockResolvedValue({
      publishedYear: 2026, acceptedYear: null, catalogCode: '1.1c', schoolAuthors: 1,
      authorsRaw: RAW4, totalAuthors: 4, externalMainAuthors: 1,
    });
    prisma.publicationAuthor.findMany.mockImplementation((args: { where?: { invitedBy?: string } }) =>
      Promise.resolve(
        args.where?.invitedBy === 'u-an'
          ? [{ userId: 'u-hien', authorIndex: -1, isFirst: false, isCorresponding: false, isLast: false }]
          : [],
      ),
    );
    prisma.publicationAuthor.deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    await svc.update('u-an', 'p1', UpdatePublicationBodySchema.parse({ rutMoi: ['u-hien', 'u-khac'] }));
    const q = prisma.publicationAuthor.findMany.mock.calls.find(
      (c: Array<{ where?: { invitedBy?: string } }>) => c[0]?.where?.invitedBy,
    )?.[0];
    expect(q.where).toMatchObject({ publicationId: 'p1', claimStatus: 'PENDING', invitedBy: 'u-an' });
    expect(prisma.publicationAuthor.deleteMany.mock.calls[0][0].where).toMatchObject({
      userId: { in: ['u-hien'] },
      claimStatus: 'PENDING',
      invitedBy: 'u-an',
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'publication.withdraw-invite',
      changes: { invitedUserId: 'u-hien' },
    });
    expect(bus.emit).toHaveBeenCalledWith('publication.changed', { id: 'p1', userIds: ['u-an', 'u-hien'] });
  });
});

describe('soát của Khoa — gán hàng (không lấy đi quyền lợi của ai)', () => {

  it('gán hàng cho người đã xác nhận chưa chỉ hàng — chỉ khi khớp chắc', async () => {
    const { svc, prisma } = dung();
    prisma.publicationAuthor.findUnique.mockResolvedValue({ claimStatus: 'CONFIRMED', authorIndex: -1 });
    prisma.publication.findFirst.mockResolvedValue({ authorsRaw: RAW4 });
    const kq = await svc.soatGanHang('admin', { publicationId: 'p1', userId: 'u-an' });
    expect(kq.moTa).toContain('hàng 4');
    expect(prisma.publicationAuthor.update.mock.calls[0][0].data).toEqual({ authorIndex: 3 });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'publication.admin-assign-row' });
  });
});
