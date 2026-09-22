import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, VerificationCodeType } from '../generated/prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUniqueUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }
  findUniqueUserByEmailButOmitPassword(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      omit: { password: true },
    });
  }
  findUniqueUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        preference: {
          select: { starredLayoutIds: true, starredWidgetIds: true },
        },
      },
    });
  }

  async setStarred(
    userId: string,
    data: { starredLayoutIds?: string[]; starredWidgetIds?: string[] },
  ) {
    return this.prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        starredLayoutIds: data.starredLayoutIds ?? [],
        starredWidgetIds: data.starredWidgetIds ?? [],
      },
      update: {
        ...(data.starredLayoutIds !== undefined
          ? { starredLayoutIds: data.starredLayoutIds }
          : {}),
        ...(data.starredWidgetIds !== undefined
          ? { starredWidgetIds: data.starredWidgetIds }
          : {}),
      },
      select: { starredLayoutIds: true, starredWidgetIds: true },
    });
  }

  createUser(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: Role;
    phone?: string;
    position?: string;
    bio?: string;
    departmentId?: string;
    avatarUrl?: string;
  }) {
    return this.prisma.user.create({ data, omit: { password: true } });
  }

  updateUserPassword(email: string, password: string) {
    return this.prisma.user.update({
      where: { email },
      data: { password },
    });
  }

  touchLastLogin(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  updateProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      avatarUrl?: string | null;
      position?: string | null;
      departmentId?: string | null;
      phone?: string | null;
      tourCompletedAt?: Date | null;
    },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      omit: { password: true },
      include: { department: { select: { id: true, name: true } } },
    });
  }

  updatePasswordById(userId: string, password: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password },
      select: { id: true },
    });
  }

  findUserWithPassword(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  createVerificationCode(data: {
    email: string;
    code: string;
    type: VerificationCodeType;
    expiresAt: Date;
  }) {
    return this.prisma.verificationCode.upsert({
      where: { email_type: { email: data.email, type: data.type } },
      create: data,
      update: { code: data.code, expiresAt: data.expiresAt },
    });
  }

  findVerificationCode(data: {
    email: string;
    code: string;
    type: VerificationCodeType;
  }) {
    return this.prisma.verificationCode.findUnique({
      where: { email_type: { email: data.email, type: data.type } },
    });
  }

  deleteVerificationCode(data: { email: string; type: VerificationCodeType }) {
    return this.prisma.verificationCode.delete({
      where: { email_type: { email: data.email, type: data.type } },
    });
  }

  /**
   * Tài khoản đăng nhập bằng SSO PHYsoom.
   *
   * Tên và MSCB lấy lại từ PHYsoom mỗi lần đăng nhập vì PHYsoom mới là nơi giữ
   * hồ sơ nhân sự. Nhưng VAI TRÒ và bộ môn thì chỉ đặt lúc TẠO MỚI — một quản
   * trị viên cũng có tài khoản PHYsoom, đăng nhập lại mà bị hạ xuống LECTURER
   * là mất luôn trang quản trị.
   */
  /**
   * Đăng nhập qua PHYsoom: tạo tài khoản ở lần đầu, các lần sau chỉ ghi giờ đăng
   * nhập.
   *
   * KHÔNG GHI ĐÈ HỌ TÊN. Web Khoa làm chủ hồ sơ tài khoản (Khoa chốt 28/8/2026)
   * và quản trị sửa tên ở trang quản lý người dùng. Trước 22/9/2026 mỗi lượt đăng
   * nhập đè tên theo PHYsoom — mà PHYsoom lấy tên tài khoản Google, ghi kiểu Tây
   * ("Hồng Huỳnh Thị Yến"). Nên sửa tay xong, lần đăng nhập sau lại đảo, và bản
   * đảo lan tiếp sang ACADsoom qua /integration/staff. Nay chỉ ĐIỀN ô đang trống.
   */
  async upsertSsoUser(data: {
    email: string;
    firstName: string;
    lastName: string;
    position?: string | null;
  }) {
    const user = await this.prisma.user.upsert({
      where: { email: data.email },
      update: {
        lastLoginAt: new Date(),
      },
      create: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        position: data.position ?? null,
        role: 'LECTURER',
        isActive: true,
        lastLoginAt: new Date(),
      },
      omit: { password: true },
    });
    const dien = {
      ...(!user.firstName && data.firstName
        ? { firstName: data.firstName }
        : {}),
      ...(!user.lastName && data.lastName ? { lastName: data.lastName } : {}),
    };
    if (!Object.keys(dien).length) return user;
    return this.prisma.user.update({
      where: { id: user.id },
      data: dien,
      omit: { password: true },
    });
  }
}
