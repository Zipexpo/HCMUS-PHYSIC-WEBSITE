import { describe, expect, it, vi } from 'vitest';
import { duocQuanLy, vaiTroLucTao, vaiTroSauKhiSua } from './project-roles';
import { ProjectService } from './project.service';

/**
 * Danh sách nhân sự của đề tài phải có CHỦ NHIỆM, và ai quản lý được đề tài
 * (13/9/2026).
 *
 * Luật chủ nhiệm phải giữ ở MỌI đường ghi: lúc tạo, lúc sửa (tự hạ mình, đổi
 * vai người khác, thay người ngoài), và lúc chủ nhiệm duy nhất rút tên. Quyền
 * sửa: chủ nhiệm đã xác nhận, hoặc người khai khi chưa có chủ nhiệm nào có tài
 * khoản đã xác nhận — không thì đề tài kẹt, không ai sửa được.
 */
const dong = (
  id: string,
  userId: string | null,
  role: string,
  claimStatus = 'CONFIRMED',
) => ({ id, userId, role, claimStatus });

describe('vaiTroLucTao', () => {
  it('người khai không chọn vai → mặc định là chủ nhiệm', () => {
    expect(vaiTroLucTao('u1', {})).toContain('LEAD');
  });

  it('tự để Thành viên, không mời ai làm chủ nhiệm → KHÔNG có chủ nhiệm', () => {
    expect(
      vaiTroLucTao('u1', { myRole: 'MEMBER', members: [{ userId: 'u2' }] }),
    ).not.toContain('LEAD');
  });

  it('mời đồng nghiệp làm chủ nhiệm (còn chờ xác nhận) → có', () => {
    expect(
      vaiTroLucTao('u1', {
        myRole: 'SECRETARY',
        members: [{ userId: 'u2', role: 'LEAD' }],
      }),
    ).toContain('LEAD');
  });

  it('chủ nhiệm là cộng sự ngoài Khoa có tên → có', () => {
    expect(
      vaiTroLucTao('u1', {
        myRole: 'MEMBER',
        externalMembers: [{ name: 'GS. X', role: 'LEAD' }],
      }),
    ).toContain('LEAD');
  });

  it('cộng sự ngoài chưa gõ tên thì không tính — dòng đó bị bỏ lúc lưu', () => {
    expect(
      vaiTroLucTao('u1', {
        myRole: 'MEMBER',
        externalMembers: [{ name: '  ', role: 'LEAD' }],
      }),
    ).not.toContain('LEAD');
  });

  it('tự gắn chính mình làm chủ nhiệm qua danh sách mời không tính', () => {
    // invite() bỏ qua chính người mời, nên dòng này không bao giờ được ghi.
    expect(
      vaiTroLucTao('u1', {
        myRole: 'MEMBER',
        members: [{ userId: 'u1', role: 'LEAD' }],
      }),
    ).not.toContain('LEAD');
  });
});

