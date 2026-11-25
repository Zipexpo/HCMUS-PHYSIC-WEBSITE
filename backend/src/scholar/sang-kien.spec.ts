import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { CreateSangKienBodySchema, UpdateSangKienBodySchema } from './sang-kien.model';
import { SangKienService, chuanHoaMaSangKien, dungDanhSachTacGia } from './sang-kien.service';

/**
 * Sáng kiến khai giống bài báo (Khoa yêu cầu 25/11/2026): một mã một bản ghi,
 * người được gắn tên tự xác nhận, không ai gỡ được tên người khác đã xác nhận.
 */

// ── CSDL giả trong bộ nhớ — chỉ đủ các lệnh SangKienService dùng ─────────────
type Init = {
  id: string;
  code: string;
  title: string;
  level: string;
  decisionNo: string;
  decisionDate: Date | null;
  category: string | null;
  note: string | null;
  url: string | null;
  reviewStatus: string;
  approvedSnapshot: unknown;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  source: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
type Author = {
  id: string;
  initiativeId: string;
  position: number;
  userId: string | null;
  externalName: string | null;
  externalOrg: string | null;
  claimStatus: 'CONFIRMED' | 'PENDING' | 'REJECTED';
  invitedBy: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const NGUOI: Record<string, { firstName: string; lastName: string; email: string }> = {
  u1: { firstName: 'An', lastName: 'Nguyễn Văn', email: 'an@hcmus.edu.vn' },
  u2: { firstName: 'Bình', lastName: 'Trần Thị', email: 'binh@hcmus.edu.vn' },
  u3: { firstName: 'Cường', lastName: 'Lê Văn', email: 'cuong@hcmus.edu.vn' },
  u4: { firstName: 'Dung', lastName: 'Phạm Thị', email: 'dung@hcmus.edu.vn' },
};

function taoCsdl() {
  const inits: Init[] = [];
  const authors: Author[] = [];
  let seq = 0;
  let clock = Date.UTC(2026, 10, 25, 1, 0, 0);
  const now = () => new Date((clock += 1000));
  const id = (p: string) => `${p}${++seq}`;

  const day = (i: Init) => ({
    ...i,
    authors: authors
      .filter((a) => a.initiativeId === i.id)
      .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
      .map((a) => ({
        ...a,
        user: a.userId
          ? { ...NGUOI[a.userId], department: { name: 'Bộ môn Vật lý Ứng dụng' } }
          : null,
      })),
  });
  const khop = (i: Init, w: Record<string, unknown>) =>
    (w.id === undefined || i.id === w.id) &&
    (w.code === undefined || i.code === w.code) &&
    (!('deletedAt' in w) || (w.deletedAt === null ? i.deletedAt === null : true));
  const khopTg = (a: Author, w: Record<string, any>) =>
    (w.id === undefined || (typeof w.id === 'string' ? a.id === w.id : w.id.in.includes(a.id))) &&
    (w.initiativeId === undefined || a.initiativeId === w.initiativeId) &&
    (!('userId' in w) || a.userId === w.userId) &&
    (!('showOnWeb' in w) || (a as Author & { showOnWeb?: boolean }).showOnWeb !== false === w.showOnWeb) &&
    (w.claimStatus === undefined || a.claimStatus === w.claimStatus);

  const prisma: any = {
    initiative: {
      findUnique: vi.fn(async ({ where }) => {
        const i = inits.find((x) => khop(x, where));
        return i ? day(i) : null;
      }),
      findFirst: vi.fn(async ({ where }) => {
        const i = inits.find((x) => khop(x, where));
        return i ? day(i) : null;
      }),
      findMany: vi.fn(async () => inits.map(day)),
      create: vi.fn(async ({ data }) => {
        const t = now();
        const i: Init = {
          id: id('sk'),
          level: 'CO_SO',
          decisionDate: null,
          category: null,
          note: null,
          url: null,
          reviewStatus: 'PENDING',
          approvedSnapshot: null,
          reviewNote: null,
          reviewedBy: null,
          reviewedAt: null,
          source: 'manual',
          createdBy: null,
          deletedAt: null,
          ...data,
          createdAt: t,
          updatedAt: t,
        };
        inits.push(i);
        return i;
      }),
      update: vi.fn(async ({ where, data }) => {
        const i = inits.find((x) => x.id === where.id)!;
        // Prisma.DbNull = ghi NULL vào cột Json; bản chụp đi qua JSON như CSDL thật.
        const d = Object.fromEntries(
          Object.entries(data).map(([k, v]) => [
            k,
            v === Prisma.DbNull ? null : k === 'approvedSnapshot' ? JSON.parse(JSON.stringify(v)) : v,
          ]),
        );
        Object.assign(i, d, { updatedAt: now() });
        return i;
      }),
    },
    initiativeAuthor: {
      createMany: vi.fn(async ({ data }) => {
        for (const d of data) {
          if (d.userId && authors.some((a) => a.initiativeId === d.initiativeId && a.userId === d.userId)) {
            throw new Error('unique (initiativeId, userId)');
          }
          const t = now();
          authors.push({
            id: id('a'),
            position: 0,
            userId: null,
            externalName: null,
            externalOrg: null,
            claimStatus: 'PENDING',
            invitedBy: null,
            respondedAt: null,
            ...d,
            createdAt: t,
            updatedAt: t,
          });
        }
        return { count: data.length };
      }),
      create: vi.fn(async ({ data }) => prisma.initiativeAuthor.createMany({ data: [data] })),
      findMany: vi.fn(async ({ where }) => {
        const { initiative, ...w } = where;
        return authors
          .filter((a) => khopTg(a, w))
          .map((a) => ({ ...a, init: inits.find((i) => i.id === a.initiativeId)! }))
          .filter(
            (a) =>
              !initiative ||
              (a.init.deletedAt === null &&
                (!initiative.reviewStatus || initiative.reviewStatus.in.includes(a.init.reviewStatus))),
          )
          .map(({ init, ...a }) => ({ ...a, initiative: day(init) }));
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const bo = authors.filter((a) => khopTg(a, where));
        bo.forEach((a) => authors.splice(authors.indexOf(a), 1));
        return { count: bo.length };
      }),
      delete: vi.fn(async ({ where }) => prisma.initiativeAuthor.deleteMany({ where })),
      update: vi.fn(async ({ where, data }) => {
        const a = authors.find((x) => x.id === where.id)!;
        Object.assign(a, data, { updatedAt: now() });
        return a;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const { initiative, ...w } = where;
        const ds = authors.filter(
          (a) => khopTg(a, w) && (!initiative || inits.find((i) => i.id === a.initiativeId)?.deletedAt === null),
        );
        ds.forEach((a) => Object.assign(a, data, { updatedAt: now() }));
        return { count: ds.length };
      }),
    },
    user: {
      count: vi.fn(async ({ where }) => where.id.in.filter((x: string) => NGUOI[x]).length),
      findMany: vi.fn(async ({ where }) =>
        where.id.in.filter((x: string) => NGUOI[x]).map((x: string) => ({ id: x, ...NGUOI[x] })),
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const bus = { emit: vi.fn() };
  const svc = new SangKienService(prisma, bus as never);
  return { svc, prisma, bus, inits, authors };
}

const khai = (over: Record<string, unknown> = {}) =>
  CreateSangKienBodySchema.parse({
    code: 'SK2026-000123',
    title: 'Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm',
    decisionNo: '3771/QĐ-KHTN',
    decisionDate: '2026-11-20',
    ...over,
  });

const loi = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { getResponse: () => { message: Array<{ field: string; error: string }> } }).getResponse()
      .message[0];
  }
  throw new Error('không ném lỗi');
};

// ── Thuần ───────────────────────────────────────────────────────────────────
describe('chuanHoaMaSangKien', () => {
  it('bỏ khoảng trắng, chữ hoa, gạch nối Unicode về «-»', () => {
    expect(chuanHoaMaSangKien(' sk2026 – 000123 ')).toBe('SK2026-000123');
    expect(chuanHoaMaSangKien('SK2026—000123')).toBe('SK2026-000123');
  });
  it('KHÔNG tự đổi O↔0 (bản quét hay lẫn nhưng đoán là đè lên mã thật)', () => {
    expect(chuanHoaMaSangKien('SK2026-O00123')).toBe('SK2026-O00123');
  });
  it('ô trống / quá ngắn không phải mã', () => {
    for (const x of ['', '  ', 'a', null, undefined]) expect(chuanHoaMaSangKien(x)).toBeNull();
  });
});

describe('dungDanhSachTacGia', () => {
  it('giữ thứ tự, bỏ tài khoản trùng, thêm người khai vào CUỐI khi tạo mới', () => {
    const ds = dungDanhSachTacGia(
      [{ userId: 'u2' }, { externalName: 'Võ Minh Khoa', externalOrg: 'SV K22' }, { userId: 'u2' }],
      'u1',
      true,
    );
    expect(ds).toEqual([
      { kind: 'user', userId: 'u2', position: 0 },
      { kind: 'ngoai', externalName: 'Võ Minh Khoa', externalOrg: 'SV K22', position: 1 },
      { kind: 'user', userId: 'u1', position: 2 },
    ]);
  });
  it('người khai đã có trong danh sách thì không thêm lần hai', () => {
    expect(dungDanhSachTacGia([{ userId: 'u1' }, { userId: 'u2' }], 'u1', true)).toHaveLength(2);
  });
});

describe('lược đồ', () => {
  it('mã số, số QĐ, ngày QĐ là bắt buộc; cấp mặc định cơ sở', () => {
    expect(CreateSangKienBodySchema.safeParse({ title: 'x', decisionNo: '1', decisionDate: '2026-11-20' }).success).toBe(false);
    expect(CreateSangKienBodySchema.safeParse({ code: 'SK1', title: 'x', decisionDate: '2026-11-20' }).success).toBe(false);
    expect(CreateSangKienBodySchema.safeParse({ code: 'SK1', title: 'x', decisionNo: '1' }).success).toBe(false);
    expect(khai().level).toBe('CO_SO');
    expect(khai({ level: 'TOAN_QUOC' }).level).toBe('TOAN_QUOC');
    expect(CreateSangKienBodySchema.safeParse({ ...khai(), decisionDate: '2026-11-20', level: 'TRUONG' }).success).toBe(false);
  });
  it('PATCH không gửi ghi chú thì KHÔNG có khoá note (bẫy Zod 4 transform/default)', () => {
    const b = UpdateSangKienBodySchema.parse({ title: 'Tên mới' });
    expect(Object.keys(b)).toEqual(['title']);
  });
  it('dòng tác giả phải có người hoặc tên', () => {
    expect(CreateSangKienBodySchema.safeParse({ ...khai(), decisionDate: '2026-11-20', authors: [{}] }).success).toBe(false);
  });
});

// ── Khai ────────────────────────────────────────────────────────────────────
describe('create', () => {
  it('người khai CONFIRMED, đồng nghiệp PENDING, người ngoài chỉ là tên — đúng thứ tự', async () => {
    const { svc, bus } = taoCsdl();
    const kq = await svc.create(
      'u1',
      khai({
        code: 'sk2026-000123',
        authors: [{ userId: 'u2' }, { userId: 'u1' }, { externalName: 'Võ Minh Khoa', externalOrg: 'Khoa Vật lý' }],
      }),
    );
    expect(kq.code).toBe('SK2026-000123');
    expect(kq.decisionDate).toBe('2026-11-20');
    expect(kq.myStatus).toBe('CONFIRMED');
    expect(kq.createdByName).toBe('Nguyễn Văn An');
    expect(kq.authors.map((a) => [a.position, a.displayName, a.claimStatus, a.invitedBy])).toEqual([
      [0, 'Trần Thị Bình', 'PENDING', 'u1'],
      [1, 'Nguyễn Văn An', 'CONFIRMED', null],
      [2, 'Võ Minh Khoa', null, null],
    ]);
    expect(bus.emit).toHaveBeenCalledWith('initiative.changed', { id: kq.id, userIds: ['u2', 'u1'] });
  });

  it('mã đã có → KHÔNG tạo bản thứ hai, báo tên sáng kiến + người khai', async () => {
    const { svc, inits } = taoCsdl();
    await svc.create('u1', khai());
    const e = await loi(svc.create('u2', khai({ code: 'SK2026 - 000123', title: 'Bản khai lại' })));
    expect(e.field).toBe('code');
    expect(e.error).toContain('Hệ đo phổ huỳnh quang');
    expect(e.error).toContain('Nguyễn Văn An');
    expect(inits).toHaveLength(1);
  });

  it('mã của bản đã xoá → dựng lại trên chính bản đó (giữ id)', async () => {
    const { svc, inits } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u2' }] }));
    await svc.remove('u1', a.id);
    expect(inits[0].deletedAt).not.toBeNull();
    const b = await svc.create('u3', khai({ title: 'Khai lại' }));
    expect(b.id).toBe(a.id);
    expect(inits).toHaveLength(1);
    expect(b.title).toBe('Khai lại');
    expect(b.authors.map((x) => x.userId)).toEqual(['u3']);
  });

  it('tài khoản không tồn tại → báo lỗi, không ghi gì', async () => {
    const { svc, inits } = taoCsdl();
    const e = await loi(svc.create('u1', khai({ authors: [{ userId: 'ma' }] })));
    expect(e.field).toBe('authors');
    expect(inits).toHaveLength(0);
  });
});

// ── Sửa ─────────────────────────────────────────────────────────────────────
describe('update', () => {
  it('người chưa xác nhận không sửa được', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    await expect(svc.update('u2', a.id, { title: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(svc.update('u3', a.id, { title: 'x' })).rejects.toMatchObject({ status: 403 });
  });

  it('sửa một trường không đụng trường khác', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ note: 'Ghi chú cũ' }));
    const b = await svc.update('u1', a.id, UpdateSangKienBodySchema.parse({ title: 'Tên mới' }));
    expect(b.title).toBe('Tên mới');
    expect(b.note).toBe('Ghi chú cũ');
    const c = await svc.update('u1', a.id, UpdateSangKienBodySchema.parse({ note: '' }));
    expect(c.note).toBeNull();
  });

  it('đổi thứ tự giữ nguyên trạng thái xác nhận; mời người mới; thay dòng người ngoài', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }, { externalName: 'SV A' }] }));
    await svc.traLoiMoi('u2', a.id, true);
    const b = await svc.update('u1', a.id, {
      authors: [{ userId: 'u2' }, { externalName: 'SV B' }, { userId: 'u1' }, { userId: 'u3' }],
    });
    expect(b.authors.map((x) => [x.displayName, x.claimStatus])).toEqual([
      ['Trần Thị Bình', 'CONFIRMED'],
      ['SV B', null],
      ['Nguyễn Văn An', 'CONFIRMED'],
      ['Lê Văn Cường', 'PENDING'],
    ]);
  });

  it('KHÔNG gỡ được tên người khác đã xác nhận', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    await svc.traLoiMoi('u2', a.id, true);
    const e = await loi(svc.update('u1', a.id, { authors: [{ userId: 'u1' }] }));
    expect(e.error).toContain('Trần Thị Bình');
    expect(e.error).toContain('chỉ chính họ');
  });

  it('lời mời đang chờ: người mời rút được, đồng tác giả khác thì không', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }] }));
    await svc.traLoiMoi('u2', a.id, true);
    // u2 (đã xác nhận) muốn bỏ u3 do u1 mời → chặn
    const e = await loi(svc.update('u2', a.id, { authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    expect(e.error).toContain('Lê Văn Cường');
    // u1 tự rút lời mời của mình → được
    const b = await svc.update('u1', a.id, { authors: [{ userId: 'u1' }, { userId: 'u2' }] });
    expect(b.authors.map((x) => x.userId)).toEqual(['u1', 'u2']);
  });

  it('bỏ tên chính mình qua form → bảo dùng «Rút tên»', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai());
    const e = await loi(svc.update('u1', a.id, { authors: [{ externalName: 'Ai đó' }] }));
    expect(e.error).toContain('Rút tên');
  });

  it('đổi sang mã của sáng kiến khác đang sống → chặn', async () => {
    const { svc } = taoCsdl();
    await svc.create('u1', khai({ code: 'SK2026-000001', title: 'Sáng kiến một' }));
    const b = await svc.create('u1', khai({ code: 'SK2026-000002' }));
    const e = await loi(svc.update('u1', b.id, { code: 'sk2026-000001' }));
    expect(e.error).toContain('Sáng kiến một');
  });
});

