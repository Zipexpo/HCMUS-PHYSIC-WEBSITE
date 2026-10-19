import { describe, expect, it, vi } from 'vitest';
import { ScholarService } from './scholar.service';
import {
  CreatePublicationBodySchema,
  UpdatePublicationBodySchema,
} from './scholar.model';

/**
 * Vai trò của ĐỒNG TÁC GIẢ trong Khoa — báo thật 2/10/2026: bài Radiation Physics
 * and Chemistry 114162 có HAI người cùng gắn "Corresponding" (OpenAlex chỉ ghi
 * N.D. Thông). Bỏ tick của người kia rồi lưu, mở lại vẫn thấy tick: phys-profile
 * gửi `memberUpdates` nhưng cả hai schema không có trường này nên Zod lặng lẽ bỏ.
 */

type Row = {
  userId: string;
  claimStatus: 'CONFIRMED' | 'PENDING';
  isFirst: boolean;
  isCorresponding: boolean;
  isLast: boolean;
  sharePercent?: number | null;
};

const THONG: Row = {
  userId: 'thong',
  claimStatus: 'CONFIRMED',
  isFirst: true,
  isCorresponding: true,
  isLast: false,
};
const TAI: Row = {
  userId: 'tai',
  claimStatus: 'CONFIRMED',
  isFirst: false,
  isCorresponding: true,
  isLast: false,
};

