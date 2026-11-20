/**
 * Cách 1 (Phụ lục 2 tr. 2.5) — nhóm tác giả THUỘC TRƯỜNG tự thoả thuận tỷ lệ chia
 * giờ. Khoa chốt 20/11/2026: khi đã chọn Cách 1 thì MỌI tác giả thuộc Trường phải
 * có tỷ lệ lớn hơn 0.
 *
 * Vì sao chặn ở máy chủ chứ không chỉ ở form: ACADsoom coi 0% (hoặc trống) là
 * "người này không dùng Cách 1" → người đó rơi về Cách 2, trong khi đại diện đã
 * lấy phần % của mình — cả bài bị tính quá. Đo 20/11/2026 có 4 công trình như thế
 * (vd đại diện 100% + đồng nghiệp vẫn nhận phần Cách 2). Form phys-profile đã bắt
 * từ 10/10, nhưng bản lưu từ form cũ và mọi đường gọi khác đều lọt.
 *
 * Chỉ kiểm những gì lượt lưu GỬI LÊN: dòng không gửi `sharePercent` (undefined) là
 * "giữ nguyên", không phán xét được. Người đứng tên với địa chỉ NGOÀI Trường trên
 * chính bài này (authorsRaw: isNonSchool / isForeign / isVnu) không thuộc nhóm chia
 * nên không bắt. Tác giả không có tài khoản (externalAuthors) không mang vị trí nên
 * để form bắt (loiCach1).
 */

type DongTyLe = { sharePercent?: number | null; authorIndex?: number | null };

type HangGoc = { isNonSchool?: boolean | null; isForeign?: boolean | null; isVnu?: boolean | null };

const coPhanTram = (x?: number | null) => typeof x === 'number' && x > 0;

/** Số thứ tự (từ 1) các hàng thuộc Trường bị để 0% / trống trong một bài đã chọn Cách 1. */
export function hangThieuTyLeCach1(p: {
  me?: DongTyLe | null;
  dongTacGia?: DongTyLe[] | null;
  ngoai?: { sharePercent?: number | null }[] | null;
  raw: unknown;
}): number[] {
  const tatCa = [p.me, ...(p.dongTacGia ?? []), ...(p.ngoai ?? [])];
  // Không ai có % → đang là Cách 2, không có gì để kiểm.
  if (!tatCa.some((d) => coPhanTram(d?.sharePercent))) return [];

  const hang = Array.isArray(p.raw) ? (p.raw as HangGoc[]) : [];
  const ngoaiTruong = (i?: number | null) => {
    if (i == null || i < 0) return false; // không biết vị trí → coi là thuộc Trường
    const h = hang[i];
    return !!(h?.isNonSchool || h?.isForeign || h?.isVnu);
  };

  const thieu: number[] = [];
  for (const d of [p.me, ...(p.dongTacGia ?? [])]) {
    if (!d || d.sharePercent === undefined) continue; // không gửi = giữ nguyên
    if (ngoaiTruong(d.authorIndex)) continue;
    if (!coPhanTram(d.sharePercent)) thieu.push(d.authorIndex != null && d.authorIndex >= 0 ? d.authorIndex + 1 : 0);
  }
  return thieu;
}