describe('vaiTroSauKhiSua', () => {
  const nhom = [
    dong('m1', 'u1', 'LEAD'),
    dong('m2', 'u2', 'MEMBER'),
    dong('m3', null, 'MEMBER'),
  ];

  it('sửa chỗ khác, không đụng vai → vẫn còn chủ nhiệm', () => {
    expect(vaiTroSauKhiSua(nhom, 'u1', {})).toContain('LEAD');
  });

  it('chủ nhiệm tự hạ mình, không giao cho ai → KHÔNG còn', () => {
    expect(vaiTroSauKhiSua(nhom, 'u1', { myRole: 'MEMBER' })).not.toContain(
      'LEAD',
    );
  });

  it('tự hạ mình nhưng giao vai cho người khác cùng lượt → còn', () => {
    expect(
      vaiTroSauKhiSua(nhom, 'u1', {
        myRole: 'MEMBER',
        memberUpdates: [{ memberId: 'm2', role: 'LEAD' }],
      }),
    ).toContain('LEAD');
  });

  it('myRole đè memberUpdates trên dòng của chính mình — đúng thứ tự ghi', () => {
    expect(
      vaiTroSauKhiSua(nhom, 'u1', {
        myRole: 'MEMBER',
        memberUpdates: [{ memberId: 'm1', role: 'LEAD' }],
      }),
    ).not.toContain('LEAD');
  });

  it('tự hạ mình và MỜI chủ nhiệm mới → còn', () => {
    expect(
      vaiTroSauKhiSua(nhom, 'u1', {
        myRole: 'MEMBER',
        members: [{ userId: 'u9', role: 'LEAD' }],
      }),
    ).toContain('LEAD');
  });

  it('mời lại người ĐÃ có dòng không đổi được vai — invite() bỏ qua trùng', () => {
    expect(
      vaiTroSauKhiSua(nhom, 'u1', {
        myRole: 'MEMBER',
        members: [{ userId: 'u2', role: 'LEAD' }],
      }),
    ).not.toContain('LEAD');
  });

  it('gửi externalMembers là thay TOÀN BỘ người ngoài', () => {
    const coNgoai = [dong('m1', 'u1', 'LEAD'), dong('m3', null, 'LEAD')];
    // Người ngoài đang là chủ nhiệm; danh sách mới không còn ai làm chủ nhiệm.
    expect(
      vaiTroSauKhiSua(coNgoai, 'u1', {
        myRole: 'MEMBER',
        externalMembers: [{ name: 'Y', role: 'MEMBER' }],
      }),
    ).not.toContain('LEAD');
    // Không gửi externalMembers thì người ngoài giữ nguyên.
    expect(vaiTroSauKhiSua(coNgoai, 'u1', { myRole: 'MEMBER' })).toContain(
      'LEAD',
    );
  });

  it('dòng đã từ chối không tính là chủ nhiệm', () => {
    const rows = [
      dong('m1', 'u1', 'LEAD'),
      dong('m2', 'u2', 'LEAD', 'REJECTED'),
    ];
    expect(vaiTroSauKhiSua(rows, 'u1', { myRole: 'MEMBER' })).not.toContain(
      'LEAD',
    );
  });

  it('chủ nhiệm đang chờ xác nhận vẫn tính', () => {
    const rows = [
      dong('m1', 'u1', 'LEAD'),
      dong('m2', 'u2', 'LEAD', 'PENDING'),
    ];
    expect(vaiTroSauKhiSua(rows, 'u1', { myRole: 'MEMBER' })).toContain('LEAD');
  });
});

describe('duocQuanLy', () => {
  it('chủ nhiệm đã xác nhận → được', () => {
    expect(duocQuanLy('u1', 'u9', [dong('m1', 'u1', 'LEAD')])).toBe(true);
  });

  it('chủ nhiệm còn chờ xác nhận → chưa được', () => {
    expect(duocQuanLy('u1', 'u9', [dong('m1', 'u1', 'LEAD', 'PENDING')])).toBe(
      false,
    );
  });

  it('người khai, đề tài chưa có chủ nhiệm nào → được', () => {
    const rows = [dong('m1', 'u1', 'MEMBER'), dong('m2', 'u2', 'MEMBER')];
    expect(duocQuanLy('u1', 'u1', rows)).toBe(true);
  });

  it('người khai, chủ nhiệm được mời còn chờ xác nhận → vẫn được', () => {
    const rows = [
      dong('m1', 'u1', 'SECRETARY'),
      dong('m2', 'u2', 'LEAD', 'PENDING'),
    ];
    expect(duocQuanLy('u1', 'u1', rows)).toBe(true);
  });

  it('người khai, chủ nhiệm bấm "Không phải tôi" → được', () => {
    const rows = [
      dong('m1', 'u1', 'SECRETARY'),
      dong('m2', 'u2', 'LEAD', 'REJECTED'),
    ];
    expect(duocQuanLy('u1', 'u1', rows)).toBe(true);
  });

  it('người khai, chủ nhiệm là cộng sự ngoài Khoa (không đăng nhập được) → được', () => {
    const rows = [dong('m1', 'u1', 'MEMBER'), dong('m2', null, 'LEAD')];
    expect(duocQuanLy('u1', 'u1', rows)).toBe(true);
  });

  it('người khai, đã có chủ nhiệm có tài khoản xác nhận → KHÔNG', () => {
    const rows = [dong('m1', 'u1', 'MEMBER'), dong('m2', 'u2', 'LEAD')];
    expect(duocQuanLy('u1', 'u1', rows)).toBe(false);
  });

  it('thành viên KHÔNG phải người khai, đề tài chưa có chủ nhiệm → KHÔNG', () => {
    const rows = [dong('m1', 'u1', 'MEMBER'), dong('m2', 'u2', 'MEMBER')];
    expect(duocQuanLy('u1', 'u2', rows)).toBe(false);
  });

  it('người khai đã rút tên → KHÔNG', () => {
    const rows = [
      dong('m1', 'u1', 'MEMBER', 'REJECTED'),
      dong('m2', 'u2', 'MEMBER'),
    ];
    expect(duocQuanLy('u1', 'u1', rows)).toBe(false);
  });

  it('không rõ người khai → chỉ chủ nhiệm', () => {
    expect(duocQuanLy('u1', null, [dong('m1', 'u1', 'MEMBER')])).toBe(false);
  });
});

