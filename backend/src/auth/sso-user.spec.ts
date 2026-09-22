import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AuthRepository } from './auth.repo';
import { AuthService } from './auth.service';
import { ScholarService } from '../scholar/scholar.service';

// config.ts thoát tiến trình khi thiếu tệp .env (máy test không có) — mà
// auth.service kéo nó vào qua token.service. Những test này không đọc cấu hình.
vi.mock('../shared/config/config', () => ({ default: {} }));

/**
 * Ba đường ghi tài khoản từ PHYsoom sang web Khoa — hai lỗi thật, báo 22/9/2026.
 *
 * 1. Họ tên bị ĐẢO mỗi lần đăng nhập: PHYsoom lấy tên tài khoản Google (kiểu Tây,
 *    "Hồng Huỳnh Thị Yến") và upsertSsoUser đè lên bản đúng. Quản trị sửa tay
 *    xong, lần đăng nhập sau lại đảo — rồi lan sang ACADsoom qua /integration/staff.
 * 2. SINH VIÊN thành LECTURER: mọi lượt đăng nhập qua PHYsoom đều tạo LECTURER,
 *    kể cả @student.hcmus.edu.vn; ACADsoom kéo về thành ngạch GV.
 */

const SECRET = 'bi-mat-thu';

function sign(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    aud: 'physprofile',
    ...payload,
    iat: now,
    exp: now + 120,
  })}`;
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

describe('AuthRepository.upsertSsoUser — không ghi đè họ tên', () => {
  function dung(daCo: { firstName: string | null; lastName: string | null }) {
    const prisma = {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: 'u1', ...daCo }),
        update: vi.fn().mockResolvedValue({ id: 'u1' }),
      },
    };
    return { repo: new AuthRepository(prisma as never), prisma };
  }

  it('lần đăng nhập sau: KHÔNG đụng tới họ tên đã có', async () => {
    const { repo, prisma } = dung({
      firstName: 'Hồng',
      lastName: 'Huỳnh Thị Yến',
    });
    await repo.upsertSsoUser({
      email: 'htyhong@hcmus.edu.vn',
      firstName: 'Yến',
      lastName: 'Hồng Huỳnh Thị',
    });
    const { update } = prisma.user.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty('firstName');
    expect(update).not.toHaveProperty('lastName');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('ô họ tên đang trống thì mới điền', async () => {
    const { repo, prisma } = dung({ firstName: '', lastName: null });
    await repo.upsertSsoUser({
      email: 'moi@hcmus.edu.vn',
      firstName: 'Ngân',
      lastName: 'Nguyễn Vương Thùy',
    });
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      firstName: 'Ngân',
      lastName: 'Nguyễn Vương Thùy',
    });
  });

  it('lần đầu: tạo kèm họ tên', async () => {
    const { repo, prisma } = dung({ firstName: 'Ngân', lastName: 'Nguyễn' });
    await repo.upsertSsoUser({
      email: 'moi@hcmus.edu.vn',
      firstName: 'Ngân',
      lastName: 'Nguyễn',
    });
    const { create } = prisma.user.upsert.mock.calls[0][0];
    expect([create.firstName, create.lastName, create.role]).toEqual([
      'Ngân',
      'Nguyễn',
      'LECTURER',
    ]);
  });
});

describe('AuthService.loginWithPhysoom — sinh viên không thành cán bộ', () => {
  it('email sinh viên → từ chối, KHÔNG tạo tài khoản', async () => {
    process.env.PHYSOOM_SSO_SECRET = SECRET;
    const repo = { upsertSsoUser: vi.fn() };
    const svc = new AuthService(
      {} as never,
      {} as never,
      repo as never,
      {} as never,
      {} as never,
    );
    await expect(
      svc.loginWithPhysoom(
        sign({
          email: '25c3101514@student.hcmus.edu.vn',
          name: 'Phạm Lê Việt',
        }),
      ),
    ).rejects.toBeDefined();
    expect(repo.upsertSsoUser).not.toHaveBeenCalled();
  });
});

describe('ScholarService.upsertUserFromPhysoom — PHYsoom đẩy người sang', () => {
  function dung(
    daCo: null | { firstName: string | null; lastName: string | null },
  ) {
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue(daCo ? { id: 'u1', ...daCo } : null),
        findFirst: vi
          .fn()
          .mockResolvedValue(daCo ? { id: 'u1', ...daCo } : null),
        update: vi
          .fn()
          .mockResolvedValue({ id: 'u1', email: 'x', physoomId: null }),
        create: vi
          .fn()
          .mockResolvedValue({ id: 'u2', email: 'x', physoomId: null }),
      },
    };
    const svc = new ScholarService(
      prisma as never,
      {} as never,
      {} as never,
      { emit: vi.fn() } as never,
      {} as never,
    );
    return { svc, prisma };
  }

  it('email sinh viên → 400, không ghi gì', async () => {
    const { svc, prisma } = dung(null);
    await expect(
      svc.upsertUserFromPhysoom({
        email: '25c3101514@student.hcmus.edu.vn',
        name: 'X',
      }),
    ).rejects.toBeDefined();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('người đã có họ tên → KHÔNG ghi đè bằng tên PHYsoom', async () => {
    const { svc, prisma } = dung({
      firstName: 'Hồng',
      lastName: 'Huỳnh Thị Yến',
    });
    await svc.upsertUserFromPhysoom({
      email: 'htyhong@hcmus.edu.vn',
      name: 'Hồng Huỳnh Thị Yến',
    });
    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('firstName');
    expect(data).not.toHaveProperty('lastName');
  });

  it('người mới chỉ có `name` → tách theo lối tiếng Việt', async () => {
    const { svc, prisma } = dung(null);
    await svc.upsertUserFromPhysoom({
      email: 'moi@hcmus.edu.vn',
      name: 'Nguyễn Vương Thùy Ngân',
    });
    const { data } = prisma.user.create.mock.calls[0][0];
    expect([data.firstName, data.lastName]).toEqual([
      'Ngân',
      'Nguyễn Vương Thùy',
    ]);
  });
});
