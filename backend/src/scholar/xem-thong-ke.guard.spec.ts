import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { REQUEST_USER_KEY } from '../shared/constants/auth.constants';
import { RoleName } from '../shared/constants/role.constants';
import { XemThongKeGuard } from './xem-thong-ke.guard';

type Row = { canViewStats: boolean; isActive: boolean } | null;

function run(roleName: RoleName | null, row: Row) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const user = roleName
    ? { userId: 'u1', roleName, departmentId: null, exp: 0, iat: 0 }
    : undefined;
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ [REQUEST_USER_KEY]: user }),
    }),
  } as unknown as ExecutionContext;
  return {
    result: new XemThongKeGuard(prisma).canActivate(context),
    findUnique,
  };
}

describe('XemThongKeGuard', () => {
  it('admin qua mà không cần đọc CSDL', async () => {
    const { result, findUnique } = run(RoleName.Admin, null);
    await expect(result).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('super admin qua', async () => {
    await expect(run(RoleName.SuperAdmin, null).result).resolves.toBe(true);
  });

  it('giảng viên được cấp quyền thì qua', async () => {
    const { result } = run(RoleName.Lecturer, {
      canViewStats: true,
      isActive: true,
    });
    await expect(result).resolves.toBe(true);
  });

  it('giảng viên chưa được cấp quyền bị chặn', async () => {
    const { result } = run(RoleName.Lecturer, {
      canViewStats: false,
      isActive: true,
    });
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Cho nghỉ là phải mất quyền ngay, dù token cũ còn hạn.
  it('được cấp nhưng tài khoản đã cho nghỉ thì bị chặn', async () => {
    const { result } = run(RoleName.Lecturer, {
      canViewStats: true,
      isActive: false,
    });
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tài khoản không còn trong CSDL thì bị chặn', async () => {
    await expect(run(RoleName.Lecturer, null).result).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('chưa đăng nhập thì bị chặn', async () => {
    await expect(run(null, null).result).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
