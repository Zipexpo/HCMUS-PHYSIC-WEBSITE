import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffPageService } from './staff-page.service';

// Không kéo cấu hình môi trường của dịch vụ revalidate vào test.
vi.mock('../shared/services/public-revalidate.service', () => ({
  PublicRevalidateService: class {},
}));

const templateTree = () => ({
  root: { props: { title: 'CN. Người Mẫu' } },
  zones: {},
  content: [
    { type: 'Header', props: { id: 'h1' } },
    {
      type: 'StaffProfileEditorial',
      props: {
        id: 'body-x',
        name: { vi: 'CN. Người Mẫu' },
        email: 'old@hcmus.edu.vn',
      },
    },
    { type: 'Footer', props: { id: 'f1' } },
  ],
});

const DU = {
  email: 'nghdu@hcmus.edu.vn',
  firstName: 'Du',
  lastName: 'Ngô Huỳnh',
  degree: 'CN',
  role: 'LECTURER',
  department: { id: 'dept1', slug: 'van-phong-khoa', kind: 'unit' } as {
    id: string;
    slug: string;
    kind: string;
  } | null,
  scholarProfile: null as null | { staffPageSlug: string | null },
};

type Opts = {
  user?: Partial<typeof DU> | null;
  templateRows?: Array<{ puckData: unknown; publishedPuckData: unknown }>;
  takenRows?: Array<{ slug: string }>;
  aliveRow?: { id: string } | null;
  emailRows?: Array<{ slug: string }>;
};

function build(opts: Opts = {}) {
  const {
    user = {},
    templateRows = [{ puckData: null, publishedPuckData: templateTree() }],
    takenRows = [],
    aliveRow = null,
    emailRows = [],
  } = opts;

  const create = vi.fn().mockResolvedValue({ id: 'page1' });
  const upsert = vi.fn().mockResolvedValue({});
  const queryRaw = vi.fn().mockResolvedValue(emailRows);
  const findMany = vi.fn(
    async (args: { where?: { slug?: { in?: string[] } } }) => {
      // freeStaffSlug hỏi slug ∈ [...]; pickStaffTemplate hỏi startsWith/contains.
      if (args?.where?.slug?.in) return takenRows;
      return templateRows;
    },
  );
  const prisma = {
    $queryRaw: queryRaw,
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(user === null ? null : { ...DU, ...user }),
    },
    pageLayout: {
      findFirst: vi.fn().mockResolvedValue(aliveRow),
      findMany,
      create,
    },
    scholarProfile: { upsert },
  };
  const cache = { get: vi.fn(), set: vi.fn(), clear: vi.fn() };
  const revalidate = { trigger: vi.fn() };
  const bus = { emit: vi.fn() };
  const svc = new StaffPageService(
    prisma as never,
    cache as never,
    revalidate as never,
    bus as never,
  );
  return {
    svc,
    create,
    upsert,
    findMany,
    queryRaw,
    prisma,
    cache,
    revalidate,
    bus,
  };
}