function dung(rows: Row[]) {
  const prisma = {
    publicationAuthor: {
      findUnique: vi.fn().mockResolvedValue({ claimStatus: 'CONFIRMED' }),
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      // kiemHangCuaToi (5/10/2026): hàng người gọi chọn chưa ai khác nhận.
      findFirst: vi.fn().mockResolvedValue(null),
    },
    publication: {
      findUnique: vi.fn().mockResolvedValue({
        publishedYear: 2026,
        acceptedYear: null,
        catalogCode: '1.1a',
        schoolAuthors: 4,
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      // timTrung (5/10/2026): dò công trình cùng tên trước khi tạo bài mới.
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'p1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const bus = { emit: vi.fn() };
  const svc = new ScholarService(
    prisma as never,
    {} as never,
    {} as never,
    bus as never,
    {} as never,
  );
  const lo = svc as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(lo, 'findOne').mockResolvedValue({ id: 'p1' });
  vi.spyOn(lo, 'revalidateStaffPages').mockResolvedValue(undefined);
  vi.spyOn(lo, 'recount').mockResolvedValue(undefined);
  return { svc, prisma, bus };
}

/** Thân PATCH y như phys-profile gửi (publication-edit.tsx): luôn kèm mainAuthorAtSchool. */
const sua = (memberUpdates?: unknown) =>
  UpdatePublicationBodySchema.parse({
    title: 'A comparative study',
    mainAuthorAtSchool: true,
    me: { authorIndex: 0, isFirst: true, isCorresponding: true, isLast: false },
    ...(memberUpdates === undefined ? {} : { memberUpdates }),
  });

describe('UpdatePublicationBodySchema — memberUpdates không còn bị Zod bỏ', () => {
  // Khoa chốt 10/10/2026 (Phụ lục 2 tr. 2.5): ĐẠI DIỆN nhóm khai tỷ lệ Cách 1
  // cho cả nhóm — nên tỷ lệ của đồng tác giả phải đi qua được schema. Bản trước
  // bỏ nó ("chính chủ khai") nên đồng tác giả thường không bao giờ có tỷ lệ.
  it('giữ cờ vai trò VÀ tỷ lệ chia của đồng tác giả', () => {
    const body = sua([
      {
        userId: 'tai',
        isFirst: false,
        isCorresponding: false,
        isLast: false,
        sharePercent: 40,
      },
    ]);
    expect(body.memberUpdates).toEqual([
      {
        userId: 'tai',
        isFirst: false,
        isCorresponding: false,
        isLast: false,
        sharePercent: 40,
      },
    ]);
  });
});

describe('ScholarService.update — sửa vai trò đồng tác giả', () => {
  it('bỏ tick Corresponding của người kia → lưu thật, ghi AuditLog, báo kèm người bị đổi', async () => {
    const { svc, prisma, bus } = dung([TAI]);
    await svc.update(
      'thong',
      'p1',
      sua([
        { userId: 'tai', isFirst: false, isCorresponding: false, isLast: false },
      ]),
    );

    expect(prisma.publicationAuthor.update).toHaveBeenCalledWith({
      where: { publicationId_userId: { publicationId: 'p1', userId: 'tai' } },
      data: { isFirst: false, isCorresponding: false, isLast: false },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'thong',
        action: 'publication.coauthor-role',
        entityType: 'Publication',
        entityId: 'p1',
        changes: {
          coAuthorUserId: 'tai',
          before: { isFirst: false, isCorresponding: true, isLast: false },
          after: { isFirst: false, isCorresponding: false, isLast: false },
        },
      },
    });
    // Sửa dòng và ghi nhật ký đi chung một giao dịch.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledWith('publication.changed', {
      id: 'p1',
      userIds: ['thong', 'tai'],
    });
  });

  it('lưu lại mà không đổi vai trò ai → không ghi dòng nào, không nhật ký', async () => {
    const { svc, prisma, bus } = dung([TAI]);
    await svc.update(
      'thong',
      'p1',
      sua([
        { userId: 'tai', isFirst: false, isCorresponding: true, isLast: false },
      ]),
    );
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith('publication.changed', {
      id: 'p1',
      userIds: ['thong'],
    });
  });

  it('dòng của chính người gọi bị bỏ qua — vai trò của mình đi qua `me`', async () => {
    const { svc, prisma } = dung([THONG]);
    await svc.update(
      'thong',
      'p1',
      sua([
        {
          userId: 'thong',
          isFirst: false,
          isCorresponding: false,
          isLast: false,
        },
      ]),
    );
    expect(prisma.publicationAuthor.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: expect.anything() }),
      }),
    );
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });

  it('chỉ xét người CÓ trên bài và chưa từ chối — không thêm được ai qua đường này', async () => {
    const { svc, prisma } = dung([]);
    await svc.update(
      'thong',
      'p1',
      sua([
        { userId: 'nguoi-la', isFirst: true, isCorresponding: true, isLast: true },
      ]),
    );
    expect(prisma.publicationAuthor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          publicationId: 'p1',
          userId: { in: ['nguoi-la'] },
          claimStatus: { not: 'REJECTED' },
        },
      }),
    );
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });

  it('lời mời còn chờ → ghi cờ nhưng không ghi nhật ký (người được mời tự chọn lại lúc xác nhận)', async () => {
    const { svc, prisma } = dung([
      {
        userId: 'tao',
        claimStatus: 'PENDING',
        isFirst: false,
        isCorresponding: false,
        isLast: false,
      },
    ]);
    await svc.update(
      'thong',
      'p1',
      sua([
        { userId: 'tao', isFirst: false, isCorresponding: false, isLast: true },
      ]),
    );
    expect(prisma.publicationAuthor.update).toHaveBeenCalledWith({
      where: { publicationId_userId: { publicationId: 'p1', userId: 'tao' } },
      data: { isFirst: false, isCorresponding: false, isLast: true },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('cờ không gửi thì giữ nguyên giá trị đang có', async () => {
    const { svc, prisma } = dung([TAI]);
    await svc.update('thong', 'p1', sua([{ userId: 'tai', isLast: true }]));
    expect(prisma.publicationAuthor.update.mock.calls[0][0].data).toEqual({
      isFirst: false,
      isCorresponding: true,
      isLast: true,
    });
  });

  it('không gửi memberUpdates (bản phys-profile cũ) → không đụng đồng tác giả', async () => {
    const { svc, prisma } = dung([TAI]);
    await svc.update('thong', 'p1', sua());
    expect(prisma.publicationAuthor.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: expect.anything() }),
      }),
    );
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });
});

