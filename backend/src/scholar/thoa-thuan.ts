/**
 * ĐƠN THOẢ THUẬN CÁCH 1 — phần logic thuần (không CSDL), Khoa chốt 20/11/2026:
 *
 *   · Cách 1 (Phụ lục 2 tr. 2.5): các tác giả THUỘC TRƯỜNG tự thoả thuận tỷ lệ chia,
 *     "trên cơ sở đồng thuận". Từ nay mỗi lần KHAI MỚI hoặc ĐỔI tỷ lệ phải có đơn:
 *     tác giả có tài khoản ký qua phys-profile (đơn in ghi "Đã ký qua hệ thống lúc
 *     …"), người không có tài khoản ký tay → đại diện tải bản quét lên.
 *   · Khoa duyệt ở ACADsoom. CHƯA duyệt → kênh tích hợp không gửi tỷ lệ → ACADsoom
 *     tính Cách 2. Bài chưa từng có đơn nào (tỷ lệ khai trước 20/11/2026) GIỮ
 *     NGUYÊN — Khoa không hạ 223 khoản Cách 1 cũ.
 */

export const TRANG_THAI_DON = [
  'CHO_KY',
  'CHO_DUYET',
  'DA_DUYET',
  'KHOA_TU_CHOI',
  'BI_TU_CHOI_KY',
  'HET_HIEU_LUC',
] as const;
export type TrangThaiDon = (typeof TRANG_THAI_DON)[number];

/** Một hàng của phương án chia. `userId` null = người không có tài khoản (ký tay). */
export type DongChia = {
  /** Thứ tự trong danh sách tác giả, đếm từ 1; null = không rõ. */
  hang: number | null;
  ten: string;
  userId: string | null;
  email: string | null;
  sharePercent: number;
  /** Ghi địa chỉ Trường trên chính bài này — chỉ người thuộc Trường mới phải ký. */
  thuocTruong: boolean;
};

export type ChuKy = { userId: string; ten: string; at: string };
export type TuChoiKy = { userId: string; ten: string; at: string; lyDo: string };

type HangGoc = {
  name?: string | null;
  given?: string | null;
  family?: string | null;
  isNonSchool?: boolean | null;
  isForeign?: boolean | null;
  isVnu?: boolean | null;
};

const ngoaiTruong = (h?: HangGoc) => !!(h?.isNonSchool || h?.isForeign || h?.isVnu);
const tenHang = (h?: HangGoc) =>
  (h?.name || [h?.given, h?.family].filter(Boolean).join(' ') || '').trim();

/**
 * Phương án chia hiện hành của một bài.
 *
 *   taiKhoan — các dòng PublicationAuthor chưa từ chối (tỷ lệ LƯU ở đây).
 *   ngoai    — tỷ lệ của người KHÔNG có tài khoản, đúng như form gửi
 *              (`externalAuthors`): web Khoa không có cột nào giữ con số này, nên
 *              đơn thoả thuận là nơi duy nhất nó được lưu lại.
 *   raw      — authorsRaw: cho biết địa chỉ (thuộc Trường hay không) và vị trí.
 *
 * Người không tài khoản được ghép vị trí theo thứ tự: form gửi externalAuthors theo
 * đúng thứ tự các hàng KHÔNG phải tài khoản trong bảng (dongGoiTacGia, phys-profile).
 */
