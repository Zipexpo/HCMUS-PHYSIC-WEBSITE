import { describe, expect, it, vi } from 'vitest';
import { ProjectService } from './project.service';

/**
 * Trả lời lời mời vào đề tài — hai lỗi thật cùng một chỗ, đo 13/9/2026.
 *
 * 1. Ô chọn vai trò lúc xác nhận mặc định "Thành viên", mà vai trò gửi kèm GHI
 *    ĐÈ vai trò người khai đã gán. Chủ nhiệm được gắn tên bấm xác nhận là tự hạ
 *    mình xuống: 8 đề tài không còn chủ nhiệm nào, nên không ai sửa được.
 * 2. Dòng ĐÃ trả lời vẫn gọi lại được để đổi vai trò — thành viên nào cũng tự
 *    nâng mình lên chủ nhiệm bằng một yêu cầu gõ tay.
 */
function dung(claimStatus: 'PENDING' | 'CONFIRMED' | 'REJECTED' | null) {
  const prisma = {
    projectMember: {
      findUnique: vi
        .fn()
        .mockResolvedValue(claimStatus ? { id: 'm1', claimStatus } : null),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const bus = { emit: vi.fn() };
  const svc = new ProjectService(prisma as never, bus as never, {} as never);
  const findOne = vi
    .spyOn(svc as unknown as { findOne: () => Promise<unknown> }, 'findOne')
    .mockResolvedValue({ id: 'p1' });
  return { svc, prisma, findOne, bus };
}

describe('ProjectService.respond', () => {
  it('đang chờ, xác nhận KHÔNG kèm vai trò → giữ nguyên vai trò đã gán', async () => {
    const { svc, prisma } = dung('PENDING');
    await svc.respond('u1', 'p1', true);
    expect(prisma.projectMember.update).toHaveBeenCalledTimes(1);
    const { data } = prisma.projectMember.update.mock.calls[0][0];
    expect(data.claimStatus).toBe('CONFIRMED');
    expect(data.role).toBeUndefined();
  });

  it('đang chờ, chọn vai trò khác → ghi vai trò đó', async () => {
    const { svc, prisma } = dung('PENDING');
    await svc.respond('u1', 'p1', true, 'LEAD');
    expect(prisma.projectMember.update.mock.calls[0][0].data.role).toBe('LEAD');
  });

  it('đang chờ, từ chối → không đụng tới vai trò', async () => {
    const { svc, prisma } = dung('PENDING');
    await svc.respond('u1', 'p1', false, 'LEAD');
    const { data } = prisma.projectMember.update.mock.calls[0][0];
    expect(data.claimStatus).toBe('REJECTED');
    expect(data.role).toBeUndefined();
  });

  it.each(['CONFIRMED', 'REJECTED'] as const)(
    'dòng đã %s → không đổi được vai trò qua đây, trả nguyên trạng',
    async (tt) => {
      const { svc, prisma, findOne } = dung(tt);
      await svc.respond('u1', 'p1', true, 'LEAD');
      expect(prisma.projectMember.update).not.toHaveBeenCalled();
      expect(findOne).toHaveBeenCalledWith('p1', 'u1');
    },
  );

  it('không phải thành viên → báo lỗi, không ghi gì', async () => {
    const { svc, prisma } = dung(null);
    await expect(svc.respond('u1', 'p1', true, 'LEAD')).rejects.toBeDefined();
    expect(prisma.projectMember.update).not.toHaveBeenCalled();
  });

  // Trả lời lời mời là lúc giờ NCKH của người đó đổi thật, mà đường này từng là
  // đường DUY NHẤT trong project.service không phát sự kiện — ACADsoom phải chờ
  // tới lượt quét đêm mới thấy.
  it.each([true, false])(
    'trả lời (accept=%s) → phát project.changed',
    async (accept) => {
      const { svc, bus } = dung('PENDING');
      await svc.respond('u1', 'p1', accept);
      expect(bus.emit).toHaveBeenCalledWith('project.changed', {
        id: 'p1',
        userIds: ['u1'],
      });
    },
  );

  it('dòng đã trả lời → KHÔNG phát lại (bấm đúp không làm bên nhận quét thừa)', async () => {
    const { svc, bus } = dung('CONFIRMED');
    await svc.respond('u1', 'p1', true);
    expect(bus.emit).not.toHaveBeenCalled();
  });
});

describe('ProjectService.pending', () => {
  it('trả kèm vai trò đã gán, để ô chọn lúc xác nhận mặc định đúng nó', async () => {
    const { svc, prisma } = dung(null);
    prisma.projectMember.findMany.mockResolvedValue([
      {
        role: 'LEAD',
        invitedBy: 'u9',
        project: {
          id: 'p1',
          title: 'T',
          code: null,
          funder: null,
          startYear: 2025,
        },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u9', firstName: 'B', lastName: 'A' },
    ]);
    const [r] = await svc.pending('u1');
    expect(r.role).toBe('LEAD');
    expect(r.invitedByName).toBe('A B');
  });
});
