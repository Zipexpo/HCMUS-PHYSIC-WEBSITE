import type { STUDENT_TYPES } from './scholar.model';

/**
 * Chi tiết TỪNG tác giả của một công trình cho báo cáo xuất Excel (phys-profile
 * /thong-ke): thứ tự trên bài, cờ cơ quan người khai đã đánh dấu, địa chỉ in trên
 * bài, diện học viên, và tài khoản trong hệ thống kèm vai trò đã xác nhận.
 *
 * Chỉ gửi DỮ KIỆN. Việc xếp loại (thuộc Trường / ĐHQG / trong nước / nước ngoài),
 * kể cả suy từ địa chỉ khi người khai chưa đánh dấu, để phys-profile làm — sửa
 * quy tắc khỏi phải dựng lại web Khoa.
 *
 * Vai trò "tác giả liên hệ" chỉ biết với người CÓ tài khoản: người ngoài hệ thống
 * chỉ được lưu dưới dạng con số (`externalMainAuthors`), không lưu ai là ai.
 */
export type StudentType = (typeof STUDENT_TYPES)[number];

type HangGoc = {
  name?: string | null;
  given?: string | null;
  family?: string | null;
  affiliation?: string | null;
  isNonSchool?: unknown;
  isVnu?: unknown;
  isForeign?: unknown;
  studentType?: unknown;
};

export type TacGiaDaXacNhan = {
  authorIndex: number;
  isFirst: boolean;
  isCorresponding: boolean;
  isLast: boolean;
  name: string;
  rank: string | null;
};

export type TacGiaBaoCao = {
  name: string;
  /** Thứ tự trên bài (1 = đứng đầu). null = chưa rõ: có tài khoản nhưng chưa chỉ hàng. */
  order: number | null;
  /** Địa chỉ in trên bài (Crossref/OpenAlex) — nguyên văn. */
  affiliation: string | null;
  /** Cờ người khai đánh dấu; null = chưa đánh dấu. */
  isNonSchool: boolean | null;
  isVnu: boolean | null;
  isForeign: boolean | null;
  studentType: StudentType | null;
  /** Tài khoản trong hệ thống ĐÃ XÁC NHẬN ở hàng này (vai trò do họ khai). */
  account: {
    name: string;
    rank: string | null;
    isFirst: boolean;
    isCorresponding: boolean;
    isLast: boolean;
  } | null;
};

const DIEN = new Set<string>(['sinh_vien', 'cao_hoc', 'ncs']);
const coKhong = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const tenHang = (a: HangGoc): string =>
  (a.name || [a.given, a.family].filter(Boolean).join(' ') || '').trim();
const taiKhoan = (a: TacGiaDaXacNhan): TacGiaBaoCao['account'] => ({
  name: a.name,
  rank: a.rank,
  isFirst: a.isFirst,
  isCorresponding: a.isCorresponding,
  isLast: a.isLast,
});

export function tacGiaBaoCao(
  authorsRaw: unknown,
  daXacNhan: TacGiaDaXacNhan[],
): TacGiaBaoCao[] {
  const hang = (Array.isArray(authorsRaw) ? authorsRaw : []) as HangGoc[];
  // Hàng nào có tài khoản xác nhận. Hai người cùng chỉ một hàng thì người sau
  // xuống nhóm "chưa chỉ hàng" bên dưới — không đè mất ai.
  const theoHang = new Map<number, TacGiaDaXacNhan>();
  for (const a of daXacNhan) {
    if (a.authorIndex >= 0 && a.authorIndex < hang.length && !theoHang.has(a.authorIndex)) {
      theoHang.set(a.authorIndex, a);
    }
  }

  const out: TacGiaBaoCao[] = hang.map((a0, i) => {
    const a = a0 ?? {};
    const tk = theoHang.get(i);
    return {
      name: tenHang(a) || tk?.name || `Tác giả ${i + 1}`,
      order: i + 1,
      affiliation: (a.affiliation ?? '').trim() || null,
      isNonSchool: coKhong(a.isNonSchool),
      isVnu: coKhong(a.isVnu),
      isForeign: coKhong(a.isForeign),
      studentType: DIEN.has(String(a.studentType)) ? (a.studentType as StudentType) : null,
      account: tk ? taiKhoan(tk) : null,
    };
  });

  // Có tài khoản mà không nằm ở hàng nào: chưa chỉ hàng, hoặc bài khai tay không
  // có danh sách tác giả. Vẫn phải lên báo cáo. Bài khai tay thì vị trí người
  // khai chọn trong form là thứ tự gần đúng nhất có được; bài có danh sách mà
  // chưa chỉ hàng thì không đoán.
  const daGan = new Set(theoHang.values());
  for (const a of daXacNhan) {
    if (daGan.has(a)) continue;
    out.push({
      name: a.name,
      order: hang.length === 0 && a.authorIndex >= 0 ? a.authorIndex + 1 : null,
      affiliation: null,
      isNonSchool: null,
      isVnu: null,
      isForeign: null,
      studentType: null,
      account: taiKhoan(a),
    });
  }
  return out;
}