// ── Rút tên, gắn tên, lời mời ──────────────────────────────────────────────
describe('remove / nhanTen / traLoiMoi', () => {
  it('còn người khác đã xác nhận → chỉ dòng mình thành REJECTED; còn mình mình → xoá mềm', async () => {
    const { svc, inits, authors } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    await svc.traLoiMoi('u2', a.id, true);
    expect(await svc.remove('u1', a.id)).toEqual({ removed: true, sharedWithOthers: true });
    expect(authors.find((x) => x.userId === 'u1')?.claimStatus).toBe('REJECTED');
    expect(inits[0].deletedAt).toBeNull();
    expect(await svc.remove('u2', a.id)).toEqual({ removed: true, sharedWithOthers: false });
    expect(inits[0].deletedAt).not.toBeNull();
  });

  it('gắn tên: nhận một dòng người ngoài → dòng đó thành của mình, giữ thứ tự', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ externalName: 'Võ Hồng Hải', externalOrg: 'Khoa Vật lý' }, { userId: 'u1' }] }));
    const ngoai = a.authors[0];
    const b = await svc.nhanTen('u4', a.id, ngoai.id);
    expect(b.authors.map((x) => [x.position, x.userId, x.claimStatus])).toEqual([
      [0, 'u4', 'CONFIRMED'],
      [1, 'u1', 'CONFIRMED'],
    ]);
    // Dòng đã có tài khoản thì không nhận được nữa
    const e = await loi(svc.nhanTen('u3', a.id, ngoai.id));
    expect(e.field).toBe('authorId');
  });

  it('gắn tên khi đang có lời mời → coi như xác nhận; chưa có tên → thêm vào cuối', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    const b = await svc.nhanTen('u2', a.id);
    expect(b.authors.find((x) => x.userId === 'u2')?.claimStatus).toBe('CONFIRMED');
    const c = await svc.nhanTen('u3', a.id);
    expect(c.authors.map((x) => x.userId)).toEqual(['u1', 'u2', 'u3']);
  });

  it('lời mời: danh sách kèm tên người mời; trả lời xong thì hết', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    const ds = await svc.loiMoi('u2');
    expect(ds.items).toHaveLength(1);
    expect(ds.items[0]).toMatchObject({ initiativeId: a.id, invitedByName: 'Nguyễn Văn An' });
    expect(ds.items[0].authors).toEqual(['Nguyễn Văn An', 'Trần Thị Bình']);
    await svc.traLoiMoi('u2', a.id, false);
    await expect(svc.traLoiMoi('u2', a.id, true)).rejects.toMatchObject({ status: 404 });
  });
});

