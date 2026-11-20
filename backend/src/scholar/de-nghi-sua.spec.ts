import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleName } from '../shared/constants/role.constants';
import { DeNghiSuaService } from './de-nghi-sua.service';

// CSDL giả, chỉ đủ cho vòng đời đề nghị: một bài, bốn người.
//   khai  = người khai (createdBy, đã xác nhận)
//   gui   = cán bộ khác gửi đề nghị (không có tên trong bài)
//   qt    = quản trị Khoa (canViewStats)
//   la    = người lạ không có quyền gì
const NGUOI: Record<string, { id: string; email: string; firstName: string; lastName: string; canViewStats?: boolean }> = {
  khai: { id: 'khai', email: 'khai@hcmus.edu.vn', firstName: 'An', lastName: 'Nguyễn Văn' },
  gui: { id: 'gui', email: 'gui@hcmus.edu.vn', firstName: 'Bình', lastName: 'Trần Thị' },
  qt: { id: 'qt', email: 'qt@hcmus.edu.vn', firstName: 'Khoa', lastName: 'Quản trị', canViewStats: true },
  la: { id: 'la', email: 'la@hcmus.edu.vn', firstName: 'Lạ', lastName: 'Người' },
};

function dung(opts: { createdBy?: string | null; khaiXacNhan?: boolean } = {}) {
  const bai = {
    id: 'p1',
    title: 'Bài gốc',
    doi: '10.1/x',
    catalogCode: '1.1c',
    publishedYear: 2025,
    publishedMonth: 9,
    containerTitle: 'J',
    deletedAt: null,
    createdBy: opts.createdBy === undefined ? 'khai' : opts.createdBy,
  };
  const deNghi = new Map<string, any>();
  let n = 0;
  const audit: any[] = [];
  const prisma = {
    publication: { findFirst: vi.fn(async () => bai) },
    publicationAuthor: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.publicationId_userId.userId === 'khai'
          ? { claimStatus: opts.khaiXacNhan === false ? 'REJECTED' : 'CONFIRMED', user: { isActive: true } }
          : null,
      ),
      findFirst: vi.fn(async () => null),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => ({ canViewStats: !!NGUOI[where.id]?.canViewStats, isActive: true })),
      findMany: vi.fn(async ({ where }: any) => where.id.in.map((id: string) => NGUOI[id]).filter(Boolean)),
    },
    publicationEditRequest: {
      findFirst: vi.fn(async ({ where }: any) =>
        [...deNghi.values()].find(
          (d) => d.publicationId === where.publicationId && d.requesterId === where.requesterId && where.status.in.includes(d.status),
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const d = { id: `r${++n}`, createdAt: new Date(), decidedBy: null, decidedAt: null, response: null, escalatedAt: null, ...data, publication: { title: bai.title, doi: bai.doi } };
        deNghi.set(d.id, d);
        return d;
      }),
      findUnique: vi.fn(async ({ where }: any) => deNghi.get(where.id) ?? null),
      findMany: vi.fn(async () => [...deNghi.values()]),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const d = deNghi.get(where.id);
        if (!d || d.status !== where.status) return { count: 0 };
        Object.assign(d, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(deNghi.get(where.id), data)),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => audit.push(data)) },
  };
  const bus = { emit: vi.fn() };
  const scholar = { apDeNghiSua: vi.fn(async () => undefined) };
  const svc = new DeNghiSuaService(prisma as any, bus as any, scholar as any);
  return { svc, prisma, bus, scholar, deNghi, audit };
}

const GV = RoleName.Lecturer;
const LY_DO = 'Bài thuộc Q2 năm 2025 theo SCImago, không phải Q3.';

describe('Đề nghị chỉnh sửa — gửi', () => {
  it('chỉ ghi trường THẬT SỰ khác, gửi người khai kèm lý do + tên người gửi', async () => {
    const { svc, bus, deNghi } = dung();
    const kq = await svc.tao('gui', GV, 'p1', { reason: LY_DO, changes: { catalogCode: '1.1b', publishedYear: 2025 } });
    expect(kq.status).toBe('PENDING');
    expect(deNghi.get(kq.id).changes).toEqual({ catalogCode: { tu: '1.1c', sang: '1.1b' } });
    expect(bus.emit).toHaveBeenCalledWith('publication.edit-requested', expect.objectContaining({
      id: 'p1', key: kq.id, emails: ['khai@hcmus.edu.vn'], note: LY_DO, by: 'Trần Thị Bình',
    }));
  });

  it('người khai tự gửi → bảo sửa thẳng', async () => {
    const { svc } = dung();
    await expect(svc.tao('khai', GV, 'p1', { reason: LY_DO, changes: {} })).rejects.toMatchObject({ status: 422 });
  });

  it('đã có đề nghị đang mở cho bài này → 409', async () => {
    const { svc } = dung();
    await svc.tao('gui', GV, 'p1', { reason: LY_DO, changes: { catalogCode: '1.1b' } });
    await expect(svc.tao('gui', GV, 'p1', { reason: LY_DO, changes: {} })).rejects.toMatchObject({ status: 409 });
  });

  it('không còn người khai hợp lệ → chuyển thẳng Khoa, không báo ai', async () => {
    const { svc, bus } = dung({ khaiXacNhan: false });
    const kq = await svc.tao('gui', GV, 'p1', { reason: LY_DO, changes: { catalogCode: '1.1b' } });
    expect(kq.status).toBe('ESCALATED');
    expect(bus.emit).not.toHaveBeenCalled();
  });
});