describe('StaffPageService.ensureStaffPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tạo trang + nối hồ sơ cho người đủ điều kiện chưa có trang', async () => {
    const { svc, create, upsert } = build();
    const r = await svc.ensureStaffPage('u1');
    expect(r).toEqual({
      created: true,
      reason: 'da-tao',
      slug: 'van-phong-khoa/nhan-su/cn-ngo-huynh-du',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.slug).toBe('van-phong-khoa/nhan-su/cn-ngo-huynh-du');
    expect(data.isPublished).toBe(true);
    expect(data.departmentId).toBe('dept1');
    expect(data.createdBy).toBe('u1');
    expect(data.puckData).toBeTruthy();
    expect(data.publishedPuckData).toBeTruthy();
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: {
        userId: 'u1',
        staffPageSlug: 'van-phong-khoa/nhan-su/cn-ngo-huynh-du',
        showOnWeb: true,
      },
      update: { staffPageSlug: 'van-phong-khoa/nhan-su/cn-ngo-huynh-du' },
    });
  });

  it('dryRun chỉ tính slug, không ghi', async () => {
    const { svc, create, upsert } = build();
    const r = await svc.ensureStaffPage('u1', { dryRun: true });
    expect(r).toEqual({
      created: false,
      reason: 'se-tao',
      slug: 'van-phong-khoa/nhan-su/cn-ngo-huynh-du',
    });
    expect(create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('người trùng tên cùng bộ môn nhận slug có hậu tố', async () => {
    const { svc, create } = build({
      takenRows: [{ slug: 'van-phong-khoa/nhan-su/cn-ngo-huynh-du' }],
    });
    const r = await svc.ensureStaffPage('u1');
    expect(r.slug).toBe('van-phong-khoa/nhan-su/cn-ngo-huynh-du-2');
    expect(create.mock.calls[0][0].data.slug).toBe(
      'van-phong-khoa/nhan-su/cn-ngo-huynh-du-2',
    );
  });

  it('đã nối trang còn sống thì bỏ qua', async () => {
    const { svc, create } = build({
      user: { scholarProfile: { staffPageSlug: 'van-phong-khoa/nhan-su/cu' } },
      aliveRow: { id: 'p9' },
    });
    const r = await svc.ensureStaffPage('u1');
    expect(r).toEqual({
      created: false,
      reason: 'da-co-trang',
      slug: 'van-phong-khoa/nhan-su/cu',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('đã có trang theo email (chưa nối) thì NỐI, không tạo trùng', async () => {
    const { svc, create, upsert } = build({
      emailRows: [{ slug: 'vat-ly-dien-tu/nhan-su/ths-ha-minh-khue' }],
    });
    const r = await svc.ensureStaffPage('u1');
    expect(r).toEqual({
      created: false,
      reason: 'noi-trang-co-san',
      slug: 'vat-ly-dien-tu/nhan-su/ths-ha-minh-khue',
    });
    expect(create).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: {
        userId: 'u1',
        staffPageSlug: 'vat-ly-dien-tu/nhan-su/ths-ha-minh-khue',
        showOnWeb: true,
      },
      update: { staffPageSlug: 'vat-ly-dien-tu/nhan-su/ths-ha-minh-khue' },
    });
  });

  it('dryRun: có trang theo email → se-noi-trang-co-san, không ghi', async () => {
    const { svc, create, upsert } = build({
      emailRows: [{ slug: 'vat-ly-dien-tu/nhan-su/ths-ha-minh-khue' }],
    });
    const r = await svc.ensureStaffPage('u1', { dryRun: true });
    expect(r.reason).toBe('se-noi-trang-co-san');
    expect(create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('link trỏ trang đã xoá thì vẫn dựng lại', async () => {
    const { svc, create } = build({
      user: {
        scholarProfile: { staffPageSlug: 'van-phong-khoa/nhan-su/da-xoa' },
      },
      aliveRow: null, // trang không còn
    });
    const r = await svc.ensureStaffPage('u1');
    expect(r.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua đơn vị không liệt kê', async () => {
    const { svc, create } = build({
      user: { department: { id: 'd', slug: 'clb-abc', kind: 'club' } },
    });
    const r = await svc.ensureStaffPage('u1');
    expect(r).toEqual({ created: false, reason: 'don-vi-khong-liet-ke-club' });
    expect(create).not.toHaveBeenCalled();
  });

  it('người thật có họ trùng từ đơn vị (Đoàn/Ban…) VẪN được tạo', async () => {
    // Trước đây guard theo tên chặn nhầm "Đoàn Thị Hiền"; nay chỉ lọc theo role.
    const { svc, create } = build({
      user: { firstName: 'Hiền', lastName: 'Đoàn Thị', scholarProfile: null },
    });
    const r = await svc.ensureStaffPage('u1');
    expect(r.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua tài khoản không phải cán bộ (ADMIN / super-admin / dịch vụ)', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      const { svc, create } = build({ user: { role } });
      const r = await svc.ensureStaffPage('u1');
      expect(r).toEqual({ created: false, reason: 'khong-phai-can-bo' });
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('không có trang mẫu hợp lệ thì không tạo', async () => {
    const { svc, create } = build({
      templateRows: [{ puckData: { content: [] }, publishedPuckData: null }],
    });
    const r = await svc.ensureStaffPage('u1');
    expect(r).toEqual({ created: false, reason: 'khong-co-trang-mau' });
    expect(create).not.toHaveBeenCalled();
  });

  it('chưa có đơn vị thì bỏ qua', async () => {
    const { svc, create } = build({ user: { department: null } });
    const r = await svc.ensureStaffPage('u1');
    expect(r).toEqual({ created: false, reason: 'chua-co-don-vi' });
    expect(create).not.toHaveBeenCalled();
  });
});