// ── Khoa duyệt (người dùng chốt 25/11/2026) ────────────────────────────────
describe('Khoa duyệt', () => {
  /** Như bản Khoa nạp từ quyết định: APPROVED, mọi người đã xác nhận. */
  async function banNap() {
    const db = taoCsdl();
    const a = await db.svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }, { externalName: 'Võ Hồng Hải' }] }));
    await db.svc.traLoiMoi('u2', a.id, true);
    Object.assign(db.inits[0], { reviewStatus: 'APPROVED', source: 'import' });
    return { ...db, id: a.id };
  }

  it('tác giả khai mới → chờ duyệt', async () => {
    const { svc } = taoCsdl();
    expect((await svc.create('u1', khai())).reviewStatus).toBe('PENDING');
  });

  it('sửa ghi chú / liên kết: KHÔNG phải duyệt lại', async () => {
    const { svc, id } = await banNap();
    const b = await svc.update('u1', id, UpdateSangKienBodySchema.parse({ note: 'thêm minh chứng', url: 'https://x' }));
    expect(b.reviewStatus).toBe('APPROVED');
  });

  it('sửa nội dung → chờ duyệt, kèm chỗ đổi so với bản đã duyệt', async () => {
    const { svc, id } = await banNap();
    const b = await svc.update('u2', id, { title: 'Tên đã sửa', code: 'SK2026-000124' });
    expect(b.reviewStatus).toBe('PENDING');
    expect(b.thayDoi).toEqual([
      { truong: 'Mã số', tu: 'SK2026-000123', sang: 'SK2026-000124' },
      { truong: 'Tên sáng kiến', tu: 'Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm', sang: 'Tên đã sửa' },
    ]);
    // Sửa tiếp khi đang chờ: vẫn so với bản Khoa duyệt gần nhất
    const c = await svc.update('u2', id, { title: 'Tên sửa lần hai' });
    expect(c.thayDoi.find((x) => x.truong === 'Tên sáng kiến')?.tu).toBe('Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm');
  });

  it('xác nhận lời mời / rút tên KHÔNG bắt duyệt lại; gắn tên vào dòng người ngoài thì có', async () => {
    const { svc, id, inits } = await banNap();
    await svc.remove('u2', id);
    expect(inits[0].reviewStatus).toBe('APPROVED');
    const b = await svc.nhanTen('u4', id, (await svc.findOne(id, 'u4')).authors[2].id);
    expect(b.reviewStatus).toBe('PENDING');
    expect(b.thayDoi.map((x) => x.truong)).toEqual(['Tác giả']);
  });

  it('Khoa duyệt bản sửa → APPROVED, hết bản chụp', async () => {
    const { svc, id, inits } = await banNap();
    await svc.update('u1', id, { title: 'Tên đã sửa' });
    const b = await svc.duyet('admin', id, true);
    expect(b.reviewStatus).toBe('APPROVED');
    expect(b.title).toBe('Tên đã sửa');
    expect(b.thayDoi).toEqual([]);
    expect(inits[0].approvedSnapshot).toBeNull();
    expect(inits[0].reviewedBy).toBe('admin');
  });

  it('Khoa KHÔNG duyệt bản sửa → trả lại nguyên bản đã duyệt, giữ lý do', async () => {
    const { svc, id } = await banNap();
    await svc.update('u1', id, {
      title: 'Tên sai',
      authors: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }],
    });
    const b = await svc.duyet('admin', id, false, 'Quyết định ghi tên khác');
    expect(b.reviewStatus).toBe('APPROVED');
    expect(b.reviewNote).toBe('Quyết định ghi tên khác');
    expect(b.title).toBe('Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm');
    expect(b.authors.map((a) => [a.displayName, a.claimStatus])).toEqual([
      ['Nguyễn Văn An', 'CONFIRMED'],
      ['Trần Thị Bình', 'CONFIRMED'],
      ['Võ Hồng Hải', null],
    ]);
  });

  it('sáng kiến khai mới bị từ chối → REJECTED; tác giả sửa lại → chờ duyệt', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai());
    expect((await loi(svc.duyet('admin', a.id, false, ''))).field).toBe('note');
    expect((await svc.duyet('admin', a.id, false, 'Sai số quyết định')).reviewStatus).toBe('REJECTED');
    expect((await svc.update('u1', a.id, { decisionNo: '3771/QĐ-KHTN ' + 'x' })).reviewStatus).toBe('PENDING');
  });

  it('chỉ duyệt được sáng kiến đang chờ', async () => {
    const { svc, id } = await banNap();
    expect((await loi(svc.duyet('admin', id, true))).field).toBe('id');
  });

  it('đang chờ duyệt bản sửa: kênh tích hợp vẫn gửi BẢN ĐÃ DUYỆT; duyệt xong mới đổi', async () => {
    const { svc, id } = await banNap();
    await svc.update('u1', id, { title: 'Tên đã sửa', authors: [{ userId: 'u1' }, { userId: 'u3' }, { userId: 'u2' }] });
    await svc.traLoiMoi('u3', id, true);
    const truoc = (await svc.integrationList({})).items as Array<Record<string, unknown>>;
    expect(truoc.map((x) => [x.email, x.title, x.reviewStatus, x.position, x.totalAuthors])).toEqual([
      ['an@hcmus.edu.vn', 'Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm', 'APPROVED', 1, 3],
      ['binh@hcmus.edu.vn', 'Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm', 'APPROVED', 2, 3],
    ]);
    await svc.duyet('admin', id, true);
    const sau = (await svc.integrationList({})).items as Array<Record<string, unknown>>;
    expect(sau.map((x) => [x.email, x.title, x.position])).toEqual([
      ['an@hcmus.edu.vn', 'Tên đã sửa', 1],
      ['cuong@hcmus.edu.vn', 'Tên đã sửa', 2],
      ['binh@hcmus.edu.vn', 'Tên đã sửa', 3],
    ]);
  });

  it('kênh tích hợp gửi kèm trạng thái duyệt', async () => {
    const { svc } = await banNap();
    const kq = await svc.integrationList({});
    expect(kq.items.map((x) => (x as { reviewStatus: string }).reviewStatus)).toEqual(['APPROVED', 'APPROVED']);
  });
});