export function phuongAnChia(p: {
  taiKhoan: {
    userId: string;
    ten: string;
    email: string | null;
    authorIndex: number;
    sharePercent: number | null;
  }[];
  ngoai?: { name?: string | null; sharePercent?: number | null }[] | null;
  raw: unknown;
}): DongChia[] {
  const raw = Array.isArray(p.raw) ? (p.raw as HangGoc[]) : [];
  const ds: DongChia[] = [];
  for (const a of p.taiKhoan) {
    if (!(typeof a.sharePercent === 'number' && a.sharePercent > 0)) continue;
    const h = a.authorIndex >= 0 ? raw[a.authorIndex] : undefined;
    ds.push({
      hang: a.authorIndex >= 0 ? a.authorIndex + 1 : null,
      ten: a.ten,
      userId: a.userId,
      email: a.email,
      sharePercent: a.sharePercent,
      thuocTruong: !ngoaiTruong(h),
    });
  }
  const viTriTaiKhoan = new Set(p.taiKhoan.map((a) => a.authorIndex).filter((i) => i >= 0));
  const hangNgoai = raw.map((_, i) => i).filter((i) => !viTriTaiKhoan.has(i));
  (p.ngoai ?? []).forEach((x, k) => {
    if (!(typeof x.sharePercent === 'number' && x.sharePercent > 0)) return;
    const i = hangNgoai[k];
    const h = i === undefined ? undefined : raw[i];
    ds.push({
      hang: i === undefined ? null : i + 1,
      ten: (x.name ?? '').trim() || tenHang(h) || 'Tác giả không có tài khoản',
      userId: null,
      email: null,
      sharePercent: x.sharePercent,
      thuocTruong: !ngoaiTruong(h),
    });
  });
  return ds.sort((a, b) => (a.hang ?? 9999) - (b.hang ?? 9999));
}

const chuanTen = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Dấu vân tay của PHẦN TÀI KHOẢN (ai → bao nhiêu %) — để biết tỷ lệ "đã đổi" so với trước khi lưu. */
export function vanTayTaiKhoan(ds: DongChia[]): string {
  return ds
    .filter((d) => d.userId)
    .map((d) => `u:${d.userId}=${d.sharePercent}`)
    .sort()
    .join('|');
}

/** Dấu vân tay cả phương án, kể cả người không tài khoản. */
export function vanTay(ds: DongChia[]): string {
  const ngoai = ds
    .filter((d) => !d.userId)
    .map((d) => `x:${d.hang ?? ''}:${chuanTen(d.ten)}=${d.sharePercent}`)
    .sort();
  return [vanTayTaiKhoan(ds), ...ngoai].filter(Boolean).join('|');
}

/** Tài khoản phải ký qua hệ thống: thuộc Trường, có tỷ lệ. */
export const nguoiKyHeThong = (ds: DongChia[]) =>
  ds.filter((d) => d.userId && d.thuocTruong).map((d) => d.userId as string);

/** Còn người thuộc Trường không có tài khoản → phải ký tay, tải bản quét. */
export const canKyTay = (ds: DongChia[]) => ds.some((d) => !d.userId && d.thuocTruong);

/**
 * Trạng thái sau một lần ký / từ chối / tải bản quét. Không đụng trạng thái đã
 * chốt (đã duyệt, hết hiệu lực). Khoa đã từ chối thì chỉ một bản quét MỚI mới đưa
 * đơn trở lại hàng duyệt (`banQuetMoi`).
 */
export function trangThaiSau(p: {
  hienTai: TrangThaiDon;
  shares: DongChia[];
  chuKy: ChuKy[];
  tuChoi: TuChoiKy[];
  coBanQuet: boolean;
  banQuetMoi?: boolean;
}): TrangThaiDon {
  if (p.hienTai === 'DA_DUYET' || p.hienTai === 'HET_HIEU_LUC') return p.hienTai;
  if (p.tuChoi.length) return 'BI_TU_CHOI_KY';
  const daKy = new Set(p.chuKy.map((c) => c.userId));
  const duChuKy = nguoiKyHeThong(p.shares).every((id) => daKy.has(id));
  const duBanQuet = !canKyTay(p.shares) || p.coBanQuet;
  if (!duChuKy || !duBanQuet) return 'CHO_KY';
  if (p.hienTai === 'KHOA_TU_CHOI' && !p.banQuetMoi) return 'KHOA_TU_CHOI';
  return 'CHO_DUYET';
}

/** Cách 1 có được gửi sang ACADsoom không: chưa từng có đơn (bài cũ) hoặc đơn mới nhất đã duyệt. */
export const apDungCach1 = (donMoiNhat: { status: string } | null | undefined) =>
  !donMoiNhat || donMoiNhat.status === 'DA_DUYET';
