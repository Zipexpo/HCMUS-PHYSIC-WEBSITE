import { ConflictException, Injectable } from '@nestjs/common';
import { AdminRepository, StaffKind } from './admin.repo';
import {
  AdminListQueryType,
  CreateStaffBodyType,
  ResetAdminPasswordBodyType,
  UpdateAdminProfileBodyType,
} from './admin.model';
import {
  AdminNotFoundException,
  CannotMutateSuperAdminException,
} from './admin.error';
import { HashingService } from '../shared/services/hashing.service';
import { splitVietnameseName } from '../auth/physoom-sso';

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly hashingService: HashingService,
  ) {}

  async list(query: AdminListQueryType) {
    return this.listByKind('admin', query);
  }

  /** Danh sách CÁN BỘ (giảng viên) — trang quản lý cán bộ, tách khỏi admin. */
  async listStaff(query: AdminListQueryType) {
    return this.listByKind('staff', query);
  }

  private async listByKind(kind: StaffKind, query: AdminListQueryType) {
    const { page, pageSize, search } = query;
    const skip = (page - 1) * pageSize;
    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const [items, total, activeNow, units] = await Promise.all([
      // `total` bám theo tìm kiếm để phân trang đúng; `activeNow` là thống kê
      // tổng nên KHÔNG lọc theo từ khoá.
      this.adminRepository.listPaged(kind, skip, pageSize, search),
      this.adminRepository.count(kind, search),
      this.adminRepository.countActiveSince(kind, activeSince),
      this.adminRepository.listUnits(),
    ]);
    return { items, total, activeNow, page, pageSize, units };
  }

  /**
   * Tạo CÁN BỘ (giảng viên) — hồ sơ nhân sự, role LECTURER, KHÔNG mật khẩu
   * (không đăng nhập CMS). Khác createAdmin (auth, có password).
   */
  async createStaff(body: CreateStaffBodyType) {
    const email = body.email.toLowerCase();
    if (await this.adminRepository.findByEmail(email)) {
      throw new ConflictException('Email đã tồn tại');
    }
    const { firstName, lastName } = splitVietnameseName(body.name);
    return this.adminRepository.createStaff({
      email,
      firstName,
      lastName,
      teacherId: body.teacherId ?? null,
      rank: body.rank ?? null,
      positionKey: body.positionKey ?? null,
      degree: body.degree ?? null,
      employmentType: body.employmentType ?? null,
      departmentId: body.departmentId ?? null,
      positionFrom: body.positionFrom ?? null,
      positionTo: body.positionTo ?? null,
    });
  }

  /**
   * Cập nhật hồ sơ tài khoản (Mục 10) — ngạch/chức vụ/học vị/MSCB/đơn vị… Web
   * Khoa làm chủ các trường này. KHÔNG chặn SUPER_ADMIN như suspend/reset: sửa
   * hồ sơ là vô hại, khác với khoá tài khoản.
   */
  async updateProfile(id: string, body: UpdateAdminProfileBodyType) {
    const user = await this.adminRepository.findById(id);
    if (!user) throw AdminNotFoundException;
    return this.adminRepository.updateProfile(id, body);
  }

  private async loadAdminOrThrow(id: string) {
    const user = await this.adminRepository.findById(id);
    if (!user) throw AdminNotFoundException;
    if (user.role === 'SUPER_ADMIN') throw CannotMutateSuperAdminException;
    return user;
  }

  async suspend(id: string) {
    await this.loadAdminOrThrow(id);
    await this.adminRepository.setActive(id, false);
    return { message: 'Admin suspended' };
  }

  async restore(id: string) {
    await this.loadAdminOrThrow(id);
    await this.adminRepository.setActive(id, true);
    return { message: 'Admin restored' };
  }

  async resetPassword(id: string, body: ResetAdminPasswordBodyType) {
    await this.loadAdminOrThrow(id);
    const hashed = await this.hashingService.hash(body.password);
    await this.adminRepository.setPassword(id, hashed);
    return { message: 'Password reset' };
  }
}