// ── Trang nhân sự (25/11/2026) ─────────────────────────────────────────────
describe('mục «Sáng kiến» trên trang nhân sự', () => {
  async function banNap() {
    const db = taoCsdl();
    const a = await db.svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    await db.svc.traLoiMoi('u2', a.id, true);
    Object.assign(db.inits[0], { reviewStatus: 'APPROVED', source: 'import' });
    return { ...db, id: a.id };
  }

  it('chỉ sáng kiến Khoa đã duyệt, dòng phụ: mã · cấp · QĐ (ngày)', async () => {
    const { svc } = await banNap();
    await svc.create('u1', khai({ code: 'SK2026-000999', title: 'Khai mới chưa duyệt' }));
    expect(await svc.mucTrangCua('u1')).toEqual([
      {
        title: 'Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm',
        desc: 'SK2026-000123 · Cấp cơ sở · QĐ 3771/QĐ-KHTN (20/11/2026)',
      },
    ]);
  });

  it('đang chờ duyệt bản sửa → trang vẫn hiện bản đã duyệt; người mới thêm chưa hiện', async () => {
    const { svc, id } = await banNap();
    await svc.update('u1', id, { title: 'Tên sửa', authors: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }] });
    await svc.traLoiMoi('u3', id, true);
    expect((await svc.mucTrangCua('u1'))[0].title).toBe('Hệ đo phổ huỳnh quang giá rẻ cho phòng thí nghiệm');
    expect(await svc.mucTrangCua('u3')).toEqual([]);
  });

  it('tắt «hiện trên trang» → không hiện; chỉ đụng dòng của chính mình', async () => {
    const { svc, id } = await banNap();
    await svc.doiHienTrenWeb('u1', id, false);
    expect(await svc.mucTrangCua('u1')).toEqual([]);
    expect(await svc.mucTrangCua('u2')).toHaveLength(1);
    expect((await svc.findOne(id, 'u1')).myShowOnWeb).toBe(false);
  });

  it('mỗi thay đổi tự cập nhật trang của những người bị ảnh hưởng', async () => {
    const db = taoCsdl();
    const trang = { ganMucSangKien: vi.fn().mockResolvedValue({ slug: 's', doi: true }) };
    const svc = new SangKienService(db.prisma, { emit: vi.fn() } as never, trang as never);
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    await svc.traLoiMoi('u2', a.id, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(trang.ganMucSangKien.mock.calls.map((c) => c[0]).sort()).toEqual(['u1', 'u2', 'u2']);
  });
});

