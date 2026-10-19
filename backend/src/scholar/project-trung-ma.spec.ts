import { describe, expect, it, vi } from 'vitest';
import { ProjectService, chuanHoaMaDeTai } from './project.service';

/**
 * MỘT MÃ, MỘT ĐỀ TÀI (4/10/2026). T2025-44 bị khai hai lần bởi cùng một người,
 * cách nhau 18 phút; ACADsoom cộng 2 × 90 giờ và cả hai khoản đều được duyệt.
 * Xem chanTrungMa trong project.service.ts.
 */
describe('chuanHoaMaDeTai', () => {
  it('bỏ khoảng trắng, không phân biệt hoa thường', () => {
    expect(chuanHoaMaDeTai(' t2025 - 44 ')).toBe('T2025-44');
    expect(chuanHoaMaDeTai('B2023-18-12')).toBe('B2023-18-12');
  });

  it('ô điền cho có không phải mã — không được chặn nhầm', () => {
    for (const x of ['', '   ', 'N/A', 'chưa có', '-', '0', null, undefined]) {
      expect(chuanHoaMaDeTai(x)).toBeNull();
    }
  });
});

const TEN =
  'Khảo sát nền móng công trình đập thủy điện bằng phương pháp phân tích sóng mặt đa kênh';

function dung(daCo: Array<{ id: string; code: string | null }>, maHienTai = 'T2025-44') {
  const prisma = {
    researchProject: {
      findMany: vi.fn().mockResolvedValue(daCo),
      findFirst: vi.fn().mockResolvedValue({
        title: TEN,
        members: [{ externalName: null, user: { lastName: 'Trần Thị', firstName: 'Mai' } }],
      }),
      findUnique: vi.fn().mockResolvedValue({
        code: maHienTai,
        catalogCode: null,
        status: 'ONGOING',
        startYear: null,
        startMonth: null,
        endYear: null,
        endMonth: null,
        finishedYear: null,
        finishedMonth: null,
      }),
      create: vi.fn().mockResolvedValue({ id: 'p9' }),
      update: vi.fn().mockResolvedValue({}),
    },
    projectMember: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({}),
    },
  };
  const svc = new ProjectService(prisma as never, { emit: vi.fn() } as never, {} as never);
  // Quyền sửa, minh chứng và bản đọc lại có test riêng — ở đây chỉ xét chốt trùng mã.
  const rieng = svc as unknown as {
    findOne: () => Promise<unknown>;
    assertQuanLy: () => Promise<unknown>;
    ganStaged: () => Promise<unknown>;
  };
  vi.spyOn(rieng, 'findOne').mockResolvedValue({ id: 'p1' });
  vi.spyOn(rieng, 'assertQuanLy').mockResolvedValue([
    { id: 'm1', userId: 'u1', role: 'LEAD', claimStatus: 'CONFIRMED' },
  ]);
  vi.spyOn(rieng, 'ganStaged').mockResolvedValue(undefined);
  return { svc, prisma };
}

// Body tạo tối thiểu: danh sách thành viên rỗng, người khai là chủ nhiệm.
const khai = (code: string | null | undefined) => ({
  title: TEN,
  code,
  members: [],
  externalMembers: [],
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

describe('ProjectService — khai trùng mã đề tài', () => {
  it('tạo bản thứ hai cùng mã (gõ khác hoa thường, khoảng trắng) → chặn, KHÔNG ghi gì', async () => {
    const { svc, prisma } = dung([{ id: 'p1', code: 'T2025-44' }]);
    const loi = await loiCua(svc.create('u1', khai('t2025 - 44')));
    expect(loi?.field).toBe('code');
    expect(loi?.error).toContain('T2025-44');
    expect(loi?.error).toContain('chủ nhiệm Trần Thị Mai');
    expect(prisma.researchProject.create).not.toHaveBeenCalled();
  });

  it('mã mới → tạo được', async () => {
    const { svc, prisma } = dung([{ id: 'p1', code: 'T2025-43' }]);
    await svc.create('u1', khai('T2025-44'));
    expect(prisma.researchProject.create).toHaveBeenCalledTimes(1);
  });

  it('không ghi mã / ghi cho có → không so, tạo được', async () => {
    for (const code of [undefined, null, '', 'N/A']) {
      const { svc, prisma } = dung([{ id: 'p1', code: 'N/A' }]);
      await svc.create('u1', khai(code));
      expect(prisma.researchProject.findMany).not.toHaveBeenCalled();
      expect(prisma.researchProject.create).toHaveBeenCalledTimes(1);
    }
  });

  it('sửa: đổi sang mã của đề tài KHÁC → chặn trước khi ghi', async () => {
    const { svc, prisma } = dung([{ id: 'p2', code: 'T2025-45' }], 'T2025-44');
    const loi = await loiCua(svc.update('u1', 'p1', { code: 'T2025-45' }));
    expect(loi?.field).toBe('code');
    expect(prisma.researchProject.findMany.mock.calls[0][0].where.id).toEqual({ not: 'p1' });
    expect(prisma.researchProject.update).not.toHaveBeenCalled();
  });

  it('sửa: giữ nguyên mã của chính mình → không so, sửa được', async () => {
    // Đề tài đang trùng sẵn từ trước (chưa dọn) vẫn phải sửa được.
    const { svc, prisma } = dung([{ id: 'p2', code: 'T2025-44' }], 'T2025-44');
    await svc.update('u1', 'p1', { code: 'T2025-44', note: 'thêm ghi chú' });
    expect(prisma.researchProject.findMany).not.toHaveBeenCalled();
    expect(prisma.researchProject.update).toHaveBeenCalledTimes(1);
  });
});
