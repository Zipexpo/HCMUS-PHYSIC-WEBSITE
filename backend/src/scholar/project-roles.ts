/**
 * Danh sách nhân sự của đề tài phải có CHỦ NHIỆM — một luật cho mọi đường ghi.
 *
 * Chủ nhiệm là người sửa đề tài và nộp phương án chia giờ (Phụ lục 2 tr. 2.8).
 * Đo 13/9/2026: 8 đề tài không có chủ nhiệm nào đã xác nhận, và vì hồi đó chỉ
 * chủ nhiệm sửa được nên không ai sửa, không ai xoá được chúng — người khai tự
 * để mình là Thành viên mà không chọn ai làm chủ nhiệm, hoặc chủ nhiệm được mời
 * bấm xác nhận với ô vai trò mặc định "Thành viên".
 *
 * "Có chủ nhiệm" đếm mọi dòng CHƯA TỪ CHỐI: người đã xác nhận, người đang chờ
 * xác nhận, và cộng sự ngoài Khoa có tên. Cộng sự ngoài chưa gõ tên thì không
 * tính — dòng đó bị bỏ lúc lưu. phys-profile kiểm cùng luật (`coChuNhiem` trong
 * components/team-table.tsx) để người khai biết TRƯỚC khi bấm lưu.
 */

export type VaiTroDeTai = 'LEAD' | 'SECRETARY' | 'MEMBER';

/** Một dòng thành viên đang có trong cơ sở dữ liệu. */
export type DongThanhVien = {
  id: string;
  userId: string | null;
  role: string;
  claimStatus: string;
};

/** Phần của thân yêu cầu tạo / sửa có đụng tới vai trò. */
export type LuotKhai = {
  myRole?: VaiTroDeTai | null;
  memberUpdates?: Array<{ memberId: string; role?: VaiTroDeTai }>;
  externalMembers?: Array<{ name: string; role?: VaiTroDeTai }>;
  members?: Array<{ userId: string; role?: VaiTroDeTai }>;
};

/**
 * Vai trò của cả nhóm SAU một lượt sửa, theo đúng thứ tự update() ghi:
 * `memberUpdates` theo id dòng → thay TOÀN BỘ người ngoài khi có
 * `externalMembers` → `myRole` đè lên dòng của chính người sửa → mời người chưa
 * có dòng nào (invite() bỏ qua người đã có dòng — kể cả dòng đã từ chối — và bỏ
 * qua chính người mời).
 */
export function vaiTroSauKhiSua(
  hienCo: DongThanhVien[],
  userId: string,
  luot: LuotKhai,
): string[] {
  const doiVai = new Map(
    (luot.memberUpdates ?? [])
      .filter((m) => m.role)
      .map((m) => [m.memberId, m.role as string] as const),
  );
  const thayNguoiNgoai = luot.externalMembers !== undefined;

  const vaiTro = hienCo
    .filter((m) => m.claimStatus !== 'REJECTED')
    .filter((m) => !(thayNguoiNgoai && m.userId === null))
    .map((m) =>
      m.userId === userId && luot.myRole
        ? luot.myRole
        : (doiVai.get(m.id) ?? m.role),
    );

  for (const p of luot.externalMembers ?? []) {
    if (p.name.trim()) vaiTro.push(p.role ?? 'MEMBER');
  }

  const daCoDong = new Set(hienCo.map((m) => m.userId));
  const moi = new Map(
    (luot.members ?? [])
      .filter((p) => p.userId && p.userId !== userId && !daCoDong.has(p.userId))
      .map((p) => [p.userId, p] as const),
  );
  for (const p of moi.values()) vaiTro.push(p.role ?? 'MEMBER');

  return vaiTro;
}

/** Vai trò lúc TẠO: người khai (mặc định chủ nhiệm), người được mời, người ngoài. */
export function vaiTroLucTao(userId: string, body: LuotKhai): string[] {
  return vaiTroSauKhiSua(
    [{ id: '', userId, role: body.myRole ?? 'LEAD', claimStatus: 'CONFIRMED' }],
    userId,
    { externalMembers: body.externalMembers ?? [], members: body.members },
  );
}

/**
 * Ai QUẢN LÝ được một đề tài — tức sửa, và xoá hẳn khi không còn ai khác.
 *
 * Chủ nhiệm đã xác nhận, như trước. THÊM người khai đề tài (`createdBy`), nhưng
 * CHỈ khi đề tài chưa có chủ nhiệm nào có tài khoản đã xác nhận.
 *
 * Người dùng chốt 13/9/2026. Chỉ-chủ-nhiệm-sửa để lại những đề tài không ai sửa
 * được: chủ nhiệm là cộng sự ngoài Khoa (không đăng nhập được), chủ nhiệm được
 * mời bấm "Không phải tôi", hoặc chưa từng có chủ nhiệm. Người khai vốn là người
 * nhập dữ liệu đó từ đầu, nên quyền này chỉ mở đúng lúc không có chủ nhiệm nào
 * sửa được, và đóng lại ngay khi có chủ nhiệm xác nhận. Chủ nhiệm còn đang chờ
 * xác nhận thì chưa đóng nó: người đó chưa nhận vai.
 *
 * Người khai phải còn là thành viên ĐÃ XÁC NHẬN — đã rút tên thì thôi.
 * `shape()` dùng CHÍNH hàm này để trả `canEdit`, nên nút Sửa trên giao diện
 * không nói khác chốt chặn ở máy chủ.
 */
export function duocQuanLy(
  userId: string,
  createdBy: string | null | undefined,
  members: DongThanhVien[],
): boolean {
  const toi = members.find((m) => m.userId === userId);
  if (!toi || toi.claimStatus !== 'CONFIRMED') return false;
  if (toi.role === 'LEAD') return true;
  const coChuNhiemXacNhan = members.some(
    (m) =>
      m.userId !== null && m.role === 'LEAD' && m.claimStatus === 'CONFIRMED',
  );
  return createdBy === userId && !coChuNhiemXacNhan;
}
