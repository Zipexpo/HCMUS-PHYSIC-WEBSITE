import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AdminRepository, StaffKind } from './admin.repo';
import { StaffPageService } from '../scholar/staff-page.service';
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
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly hashingService: HashingService,
    private readonly staffPage: StaffPageService,
  ) {}

  /**
   * Dựng sẵn trang nhân sự cá nhân (best-effort) sau khi có tài khoản + đơn vị —
   * để người đó lên danh sách "Đội ngũ" công khai mà không cần dựng trang tay.
   * KHÔNG được làm hỏng thao tác chính: mọi lỗi chỉ ghi log rồi bỏ qua.
   */
  private async ensureStaffPageSafely(userId: string) {
    try {
      const r = await this.staffPage.ensureStaffPage(userId);
      if (r.created) {
        this.logger.log(`Đã tự dựng trang nhân sự ${r.slug} cho ${userId}`);
      }
    } catch (err) {
      this.logger.warn(
        `Không dựng được trang nhân sự cho ${userId}: ${String(err)}`,
      );
    }
  }

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
    const created = await this.adminRepository.createStaff({
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
    // Tự dựng trang nhân sự khi cán bộ mới đã có đơn vị (không có đơn vị thì
    // ensureStaffPage tự bỏ qua). Không chặn kết quả tạo cán bộ.
    await this.ensureStaffPageSafely(created.id);
    return created;
  }

  /**
   * Cập nhật hồ sơ tài khoản (Mục 10) — ngạch/chức vụ/học vị/MSCB/đơn vị… Web
   * Khoa làm chủ các trường này. KHÔNG chặn SUPER_ADMIN như suspend/reset: sửa
   * hồ sơ là vô hại, khác với khoá tài khoản.
   */
  async updateProfile(id: string, body: UpdateAdminProfileBodyType) {
    const user = await this.adminRepository.findById(id);
    if (!user) throw AdminNotFoundException;
    const updated = await this.adminRepository.updateProfile(id, body);
    // Gán/đổi đơn vị là lúc người này mới đủ điều kiện lên trang — thử dựng trang
    // nhân sự (idempotent, ai đã có trang thì bỏ qua). Chỉ khi có đụng tới đơn vị.
    if (body.departmentId !== undefined && body.departmentId) {
      await this.ensureStaffPageSafely(id);
    }
    return updated;
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

  // ── Thư viện ảnh nền hero ───────────────────────────────────────────────────
  listHeroBackgrounds() {
    return this.adminRepository.listHeroBackgrounds();
  }

  addHeroBackground(url: string, name: string | null, createdBy?: string) {
    return this.adminRepository.addHeroBackground({ url, name, createdBy });
  }

  async removeHeroBackground(id: string) {
    await this.adminRepository.deleteHeroBackground(id);
    return { message: 'Đã xoá ảnh nền' };
  }
}
