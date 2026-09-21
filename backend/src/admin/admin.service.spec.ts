import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repo';
import { HashingService } from '../shared/services/hashing.service';
import { StaffPageService } from '../scholar/staff-page.service';
import {
  AdminNotFoundException,
  CannotMutateSuperAdminException,
} from './admin.error';

type RepoMock = Record<keyof AdminRepository, ReturnType<typeof vi.fn>>;

const makeRepoMock = (): RepoMock => ({
  listPaged: vi.fn(),
  count: vi.fn(),
  countActiveSince: vi.fn(),
  listUnits: vi.fn(),
  findById: vi.fn(),
  updateProfile: vi.fn(),
  setActive: vi.fn(),
  setPassword: vi.fn(),
  findByEmail: vi.fn(),
  createStaff: vi.fn(),
  listHeroBackgrounds: vi.fn(),
  addHeroBackground: vi.fn(),
  deleteHeroBackground: vi.fn(),
});

const sampleAdmin = {
  id: 'admin-1',
  email: 'a@x.com',
  role: 'ADMIN' as const,
  isActive: true,
};

const sampleSuperAdmin = {
  id: 'super-1',
  email: 's@x.com',
  role: 'SUPER_ADMIN' as const,
  isActive: true,
};

describe('AdminService mutations', () => {
  let service: AdminService;
  let repo: RepoMock;
  let hashing: {
    hash: ReturnType<typeof vi.fn>;
    compare: ReturnType<typeof vi.fn>;
  };
  let staffPage: { ensureStaffPage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = makeRepoMock();
    hashing = { hash: vi.fn().mockResolvedValue('HASHED'), compare: vi.fn() };
    staffPage = {
      ensureStaffPage: vi
        .fn()
        .mockResolvedValue({ created: false, reason: 'noop' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: AdminRepository, useValue: repo },
        { provide: HashingService, useValue: hashing },
        { provide: StaffPageService, useValue: staffPage },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  describe('list', () => {
    it('returns paged items + total + activeNow', async () => {
      repo.listPaged.mockResolvedValue([sampleAdmin]);
      repo.count.mockResolvedValue(3);
      repo.countActiveSince.mockResolvedValue(1);
      repo.listUnits.mockResolvedValue([{ id: 'u1', name: 'BM A' }]);

      const result = await service.list({ page: 2, pageSize: 5 });

      // Không gõ từ khoá thì `search` vẫn đi xuống repo, là undefined — repo tự
      // bỏ qua. Assert đủ 4 tham số để lần sau đổi chữ ký là test biết ngay.
      expect(repo.listPaged).toHaveBeenCalledWith('admin', 5, 5, undefined);
      expect(result).toEqual({
        items: [sampleAdmin],
        total: 3,
        activeNow: 1,
        page: 2,
        pageSize: 5,
        units: [{ id: 'u1', name: 'BM A' }],
      });
    });

    // Từ khoá phải xuống CẢ `listPaged` LẪN `count`. Thiếu ở `count` thì tổng số
    // trang vẫn tính theo danh sách CHƯA lọc: người dùng bấm sang trang sau thấy
    // trống mà không hiểu vì sao. Còn `countActiveSince` cố ý KHÔNG lọc — đó là
    // thống kê tổng "đang hoạt động", không phải số khớp từ khoá.
    it('đưa từ khoá xuống listPaged + count, KHÔNG lọc activeNow', async () => {
      repo.listPaged.mockResolvedValue([sampleAdmin]);
      repo.count.mockResolvedValue(1);
      repo.countActiveSince.mockResolvedValue(7);
      repo.listUnits.mockResolvedValue([]);

      await service.listStaff({ page: 1, pageSize: 10, search: 'thịnh' });

      expect(repo.listPaged).toHaveBeenCalledWith('staff', 0, 10, 'thịnh');
      expect(repo.count).toHaveBeenCalledWith('staff', 'thịnh');
      expect(repo.countActiveSince).toHaveBeenCalledWith(
        'staff',
        expect.any(Date),
      );
    });
  });

  describe('suspend', () => {
    it('sets isActive=false on a regular admin', async () => {
      repo.findById.mockResolvedValue(sampleAdmin);

      await service.suspend('admin-1');

      expect(repo.setActive).toHaveBeenCalledWith('admin-1', false);
    });

    it('throws AdminNotFound when id missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.suspend('missing')).rejects.toBe(
        AdminNotFoundException,
      );
      expect(repo.setActive).not.toHaveBeenCalled();
    });

    it('refuses to suspend a super-admin', async () => {
      repo.findById.mockResolvedValue(sampleSuperAdmin);
      await expect(service.suspend('super-1')).rejects.toBe(
        CannotMutateSuperAdminException,
      );
      expect(repo.setActive).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('sets isActive=true on a regular admin', async () => {
      repo.findById.mockResolvedValue({ ...sampleAdmin, isActive: false });

      await service.restore('admin-1');

      expect(repo.setActive).toHaveBeenCalledWith('admin-1', true);
    });

    it('refuses to restore a super-admin', async () => {
      repo.findById.mockResolvedValue(sampleSuperAdmin);
      await expect(service.restore('super-1')).rejects.toBe(
        CannotMutateSuperAdminException,
      );
    });
  });

  describe('resetPassword', () => {
    it('hashes password then persists', async () => {
      repo.findById.mockResolvedValue(sampleAdmin);

      await service.resetPassword('admin-1', { password: 'newPass123' });

      expect(hashing.hash).toHaveBeenCalledWith('newPass123');
      expect(repo.setPassword).toHaveBeenCalledWith('admin-1', 'HASHED');
    });

    it('refuses to reset super-admin password', async () => {
      repo.findById.mockResolvedValue(sampleSuperAdmin);
      await expect(
        service.resetPassword('super-1', { password: 'newPass123' }),
      ).rejects.toBe(CannotMutateSuperAdminException);
      expect(hashing.hash).not.toHaveBeenCalled();
      expect(repo.setPassword).not.toHaveBeenCalled();
    });

    it('throws AdminNotFound for unknown id', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.resetPassword('missing', { password: 'newPass123' }),
      ).rejects.toBe(AdminNotFoundException);
    });
  });

  // Tạo cán bộ / gán đơn vị xong thì tự dựng trang nhân sự (best-effort) — người
  // mới lên danh sách "Đội ngũ" mà không cần dựng trang tay.
  describe('tự dựng trang nhân sự', () => {
    it('createStaff xong thì gọi ensureStaffPage cho cán bộ mới', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.createStaff.mockResolvedValue({ id: 'new-1', email: 'a@b.com' });

      const out = await service.createStaff({
        name: 'Nguyễn Văn A',
        email: 'A@b.com',
      } as never);

      expect(out).toEqual({ id: 'new-1', email: 'a@b.com' });
      expect(staffPage.ensureStaffPage).toHaveBeenCalledWith('new-1');
    });

    it('lỗi dựng trang KHÔNG làm hỏng việc tạo cán bộ', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.createStaff.mockResolvedValue({ id: 'new-2', email: 'c@d.com' });
      staffPage.ensureStaffPage.mockRejectedValue(new Error('bể'));

      await expect(
        service.createStaff({ name: 'Trần B', email: 'c@d.com' } as never),
      ).resolves.toEqual({ id: 'new-2', email: 'c@d.com' });
    });

    it('updateProfile có gán đơn vị thì gọi ensureStaffPage', async () => {
      repo.findById.mockResolvedValue(sampleAdmin);
      repo.updateProfile.mockResolvedValue(sampleAdmin);

      await service.updateProfile('admin-1', {
        departmentId: 'dept1',
      } as never);

      expect(staffPage.ensureStaffPage).toHaveBeenCalledWith('admin-1');
    });

    it('updateProfile KHÔNG đụng đơn vị thì không gọi', async () => {
      repo.findById.mockResolvedValue(sampleAdmin);
      repo.updateProfile.mockResolvedValue(sampleAdmin);

      await service.updateProfile('admin-1', { rank: 'gv' } as never);

      expect(staffPage.ensureStaffPage).not.toHaveBeenCalled();
    });
  });
});
