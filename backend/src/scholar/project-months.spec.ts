import { describe, expect, it, vi } from 'vitest';
import {
  ProjectService,
  soatMocDeTai,
  soThang,
  thangGuiAcadsoom,
} from './project.service';

/**
 * Số tháng thực hiện là MẪU SỐ của phép chia giờ theo năm học (Phụ lục 2 tr.
 * 2.7). Lệch một tháng là lệch giờ của mọi thành viên, ở mọi năm — nên nó đáng
 * có test riêng dù chỉ là một phép trừ.
 *
 * Quy ước HIỆU SỐ (span): end − start, KHÔNG cộng 1. Đúng một năm (2/2025 →
 * 2/2026) ra 12; nửa cuối năm dương lịch (1 → 12) ra 11; cùng tháng ra 0.
 */
describe('soThang', () => {
  it('đúng một năm là 12 tháng', () => {
    // 2/2025 → 2/2026 = 12 (một năm chẵn), không phải 13.
    expect(soThang(2025, 2, 2026, 2)).toBe(12);
  });

  it('trong cùng một năm dương lịch là hiệu số tháng', () => {
    // 1/2025 → 12/2025 = 11 (span), không phải 12.
    expect(soThang(2025, 1, 2025, 12)).toBe(11);
  });

  it('cùng một tháng thì hiệu số bằng không', () => {
    expect(soThang(2025, 6, 2025, 6)).toBe(0);
  });

  it('bắc qua nhiều năm', () => {
    expect(soThang(2024, 7, 2027, 6)).toBe(35);
  });

  it('bắc qua ranh giới năm dương lịch', () => {
    expect(soThang(2025, 11, 2026, 2)).toBe(3);
  });

  it('thiếu bất kỳ mốc nào thì không suy được — trả null để dùng số nhập tay', () => {
    expect(soThang(null, 1, 2025, 12)).toBeNull();
    expect(soThang(2025, null, 2025, 12)).toBeNull();
    expect(soThang(2025, 1, null, 12)).toBeNull();
    expect(soThang(2025, 1, 2025, null)).toBeNull();
    expect(soThang(undefined, undefined, undefined, undefined)).toBeNull();
  });

  it('kết thúc trước khi bắt đầu là dữ liệu sai — trả null, KHÔNG trả số âm', () => {
    // Trả số âm thì nó chảy thẳng vào mẫu số và cho ra giờ âm mà không ai thấy.
    expect(soThang(2026, 5, 2025, 3)).toBeNull();
  });
});

/**
 * NGÀY NGƯỢC khác THIẾU MỐC (14/9/2026). soThang() trả null cho cả hai, và ba
 * nơi dùng nó đều hiểu null là "lấy số tháng gõ tay" — nên VL2020-18-02
 * (1/2020 → 1/2019) mang months=13, T2025-18 (12/2025 → 12/2024) mang months=8.
 */
describe('soatMocDeTai', () => {
  it('thiếu một mốc → thiếu', () => {
    expect(soatMocDeTai(2025, 1, null, 12)).toEqual({ loai: 'thieu' });
  });

  it('kết thúc trước bắt đầu → NGƯỢC, không phải thiếu', () => {
    expect(soatMocDeTai(2025, 2, 2024, 2)).toEqual({ loai: 'nguoc' });
  });

  it('đủ và đúng chiều → số tháng span', () => {
    expect(soatMocDeTai(2025, 2, 2026, 2)).toEqual({ loai: 'du', soThang: 12 });
  });

  it('cùng tháng vẫn là đủ mốc, 0 tháng', () => {
    expect(soatMocDeTai(2025, 9, 2025, 9)).toEqual({ loai: 'du', soThang: 0 });
  });
});

describe('thangGuiAcadsoom — số tháng gửi sang bên tính giờ', () => {
  const deTai = (
    startYear: number | null,
    startMonth: number | null,
    endYear: number | null,
    endMonth: number | null,
    months: number | null,
  ) => ({ startYear, startMonth, endYear, endMonth, months });

  it('đủ mốc → suy từ mốc, bỏ qua số đã lưu', () => {
    expect(thangGuiAcadsoom(deTai(2025, 2, 2026, 2, 99))).toBe(12);
  });

  it('thiếu mốc → dùng số đã lưu', () => {
    expect(thangGuiAcadsoom(deTai(null, null, null, null, 7))).toBe(7);
  });

  it('mốc ngược → null, KHÔNG gửi số gõ tay đi tính giờ', () => {
    expect(thangGuiAcadsoom(deTai(2020, 1, 2019, 1, 13))).toBeNull();
    expect(thangGuiAcadsoom(deTai(2025, 12, 2024, 12, 8))).toBeNull();
  });
});

const NGUOC = { startYear: 2025, startMonth: 2, endYear: 2024, endMonth: 2 };