function dungService(
  hienCo: ReturnType<typeof dong>[],
  createdBy: string | null = 'u1',
) {
  const prisma = {
    projectMember: {
      findUnique: vi.fn(
        ({ where }: { where: { projectId_userId: { userId: string } } }) => {
          const m = hienCo.find(
            (x) => x.userId === where.projectId_userId.userId,
          );
          return Promise.resolve(
            m ? { claimStatus: m.claimStatus, role: m.role } : null,
          );
        },
      ),
      findMany: vi.fn().mockResolvedValue(hienCo),
      count: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    researchProject: {
      create: vi.fn().mockResolvedValue({ id: 'p1' }),
      findFirst: vi.fn().mockResolvedValue({ createdBy, members: hienCo }),
      findUnique: vi.fn().mockResolvedValue({
        catalogCode: null,
        startYear: null,
        startMonth: null,
        endYear: null,
        endMonth: null,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const svc = new ProjectService(prisma as never, { emit: vi.fn() } as never);
  vi.spyOn(
    svc as unknown as { findOne: () => Promise<unknown> },
    'findOne',
  ).mockResolvedValue({ id: 'p1' });
  return { svc, prisma };
}

describe('ProjectService — luật có chủ nhiệm ở các đường ghi', () => {
  it('tạo: tự để Thành viên, không ai làm chủ nhiệm → báo lỗi, KHÔNG tạo gì', async () => {
    const { svc, prisma } = dungService([]);
    await expect(
      svc.create('u1', {
        title: 'T',
        myRole: 'MEMBER',
        members: [],
        externalMembers: [],
      }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.create).not.toHaveBeenCalled();
  });

  it('tạo: chủ nhiệm là cộng sự ngoài Khoa → tạo được', async () => {
    const { svc, prisma } = dungService([]);
    await svc.create('u1', {
      title: 'T',
      myRole: 'MEMBER',
      members: [],
      externalMembers: [{ name: 'GS. X', role: 'LEAD' }],
    });
    expect(prisma.researchProject.create).toHaveBeenCalledTimes(1);
  });

  it('sửa: chủ nhiệm tự hạ mình, không giao cho ai → báo lỗi TRƯỚC mọi lệnh ghi', async () => {
    const { svc, prisma } = dungService([
      dong('m1', 'u1', 'LEAD'),
      dong('m2', 'u2', 'MEMBER'),
    ]);
    await expect(
      svc.update('u1', 'p1', { myRole: 'MEMBER' }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.update).not.toHaveBeenCalled();
    expect(prisma.projectMember.update).not.toHaveBeenCalled();
    expect(prisma.projectMember.updateMany).not.toHaveBeenCalled();
  });

  it('sửa: chỉ bật/tắt hiện trên trang → luật không chặn thành viên thường', async () => {
    const { svc, prisma } = dungService([dong('m1', 'u1', 'MEMBER')], 'u9');
    await svc.update('u1', 'p1', { myShowOnWeb: false });
    expect(prisma.projectMember.update).toHaveBeenCalledTimes(1);
  });

  it('rút tên: chủ nhiệm DUY NHẤT, còn người khác → báo lỗi, không rút', async () => {
    const { svc, prisma } = dungService([
      dong('m1', 'u1', 'LEAD'),
      dong('m2', 'u2', 'MEMBER'),
    ]);
    await expect(svc.remove('u1', 'p1')).rejects.toBeDefined();
    expect(prisma.projectMember.updateMany).not.toHaveBeenCalled();
  });

  it('rút tên: còn chủ nhiệm khác → rút được', async () => {
    const { svc, prisma } = dungService([
      dong('m1', 'u1', 'LEAD'),
      dong('m2', 'u2', 'LEAD'),
    ]);
    await svc.remove('u1', 'p1');
    expect(prisma.projectMember.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rút tên: thành viên rời đề tài vốn đã thiếu chủ nhiệm → không chặn oan', async () => {
    const { svc, prisma } = dungService([
      dong('m1', 'u1', 'MEMBER'),
      dong('m2', 'u2', 'MEMBER'),
    ]);
    await svc.remove('u1', 'p1');
    expect(prisma.projectMember.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectService — người khai sửa được khi chưa có chủ nhiệm xác nhận', () => {
  it('người khai (Thành viên) chọn chủ nhiệm cho đề tài → lưu được', async () => {
    const { svc, prisma } = dungService(
      [dong('m1', 'u1', 'MEMBER'), dong('m2', 'u2', 'MEMBER')],
      'u1',
    );
    await svc.update('u1', 'p1', {
      memberUpdates: [{ memberId: 'm2', role: 'LEAD' }],
    });
    expect(prisma.researchProject.update).toHaveBeenCalledTimes(1);
    expect(prisma.projectMember.updateMany).toHaveBeenCalledTimes(1);
  });

  it('người khai sửa mà vẫn không chọn chủ nhiệm → luật chủ nhiệm vẫn chặn', async () => {
    const { svc, prisma } = dungService(
      [dong('m1', 'u1', 'MEMBER'), dong('m2', 'u2', 'MEMBER')],
      'u1',
    );
    await expect(
      svc.update('u1', 'p1', { title: 'Tên mới' }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.update).not.toHaveBeenCalled();
  });

  it('người khai khi ĐÃ có chủ nhiệm xác nhận → không sửa được', async () => {
    const { svc, prisma } = dungService(
      [dong('m1', 'u1', 'MEMBER'), dong('m2', 'u2', 'LEAD')],
      'u1',
    );
    await expect(
      svc.update('u1', 'p1', { title: 'Tên mới' }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.update).not.toHaveBeenCalled();
  });

  it('thành viên không phải người khai → không sửa được dù chưa có chủ nhiệm', async () => {
    const { svc, prisma } = dungService(
      [dong('m1', 'u1', 'MEMBER'), dong('m2', 'u2', 'MEMBER')],
      'u2',
    );
    await expect(
      svc.update('u1', 'p1', {
        memberUpdates: [{ memberId: 'm1', role: 'LEAD' }],
      }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.update).not.toHaveBeenCalled();
  });

  it('người khai một mình, chưa có chủ nhiệm → xoá hẳn được', async () => {
    const { svc, prisma } = dungService([dong('m1', 'u1', 'MEMBER')], 'u1');
    prisma.projectMember.count.mockResolvedValue(0);
    await svc.remove('u1', 'p1');
    expect(prisma.researchProject.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' } }),
    );
  });

  it('phản hồi mang canEdit tính bằng CÙNG hàm với chốt chặn', () => {
    const { svc } = dungService([]);
    const shape = (
      svc as unknown as {
        shape: (row: unknown, userId: string) => { canEdit: boolean };
      }
    ).shape.bind(svc);
    const deTai = (members: ReturnType<typeof dong>[]) => ({
      budget: null,
      catalogCode: null,
      createdBy: 'u1',
      members,
    });
    expect(shape(deTai([dong('m1', 'u1', 'MEMBER')]), 'u1').canEdit).toBe(true);
    const coChuNhiem = deTai([
      dong('m1', 'u1', 'MEMBER'),
      dong('m2', 'u2', 'LEAD'),
    ]);
    expect(shape(coChuNhiem, 'u1').canEdit).toBe(false);
    expect(shape(coChuNhiem, 'u2').canEdit).toBe(true);
  });
});
