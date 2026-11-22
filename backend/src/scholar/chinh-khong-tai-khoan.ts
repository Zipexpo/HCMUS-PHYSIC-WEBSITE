/**
 * Bài có TÁC GIẢ CHÍNH THUỘC TRƯỜNG mà KHÔNG GẮN TÀI KHOẢN không — sinh viên, học
 * viên, cán bộ chưa có tài khoản… đứng đầu, đứng cuối, hoặc được đánh dấu liên hệ.
 *
 * recount() trước đây suy `mainAuthorAtSchool` CHỈ từ tài khoản đã xác nhận, nên
 * bài mà tác giả chính thuộc Trường không có tài khoản bị hạ cờ mỗi khi có ai lưu
 * phân loại, bấm xác nhận lời mời hay gỡ tên — cả bài bị nhân S/T như bài không có
 * tác giả chính thuộc Trường (22/11/2026). Form phys-profile vẫn đếm những người
 * này khi tính cờ (dongGoiTacGia), chotVaiTroTheoViTri cũng vậy; recount phải theo.
 *
 * Chỉ tính hàng ĐÃ GHI RÕ thuộc Trường (`isNonSchool === false`, không phải nước
 * ngoài/ĐHQG — form lưu đúng như vậy). Hàng nạp từ nguồn tra chưa ai đánh dấu thì
 * không biết, không tính. Hàng có tài khoản (chưa từ chối) KHÔNG xét ở đây: vai
 * trò của người đó nằm trên dòng của họ, recount đã xét riêng.
 */
type HangGoc = {
  isNonSchool?: unknown;
  isForeign?: unknown;
  isVnu?: unknown;
  isCorresponding?: unknown;
  notLastAuthor?: unknown;
} | null;

export function coChinhKhongTaiKhoanThuocTruong(
  raw: unknown,
  hangCoTaiKhoan: ReadonlySet<number>,
): boolean {
  const ds = (Array.isArray(raw) ? raw : []) as HangGoc[];
  const n = ds.length;
  return ds.some((h, i) => {
    if (!h || typeof h !== 'object' || hangCoTaiKhoan.has(i)) return false;
    if (h.isNonSchool !== false || h.isForeign === true || h.isVnu === true) {
      return false;
    }
    const dau = i === 0;
    // Người đứng cuối đã được ghi rõ KHÔNG tính Last Author thì thôi.
    const cuoi = n > 1 && i === n - 1 && h.notLastAuthor !== true;
    return dau || cuoi || h.isCorresponding === true;
  });
}