function dung(cur: {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  finishedYear?: number | null;
  finishedMonth?: number | null;
}) {
  const hienCo = [
    { id: 'm1', userId: 'u1', role: 'LEAD', claimStatus: 'CONFIRMED' },
  ];
  const prisma = {
    projectMember: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ claimStatus: 'CONFIRMED', role: 'LEAD' }),
      findMany: vi.fn().mockResolvedValue(hienCo),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    researchProject: {
      create: vi.fn().mockResolvedValue({ id: 'p1' }),
      findFirst: vi
        .fn()
        .mockResolvedValue({ createdBy: 'u1', members: hienCo }),
      findUnique: vi.fn().mockResolvedValue({ catalogCode: null, ...cur }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const svc = new ProjectService(
    prisma as never,
    { emit: vi.fn() } as never,
    {} as never,
  );
  vi.spyOn(
    svc as unknown as { findOne: () => Promise<unknown> },
    'findOne',
  ).mockResolvedValue({ id: 'p1' });
  return { svc, prisma };
}

describe('ProjectService — chặn ngày ngược ở lúc tạo và lúc sửa', () => {
  const trong = { members: [], externalMembers: [] };

  it('tạo: ngày ngược → báo lỗi, không tạo, dù có gõ số tháng', async () => {
    const { svc, prisma } = dung(NGUOC);
    await expect(
      svc.create('u1', { title: 'T', ...NGUOC, months: 8, ...trong }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.create).not.toHaveBeenCalled();
  });

  it('tạo: đủ mốc → số tháng suy từ mốc, bỏ số gõ tay', async () => {
    const { svc, prisma } = dung(NGUOC);
    await svc.create('u1', {
      title: 'T',
      startYear: 2025,
      startMonth: 2,
      endYear: 2026,
      endMonth: 2,
      months: 99,
      ...trong,
    });
    expect(prisma.researchProject.create.mock.calls[0][0].data.months).toBe(12);
  });

  it('tạo: thiếu mốc → vẫn nhận số tháng gõ tay', async () => {
    const { svc, prisma } = dung(NGUOC);
    await svc.create('u1', { title: 'T', months: 7, ...trong });
    expect(prisma.researchProject.create.mock.calls[0][0].data.months).toBe(7);
  });

  it('sửa: mốc đang lưu ngược, sửa chỗ khác mà không sửa mốc → báo lỗi trước khi ghi', async () => {
    const { svc, prisma } = dung(NGUOC);
    await expect(
      svc.update('u1', 'p1', { title: 'Tên mới' }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.update).not.toHaveBeenCalled();
  });

  it('sửa: sửa mốc cho đúng chiều → lưu, số tháng suy từ mốc', async () => {
    const { svc, prisma } = dung(NGUOC);
    await svc.update('u1', 'p1', { endYear: 2026 });
    expect(prisma.researchProject.update.mock.calls[0][0].data.months).toBe(12);
  });

  it('sửa: chỉ bật/tắt hiện trên trang → không bị chặn dù mốc đang ngược', async () => {
    const { svc, prisma } = dung(NGUOC);
    await svc.update('u1', 'p1', { myShowOnWeb: false });
    expect(prisma.projectMember.update).toHaveBeenCalledTimes(1);
  });
});

/**
 * MỐC CHỐT THỰC TẾ — đóng đề tài thì phải nói đóng THÁNG NÀO.
 *
 * Không phải thủ tục giấy tờ: Khoa chốt 20/9/2026 rằng đề tài nghiệm thu SỚM
 * được dồn toàn bộ phần tháng còn lại vào năm học chứa tháng nghiệm thu (và năm
 * sau không tính nữa), còn đề tài KHÔNG hoàn thành thì cắt cụt tại tháng khai.
 * Cả hai đều cần con số đó; thiếu nó, ACADsoom vẫn chia đều tới hạn cũ nên giờ
 * của cả nhóm nằm lại ở một năm học mà đề tài đã đóng.
 *
 * Phép cắt nằm bên ACADsoom; ở đây chỉ kiểm chốt chặn và đường ghi.
 */
describe('ProjectService — mốc chốt khi đóng đề tài', () => {
  const trong = { members: [], externalMembers: [] };
  const DU = { startYear: 2025, startMonth: 2, endYear: 2027, endMonth: 2 };

  it('tạo: KHÔNG HOÀN THÀNH mà không nói tháng → báo lỗi, không ghi', async () => {
    const { svc, prisma } = dung(DU);
    await expect(
      svc.create('u1', { title: 'T', ...DU, status: 'FAILED', ...trong }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.create).not.toHaveBeenCalled();
  });

  it('tạo: kèm tháng → lưu đúng hai cột', async () => {
    const { svc, prisma } = dung(DU);
    await svc.create('u1', {
      title: 'T',
      ...DU,
      status: 'FAILED',
      finishedYear: 2026,
      finishedMonth: 10,
      ...trong,
    });
    const { data } = prisma.researchProject.create.mock.calls[0][0];
    expect([data.finishedYear, data.finishedMonth]).toEqual([2026, 10]);
  });

  it('tạo: đang thực hiện thì KHÔNG đòi tháng chốt', async () => {
    const { svc, prisma } = dung(DU);
    await svc.create('u1', { title: 'T', ...DU, ...trong });
    expect(prisma.researchProject.create).toHaveBeenCalledTimes(1);
  });

  it('sửa: đặt KHÔNG HOÀN THÀNH mà chưa có tháng → chặn trước khi ghi', async () => {
    const { svc, prisma } = dung(DU);
    await expect(
      svc.update('u1', 'p1', { status: 'FAILED' }),
    ).rejects.toBeDefined();
    expect(prisma.researchProject.update).not.toHaveBeenCalled();
  });

  // Người dùng có thể đã nhập tháng ở lượt trước rồi mới bấm đổi trạng thái.
  // Chốt chặn phải nhìn bản SAU khi sửa, không chỉ nhìn body của lượt này.
  it('sửa: tháng đã lưu từ lượt trước → không chặn nữa', async () => {
    const { svc, prisma } = dung({
      ...DU,
      finishedYear: 2026,
      finishedMonth: 10,
    });
    await svc.update('u1', 'p1', { status: 'FAILED' });
    expect(prisma.researchProject.update).toHaveBeenCalledTimes(1);
  });

  it('sửa: không đụng trạng thái → không đòi tháng chốt', async () => {
    const { svc, prisma } = dung(DU);
    await svc.update('u1', 'p1', { title: 'Tên mới' });
    expect(prisma.researchProject.update).toHaveBeenCalledTimes(1);
  });
});