// ── Kênh tích hợp ──────────────────────────────────────────────────────────
describe('integrationList', () => {
  it('ảnh chụp: chỉ người đã xác nhận, mỗi người một dòng, kèm thứ tự + tổng số tác giả', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { externalName: 'SV' }, { userId: 'u2' }] }));
    const kq = await svc.integrationList({});
    expect(kq.items).toEqual([
      expect.objectContaining({
        initiativeId: a.id,
        code: 'SK2026-000123',
        level: 'CO_SO',
        decisionNo: '3771/QĐ-KHTN',
        decisionDate: '2026-11-20',
        email: 'an@hcmus.edu.vn',
        position: 1,
        totalAuthors: 3,
        removed: false,
      }),
    ]);
  });

  it('since: gửi cả người chưa/thôi xác nhận (removed) với CÙNG một mốc đổi', async () => {
    const { svc } = taoCsdl();
    await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    const kq = (await svc.integrationList({ since: new Date(0) })) as {
      items: Array<{ email: string; removed: boolean }>;
      nextSince: string | null;
    };
    expect(kq.items.map((x) => [x.email, x.removed])).toEqual([
      ['an@hcmus.edu.vn', false],
      ['binh@hcmus.edu.vn', true],
    ]);
    expect(kq.nextSince).not.toBeNull();
  });

  it('lọc theo email', async () => {
    const { svc } = taoCsdl();
    const a = await svc.create('u1', khai({ authors: [{ userId: 'u1' }, { userId: 'u2' }] }));
    await svc.traLoiMoi('u2', a.id, true);
    const kq = await svc.integrationList({ emails: 'BINH@hcmus.edu.vn' });
    expect(kq.items.map((x) => (x as { email: string }).email)).toEqual(['binh@hcmus.edu.vn']);
  });
});