describe('ScholarService.create — vai trò người khai gán cho người được mời', () => {
  const khai = (doi: string | null) =>
    CreatePublicationBodySchema.parse({
      work: {
        doi,
        type: 'journal-article',
        title: 'A comparative study',
        publishedYear: 2026,
        publishedMonth: 3,
        authors: [],
        source: 'crossref',
      },
      me: { authorIndex: 0 },
      coAuthorUserIds: ['tao'],
      memberUpdates: [
        { userId: 'tao', isFirst: false, isCorresponding: false, isLast: true },
      ],
    });

  it('bài mới → mời rồi mới ghi vai trò cho người được mời', async () => {
    const { svc, prisma } = dung([
      {
        userId: 'tao',
        claimStatus: 'PENDING',
        isFirst: false,
        isCorresponding: false,
        isLast: false,
      },
    ]);
    await svc.create('thanh', khai(null));
    expect(prisma.publicationAuthor.createMany).toHaveBeenCalled();
    expect(prisma.publicationAuthor.update).toHaveBeenCalledWith({
      where: { publicationId_userId: { publicationId: 'p1', userId: 'tao' } },
      data: { isFirst: false, isCorresponding: false, isLast: true },
    });
    const moi = prisma.publicationAuthor.createMany.mock.invocationCallOrder[0];
    const ghi = prisma.publicationAuthor.update.mock.invocationCallOrder[0];
    expect(moi).toBeLessThan(ghi);
  });

  it('DOI đã có trong hệ thống → chỉ gắn người khai, KHÔNG sửa vai trò người đã có trên bài', async () => {
    const { svc, prisma } = dung([TAI]);
    prisma.publication.findFirst.mockResolvedValue({ id: 'p0' });
    await svc.create('thanh', khai('10.1016/j.radphyschem.2026.114162'));
    expect(prisma.publicationAuthor.upsert).toHaveBeenCalled();
    expect(prisma.publicationAuthor.findMany).not.toHaveBeenCalled();
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });
});

