import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { UpdateAdminProfileBodyType } from './admin.model';

// Hai nhóm TÁCH BIỆT (Khoa quyết: quản lý cán bộ ≠ quản lý admin):
//   'admin' = tài khoản đăng nhập CMS (super-admin + admin bộ môn), có password.
//   'staff' = CÁN BỘ/giảng viên (LECTURER) — hồ sơ nhân sự, KHÔNG đăng nhập.
export type StaffKind = 'admin' | 'staff';
const ADMIN_WHERE: Prisma.UserWhereInput = {
  role: { in: ['SUPER_ADMIN', 'ADMIN'] },
};
const STAFF_WHERE: Prisma.UserWhereInput = { role: 'LECTURER' };

// Tìm kiếm: tách theo từ, MỖI từ phải khớp tên/họ/email/MSCB (không phân biệt hoa
// thường). AND các từ → gõ "Huỳnh Tuấn" khớp người có họ "Huỳnh" + tên "Tuấn" dù
// tên nằm ở hai cột. (Không bỏ dấu — admin gõ tiếng Việt có dấu là khớp.)
const searchWhere = (search?: string): Prisma.UserWhereInput => {
  const tokens = (search ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return {};
  return {
    AND: tokens.map((tok) => ({
      OR: [
        { firstName: { contains: tok, mode: 'insensitive' as const } },
        { lastName: { contains: tok, mode: 'insensitive' as const } },
        { email: { contains: tok, mode: 'insensitive' as const } },
        { teacherId: { contains: tok, mode: 'insensitive' as const } },
      ],
    })),
  };
};

const whereFor = (kind: StaffKind, search?: string): Prisma.UserWhereInput => ({
  ...(kind === 'staff' ? STAFF_WHERE : ADMIN_WHERE),
  ...searchWhere(search),
});

const STAFF_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  position: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  physoomId: true,
  teacherId: true,
  degree: true,
  rank: true,
  positionKey: true,
  positionFrom: true,
  positionTo: true,
  employmentType: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPaged(kind: StaffKind, skip: number, take: number, search?: string) {
    return this.prisma.user.findMany({
      where: whereFor(kind, search),
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take,
      select: STAFF_SELECT,
    });
  }

  count(kind: StaffKind, search?: string) {
    return this.prisma.user.count({ where: whereFor(kind, search) });
  }

  countActiveSince(kind: StaffKind, since: Date) {
    return this.prisma.user.count({
      where: { ...whereFor(kind), lastLoginAt: { gte: since } },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Tạo cán bộ (giảng viên) — role LECTURER, KHÔNG password. */
  createStaff(data: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    teacherId?: string | null;
    rank?: string | null;
    positionKey?: string | null;
    degree?: string | null;
    employmentType?: string | null;
    departmentId?: string | null;
    positionFrom?: Date | null;
    positionTo?: Date | null;
  }) {
    return this.prisma.user.create({
      data: { ...data, role: 'LECTURER' },
      select: STAFF_SELECT,
    });
  }

  /** Đơn vị để dropdown chọn (Mục 10). */
  listUnits() {
    return this.prisma.department.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  updateProfile(id: string, body: UpdateAdminProfileBodyType) {
    return this.prisma.user.update({
      where: { id },
      // Chỉ ghi trường được gửi; `departmentId` là FK vô hướng, đặt thẳng được.
      data: {
        ...(body.rank !== undefined ? { rank: body.rank } : {}),
        ...(body.positionKey !== undefined
          ? { positionKey: body.positionKey }
          : {}),
        ...(body.positionFrom !== undefined
          ? { positionFrom: body.positionFrom }
          : {}),
        ...(body.positionTo !== undefined
          ? { positionTo: body.positionTo }
          : {}),
        ...(body.degree !== undefined ? { degree: body.degree } : {}),
        ...(body.teacherId !== undefined ? { teacherId: body.teacherId } : {}),
        ...(body.employmentType !== undefined
          ? { employmentType: body.employmentType }
          : {}),
        ...(body.departmentId !== undefined
          ? { departmentId: body.departmentId }
          : {}),
      },
      select: STAFF_SELECT,
    });
  }

  setActive(id: string, isActive: boolean) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, email: true, isActive: true },
    });
  }

  setPassword(id: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
      select: { id: true, email: true },
    });
  }

  // ── Thư viện ảnh nền hero (admin quản, giảng viên chọn ở phys-profile) ──────
  listHeroBackgrounds() {
    return this.prisma.heroBackground.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, url: true, name: true, sortOrder: true },
    });
  }

  addHeroBackground(data: {
    url: string;
    name?: string | null;
    createdBy?: string | null;
  }) {
    return this.prisma.heroBackground.create({
      data: {
        url: data.url,
        name: data.name ?? null,
        createdBy: data.createdBy ?? null,
      },
      select: { id: true, url: true, name: true, sortOrder: true },
    });
  }

  deleteHeroBackground(id: string) {
    return this.prisma.heroBackground.delete({ where: { id } });
  }
}
