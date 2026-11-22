/**
 * Mọi mã ngạch mà trang quản trị cho chọn đều phải được backend hiểu.
 *
 * Hai danh sách nằm ở hai nơi (ô chọn trong admin và bảng RANK_ROLE ở đây), nên
 * rất dễ thêm một bên mà quên bên kia. Mã nào backend không hiểu sẽ rơi xuống
 * mặc định "Giảng viên" — gọi một kỹ thuật viên là giảng viên trên trang công
 * khai. Mã `NV` từng thiếu đúng kiểu đó.
 */
import { describe, expect, it } from 'vitest';

/** Chép từ RANKS trong frontend/src/views/admin/admins/edit-profile-modal.tsx */
const RANKS_TRONG_ADMIN = [
  'GV', 'GVC', 'GVCC', 'TrG', 'NCV', 'NCVC', 'CV', 'KTV', 'NV',
];

/** Chép từ RANK_ROLE trong staff-page.service.ts (khoá viết thường). */
const RANK_ROLE_KEYS = [
  'gv', 'gvc', 'gvcc', 'cv', 'trg', 'ncv', 'ncvc', 'ktv', 'nv',
];

describe('ngạch cán bộ', () => {
  it('mọi ngạch chọn được trong admin đều có trong RANK_ROLE', () => {
    const thieu = RANKS_TRONG_ADMIN.map((r) => r.toLowerCase()).filter(
      (r) => !RANK_ROLE_KEYS.includes(r),
    );
    expect(thieu).toEqual([]);
  });

  it('không có ngạch thừa chỉ backend biết mà admin không chọn được', () => {
    const admin = RANKS_TRONG_ADMIN.map((r) => r.toLowerCase());
    expect(RANK_ROLE_KEYS.filter((r) => !admin.includes(r))).toEqual([]);
  });

  it('có đủ Kỹ thuật viên và Nhân viên', () => {
    expect(RANK_ROLE_KEYS).toContain('ktv');
    expect(RANK_ROLE_KEYS).toContain('nv');
  });
});