describe('Đề nghị chỉnh sửa — quyết', () => {
  let t: ReturnType<typeof dung>;
  let id: string;
  beforeEach(async () => {
    t = dung();
    id = (await t.svc.tao('gui', GV, 'p1', { reason: LY_DO, changes: { catalogCode: '1.1b' } })).id;
    t.bus.emit.mockClear();
  });

  it('người khai chấp nhận → áp giá trị đề nghị, báo người gửi, ghi nhật ký', async () => {
    const kq = await t.svc.chapNhan('khai', GV, id, 'Đúng, cảm ơn.');
    expect(kq.status).toBe('ACCEPTED');
    expect(t.scholar.apDeNghiSua).toHaveBeenCalledWith('p1', 'khai', { catalogCode: '1.1b' });
    expect(t.bus.emit).toHaveBeenCalledWith('publication.edit-request-decided', expect.objectContaining({
      key: 'ACCEPTED', emails: ['gui@hcmus.edu.vn'], by: 'Nguyễn Văn An',
    }));
    expect(t.audit.map((a) => a.changes.viec)).toEqual(['gui', 'chap-nhan']);
  });

  it('người lạ, và Khoa khi đề nghị còn mới (người khai chưa hết 7 ngày) → không quyết được', async () => {
    await expect(t.svc.chapNhan('la', GV, id)).rejects.toMatchObject({ status: 403 });
    await expect(t.svc.chapNhan('qt', GV, id)).rejects.toMatchObject({ status: 403 });
  });

  it('quá 7 ngày người khai im lặng → Khoa quyết được', async () => {
    t.deNghi.get(id).createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const kq = await t.svc.chapNhan('qt', GV, id);
    expect(kq.status).toBe('ACCEPTED');
  });

  it('người khai từ chối (bắt buộc lời đáp) → bên đề nghị chuyển Khoa → chỉ Khoa quyết, người khai hết quyền', async () => {
    await t.svc.tuChoi('khai', GV, id, 'Tạp chí xếp Q3 ở năm chấp nhận.');
    const r = await t.svc.chuyenKhoa('gui', GV, id, 'Năm chấp nhận là 2025, SCImago 2025 xếp Q2.');
    expect(r.status).toBe('ESCALATED');
    await expect(t.svc.chapNhan('khai', GV, id)).rejects.toMatchObject({ status: 403 });
    const kq = await t.svc.chapNhan('qt', GV, id, 'Khoa đối chiếu SCImago: Q2.');
    expect(kq.status).toBe('ACCEPTED');
    expect(kq.history.map((b) => b.viec)).toEqual(['gui', 'tu-choi', 'chuyen-khoa', 'chap-nhan']);
  });

  it('Khoa đã từ chối thì không chuyển tiếp được nữa', async () => {
    t.deNghi.get(id).createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await t.svc.tuChoi('qt', GV, id, 'Khoa giữ mã Q3 theo bảng năm công bố.');
    await expect(t.svc.chuyenKhoa('gui', GV, id)).rejects.toMatchObject({ status: 422 });
  });

  it('chưa bị từ chối, chưa quá hạn → chưa chuyển Khoa được', async () => {
    await expect(t.svc.chuyenKhoa('gui', GV, id)).rejects.toMatchObject({ status: 422 });
  });

  it('hai người quyết cùng lúc → người sau nhận 409, bài chỉ áp một lần', async () => {
    t.deNghi.get(id).createdAt = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const cu = { ...t.deNghi.get(id) };
    await t.svc.chapNhan('khai', GV, id);
    t.prisma.publicationEditRequest.findUnique.mockResolvedValueOnce(cu); // người thứ hai đọc bản cũ
    await expect(t.svc.chapNhan('qt', GV, id)).rejects.toMatchObject({ status: 409 });
    expect(t.scholar.apDeNghiSua).toHaveBeenCalledTimes(1);
  });

  it('áp hỏng → đề nghị trở lại chờ, không để "đã chấp nhận" mà bài không đổi', async () => {
    t.scholar.apDeNghiSua.mockRejectedValueOnce(new Error('db'));
    await expect(t.svc.chapNhan('khai', GV, id)).rejects.toThrow('db');
    expect(t.deNghi.get(id).status).toBe('PENDING');
  });

  it('người gửi rút được khi còn mở; người khác không rút được', async () => {
    await expect(t.svc.rut('khai', GV, id)).rejects.toMatchObject({ status: 403 });
    expect((await t.svc.rut('gui', GV, id)).status).toBe('WITHDRAWN');
  });

  it('quyền hiển thị đúng theo người xem', async () => {
    const xemKhai = await t.svc.mot(id, 'khai', GV);
    expect(xemKhai.quyen).toEqual({ quyet: true, rut: false, chuyenKhoa: false });
    const xemGui = await t.svc.mot(id, 'gui', GV);
    expect(xemGui.quyen).toEqual({ quyet: false, rut: true, chuyenKhoa: false });
  });
});