describe('Cách 1 — ĐẠI DIỆN (tác giả chính) khai tỷ lệ cho cả nhóm (10/10/2026)', () => {
  // Đo 10/10/2026: 4 công trình chọn Cách 1 mà đồng tác giả không có tỷ lệ →
  // ACADsoom tính họ Cách 2 — vì đại diện không lưu được tỷ lệ cho người khác,
  // còn người không phải tác giả chính thì bị chặn tự khai.
  const suaBoi = (
    me: Record<string, unknown>,
    memberUpdates?: unknown,
    externalAuthors?: unknown,
  ) =>
    UpdatePublicationBodySchema.parse({
      title: 'A comparative study',
      mainAuthorAtSchool: true,
      me: {
        authorIndex: 0,
        isFirst: false,
        isCorresponding: false,
        isLast: false,
        ...me,
      },
      ...(memberUpdates === undefined ? {} : { memberUpdates }),
      ...(externalAuthors === undefined ? {} : { externalAuthors }),
    });
  const DAI_DIEN = { isFirst: true, isCorresponding: true };
  const CUONG: Row = {
    userId: 'cuong',
    claimStatus: 'CONFIRMED',
    isFirst: false,
    isCorresponding: false,
    isLast: false,
    sharePercent: null,
  };
  const daLuuCuaToi = (sharePercent: number | null) => ({
    claimStatus: 'CONFIRMED',
    sharePercent,
    isFirst: false,
    isCorresponding: false,
    isLast: false,
  });

  it('đại diện đặt tỷ lệ cho đồng tác giả → ghi xuống dòng của người đó + nhật ký', async () => {
    const { svc, prisma } = dung([CUONG]);
    await svc.update(
      'thuan',
      'p1',
      suaBoi({ ...DAI_DIEN, sharePercent: 50 }, [
        { userId: 'cuong', sharePercent: 25 },
      ]),
    );
    expect(prisma.publicationAuthor.update.mock.calls[0][0].data).toEqual({
      isFirst: false,
      isCorresponding: false,
      isLast: false,
      sharePercent: 25,
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data.changes).toEqual({
      coAuthorUserId: 'cuong',
      before: {
        isFirst: false,
        isCorresponding: false,
        isLast: false,
        sharePercent: null,
      },
      after: {
        isFirst: false,
        isCorresponding: false,
        isLast: false,
        sharePercent: 25,
      },
    });
    // Tỷ lệ của chính đại diện đi qua `me`.
    expect(
      prisma.publicationAuthor.upsert.mock.calls[0][0].update.sharePercent,
    ).toBe(50);
  });

  it('đại diện đặt tỷ lệ cho người CÒN CHỜ xác nhận → ghi sẵn trên dòng chờ', async () => {
    const { svc, prisma } = dung([{ ...CUONG, claimStatus: 'PENDING' }]);
    await svc.update(
      'thuan',
      'p1',
      suaBoi(DAI_DIEN, [{ userId: 'cuong', sharePercent: 25 }]),
    );
    expect(
      prisma.publicationAuthor.update.mock.calls[0][0].data.sharePercent,
    ).toBe(25);
  });

  it('đại diện quay về Cách 2 (gửi null) → xoá tỷ lệ của người kia và của mình', async () => {
    const { svc, prisma } = dung([{ ...CUONG, sharePercent: 25 }]);
    await svc.update(
      'thuan',
      'p1',
      suaBoi({ ...DAI_DIEN, sharePercent: null }, [
        { userId: 'cuong', sharePercent: null },
      ]),
    );
    expect(
      prisma.publicationAuthor.update.mock.calls[0][0].data.sharePercent,
    ).toBeNull();
    expect(
      prisma.publicationAuthor.upsert.mock.calls[0][0].update.sharePercent,
    ).toBeNull();
  });

  it('KHÔNG phải đại diện → tỷ lệ gửi kèm cho người khác bị bỏ qua', async () => {
    const { svc, prisma } = dung([{ ...CUONG, sharePercent: 25 }]);
    await svc.update(
      'lieu',
      'p1',
      suaBoi({}, [{ userId: 'cuong', sharePercent: 60 }]),
    );
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });

  it('KHÔNG phải đại diện, gửi lại đúng tỷ lệ đại diện đã khai cho mình → lưu được, giữ nguyên', async () => {
    const { svc, prisma } = dung([]);
    prisma.publicationAuthor.findUnique.mockResolvedValue(daLuuCuaToi(25));
    await svc.update('cuong', 'p1', suaBoi({ sharePercent: 25 }));
    expect(prisma.publication.update).toHaveBeenCalled();
    expect(
      prisma.publicationAuthor.upsert.mock.calls[0][0].update.sharePercent,
    ).toBeUndefined();
  });

  it('KHÔNG phải đại diện mà tự đổi tỷ lệ của mình → chặn TRƯỚC mọi lệnh ghi', async () => {
    const { svc, prisma } = dung([]);
    prisma.publicationAuthor.findUnique.mockResolvedValue(daLuuCuaToi(25));
    await expect(
      svc.update('cuong', 'p1', suaBoi({ sharePercent: 60 })),
    ).rejects.toThrow();
    expect(prisma.publication.update).not.toHaveBeenCalled();
    expect(prisma.publicationAuthor.upsert).not.toHaveBeenCalled();
  });

  it('tổng tỷ lệ cả nhóm (trong + ngoài Khoa) vượt 100% → chặn trước mọi lệnh ghi', async () => {
    const { svc, prisma } = dung([CUONG]);
    await expect(
      svc.update(
        'thuan',
        'p1',
        suaBoi(
          { ...DAI_DIEN, sharePercent: 50 },
          [{ userId: 'cuong', sharePercent: 30 }],
          [{ name: 'J. Smith', sharePercent: 30 }],
        ),
      ),
    ).rejects.toThrow();
    expect(prisma.publication.update).not.toHaveBeenCalled();
  });

  it('xác nhận lời mời: không phải tác giả chính → giữ nguyên tỷ lệ đại diện đã khai', async () => {
    const { svc, prisma } = dung([]);
    prisma.publicationAuthor.findUnique.mockResolvedValue({
      claimStatus: 'PENDING',
      sharePercent: 25,
    });
    await svc.respondToClaim('cuong', 'p1', {
      accept: true,
      authorship: {
        authorIndex: 2,
        isFirst: false,
        isCorresponding: false,
        isLast: false,
        sharePercent: 25,
        showOnWeb: true,
      },
    });
    const data = prisma.publicationAuthor.update.mock.calls[0][0].data;
    expect(data.sharePercent).toBeUndefined();
    expect(data.claimStatus).toBe('CONFIRMED');
  });

  it('xác nhận lời mời: không phải tác giả chính mà đổi tỷ lệ → chặn', async () => {
    const { svc, prisma } = dung([]);
    prisma.publicationAuthor.findUnique.mockResolvedValue({
      claimStatus: 'PENDING',
      sharePercent: 25,
    });
    await expect(
      svc.respondToClaim('cuong', 'p1', {
        accept: true,
        authorship: {
          authorIndex: 2,
          isFirst: false,
          isCorresponding: false,
          isLast: false,
          sharePercent: 60,
          showOnWeb: true,
        },
      }),
    ).rejects.toThrow();
    expect(prisma.publicationAuthor.update).not.toHaveBeenCalled();
  });

  it('khai bài mới: người không phải tác giả chính tự đặt tỷ lệ → chặn như cũ', async () => {
    const { svc } = dung([]);
    const body = CreatePublicationBodySchema.parse({
      work: {
        doi: null,
        type: 'journal-article',
        title: 'X',
        publishedYear: 2026,
        publishedMonth: 3,
        authors: [],
        source: 'crossref',
      },
      me: { authorIndex: 1, sharePercent: 40 },
    });
    await expect(svc.create('cuong', body)).rejects.toThrow();
  });
});
