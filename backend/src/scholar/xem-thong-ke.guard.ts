import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { REQUEST_USER_KEY } from '../shared/constants/auth.constants';
import { ADMIN_ROLES } from '../shared/constants/role.constants';
import { AccessTokenPayload } from '../shared/types/jwt.type';

/**
 * Cổng của các endpoint THỐNG KÊ toàn Khoa (phys-profile /thong-ke). Qua được nếu
 * là admin (như trước), hoặc tài khoản được Super Admin bật `canViewStats` và
 * đang hoạt động.
 *
 * Tách khỏi vai trò để Ban chủ nhiệm / trưởng bộ môn xem được báo cáo mà KHÔNG
 * mở trang quản trị web — vai trò ADMIN thì mở, và admin không gắn bộ môn còn
 * ngang Super Admin (xem RolesGuard). Đọc cờ từ CSDL mỗi lần gọi chứ không nhét
 * vào token, nên bật/tắt có hiệu lực ngay, khỏi đăng nhập lại.
 *
 * Route dùng cổng này phải ghi @Roles(Lecturer, Admin, SuperAdmin) để RolesGuard
 * cho giảng viên đi tới đây; quyết định cuối cùng nằm ở đây.
 */
@Injectable()
export class XemThongKeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user: AccessTokenPayload | undefined = context
      .switchToHttp()
      .getRequest()[REQUEST_USER_KEY];
    if (!user) throw new ForbiddenException('Insufficient permissions');
    if (ADMIN_ROLES.includes(user.roleName)) return true;
    const row = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { canViewStats: true, isActive: true },
    });
    if (row?.canViewStats && row.isActive) return true;
    throw new ForbiddenException('Insufficient permissions');
  }
}
