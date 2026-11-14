/**
 * Cửa kiểm duyệt bài của đơn vị.
 *
 * Luật: đơn vị bật `requiresApproval` thì tài khoản của đơn vị KHÔNG tự đăng
 * bài lên web Khoa được — bấm đăng = gửi duyệt. Admin cấp Khoa không vướng cửa
 * này, nên họ duyệt bằng chính nút đăng.
 */
import { describe, expect, it } from 'vitest';
import { isFacultyWide } from '../shared/helpers';

const FACULTY = 'dept_legacy_1';

/** Bản sao thuần của PostService.needsApproval để kiểm luật, không cần DB. */
const needsApproval = (
  roleName: string,
  userDeptId: string | null,
  postDept: { id: string; requiresApproval: boolean } | null,
): boolean => {
  if (isFacultyWide(roleName, userDeptId)) return false;
  if (!postDept) return false;
  return postDept.requiresApproval;
};

const CLB = { id: 'dept_clb', requiresApproval: true };
const VAN_PHONG = { id: 'dept_vp', requiresApproval: false };

describe('cửa kiểm duyệt', () => {
  it('tài khoản CLB phải gửi duyệt, không tự đăng được', () => {
    expect(needsApproval('ADMIN', CLB.id, CLB)).toBe(true);
  });

  it('đơn vị KHÔNG bật duyệt thì đăng thẳng như cũ', () => {
    expect(needsApproval('ADMIN', VAN_PHONG.id, VAN_PHONG)).toBe(false);
  });

  it('admin cấp Khoa duyệt được bài của CLB', () => {
    expect(needsApproval('ADMIN', FACULTY, CLB)).toBe(false);
  });

  it('SuperAdmin không bao giờ vướng cửa duyệt', () => {
    expect(needsApproval('SUPER_ADMIN', CLB.id, CLB)).toBe(false);
  });

  it('admin không gắn bộ môn = cấp Khoa, không vướng', () => {
    expect(needsApproval('ADMIN', null, CLB)).toBe(false);
  });

  it('bài không thuộc đơn vị nào thì không cần duyệt', () => {
    expect(needsApproval('ADMIN', CLB.id, null)).toBe(false);
  });

  // Bẫy: admin CLB mở bài của đơn vị KHÁC. canAccessDepartment đã chặn từ
  // trước, nhưng nếu luật duyệt đọc nhầm sang đơn vị CỦA NGƯỜI DÙNG thay vì
  // đơn vị CỦA BÀI thì sẽ sai — bài của đơn vị không duyệt sẽ bị bắt duyệt.
  it('xét theo đơn vị CỦA BÀI, không phải của người đăng', () => {
    expect(needsApproval('ADMIN', CLB.id, VAN_PHONG)).toBe(false);
  });
});
