/**
 * BỘ TÍNH ĐIỂM CÔNG TRÌNH THEO HỘI ĐỒNG GIÁO SƯ NGÀNH VẬT LÝ (Khoa yêu cầu 20/11/2026).
 *
 * Căn cứ (đã đọc văn bản gốc, không theo trí nhớ):
 *   · QĐ 26/QĐ-HĐGSNN ngày 11/7/2025, mục 26 — danh mục tạp chí ngành Vật lý: trần
 *     điểm từng loại (bản scan ở phys-profile public/26-HD-Vat-ly-DMTC-2025_0001.pdf);
 *     mục c) "Tác giả chính là tác giả đầu tiên, tác giả liên hệ duy nhất, hoặc tác
 *     giả được ghi rõ tỉ lệ đóng góp trong bài báo (nếu có). Các bài báo với số tác
 *     giả > 10 được tính tròn cho 10 đồng tác giả."
 *   · QĐ 25/2020/QĐ-TTg, Phụ lục I — mọi mức là "tính tối đa đến" (TRẦN): sách, sáng
 *     chế, giải pháp hữu ích; báo cáo WoS/Scopus "tính điểm như bài báo khoa học nhưng
 *     không được coi là bài báo … quốc tế có uy tín".
 *   · QĐ 37/2018/QĐ-TTg, Điều 8 — "tác giả chính được hưởng 1/3 số điểm của công
 *     trình", phần còn lại "chia theo giá trị đóng góp của mỗi người kể cả tác giả
 *     chính"; không xác định được thì "chia đều cho từng người tham gia".
 *     Điều 5 khoản 9 (GS) và Điều 6 khoản 8 (PGS) — chuẩn tối thiểu (xem CHUAN).
 *
 * Mọi con số ở đây là ĐIỂM TỐI ĐA CÓ THỂ ĐẠT: Hội đồng chấm trong khoảng 0 – trần.
 * Tệp THUẦN (không Nest, không Prisma) để test được và phys-profile đọc lại được.
 */

// ── Danh mục tạp chí trong nước được kể tên (mục 5–29) ─────────────────────────
/** `tu` = áp từ năm công bố đó (bỏ trống = mức gốc, áp cho mọi năm trước mốc sau). */
export type MocDiem = { tu?: number; max: number };
export type TapChiTrongNuoc = { tt: number; ten: string; issn: string[]; moc: MocDiem[] };

export const TAP_CHI_TRONG_NUOC: TapChiTrongNuoc[] = [
  { tt: 5, ten: 'Advances in Natural Sciences (cũ: Proceedings of the National Centre for Scientific Research of Vietnam)', issn: ['1859221X'], moc: [{ max: 1.0 }] },
  { tt: 6, ten: 'Communications in Physics', issn: ['08683166'], moc: [{ max: 1.0 }, { tu: 2019, max: 1.25 }, { tu: 2025, max: 1.0 }] },
  { tt: 7, ten: 'DLU Journal of Science', issn: ['0866787X'], moc: [{ max: 0.5 }, { tu: 2019, max: 0.75 }] },
  { tt: 8, ten: 'Hue University Journal of Science: Natural Science', issn: ['18591388', '26159678'], moc: [{ max: 0.5 }, { tu: 2020, max: 0.75 }] },
  { tt: 9, ten: 'Hue University Journal of Science: Techniques and Technology', issn: ['25881175', '26159732'], moc: [{ max: 0.5 }, { tu: 2020, max: 0.75 }] },
  { tt: 10, ten: 'Nuclear Science and Technology', issn: ['18105408'], moc: [{ max: 0.75 }, { tu: 2017, max: 1.0 }] },
  { tt: 11, ten: 'Science and Technology Development Journal: Natural Science (cũ: Phát triển Khoa học & Công nghệ)', issn: ['2588106X', '18590128'], moc: [{ max: 0.75 }, { tu: 2019, max: 1.0 }] },
  { tt: 12, ten: 'Vietnam Journal of Science & Technology (cũ: Khoa học & Công nghệ)', issn: ['25252518', '28155874', '0866708X'], moc: [{ max: 1.0 }, { tu: 2019, max: 1.25 }, { tu: 2022, max: 1.5 }] },
  { tt: 13, ten: 'Vietnam Journal of Science and Technology (Series B)', issn: ['18594794'], moc: [{ max: 0.5 }, { tu: 2017, max: 0.75 }, { tu: 2020, max: 1.0 }] },
  { tt: 14, ten: 'Vietnam Journal of Science, Technology and Engineering (Bản C)', issn: ['25252461'], moc: [{ max: 1.0 }, { tu: 2019, max: 1.25 }, { tu: 2025, max: 1.0 }] },
  { tt: 15, ten: 'VNU Journal of Science: Mathematics - Physics', issn: ['26159341', '25881124', '08668612'], moc: [{ max: 1.0 }] },
  { tt: 16, ten: 'VNU Journal of Science: Natural Science and Technology', issn: ['26159317', '25881140', '08668612'], moc: [{ max: 1.0 }] },
  { tt: 17, ten: 'Nghiên cứu Khoa học và Công nghệ Quân sự', issn: ['18591043'], moc: [{ tu: 2022, max: 0.75 }] },
  { tt: 19, ten: 'Khoa học và Công nghệ - The University of Danang - Journal of Science and Technology', issn: ['18591531'], moc: [{ tu: 2023, max: 0.75 }] },
  { tt: 20, ten: 'JST: Kỹ thuật và Công nghệ cho phát triển bền vững / JST: Hệ thống và Thiết bị thông minh', issn: ['27349381', '27349373'], moc: [{ max: 0.5 }, { tu: 2024, max: 0.75 }] },
  { tt: 21, ten: 'CTU Journal of Innovation and Sustainable Development (cũ: Cantho University Journal of Science)', issn: ['25881418', '28156412'], moc: [{ max: 0.5 }, { tu: 2024, max: 0.75 }] },
  { tt: 22, ten: 'Khoa học Trường ĐH Sư phạm Hà Nội: Khoa học Tự nhiên', issn: ['23541059'], moc: [{ max: 0.5 }, { tu: 2024, max: 0.75 }] },
  { tt: 23, ten: 'Khoa học Trường ĐH Sư phạm TP Hồ Chí Minh', issn: ['27349918'], moc: [{ max: 0.5 }, { tu: 2024, max: 0.75 }] },
  { tt: 24, ten: 'Khoa học và Kỹ thuật (Học viện Kỹ thuật Quân sự)', issn: ['18590209'], moc: [{ max: 0.5 }, { tu: 2024, max: 0.75 }] },
  { tt: 25, ten: 'Khoa học và Công nghệ Đại học Duy Tân (DTU Journal of Science and Technology)', issn: ['18594905'], moc: [{ tu: 2024, max: 0.5 }] },
  { tt: 26, ten: 'Khoa học và Công nghệ - Trường Đại học Nguyễn Tất Thành', issn: ['26159015'], moc: [{ tu: 2024, max: 0.25 }] },
  { tt: 27, ten: 'Khoa học Trường Đại học Quy Nhơn', issn: ['18590357', '28156242'], moc: [{ tu: 2024, max: 0.5 }] },
  { tt: 28, ten: 'Khoa học và Công nghệ Giao thông Vận tải / Journal of Science and Transport Technology', issn: ['27349942', '27349950'], moc: [{ tu: 2024, max: 0.25 }, { tu: 2025, max: 0.5 }] },
  { tt: 29, ten: 'Khoa học Trường ĐH Sư phạm Hà Nội 2: Khoa học Tự nhiên và Công nghệ', issn: ['28155637', '18592325'], moc: [{ tu: 2018, max: 0.25 }, { tu: 2025, max: 0.5 }] },
];

/** Chuẩn hoá ISSN về 8 ký tự không gạch, chữ X hoa — khớp JournalRanking.issns. */
export const chuanIssn = (s: string | null | undefined): string[] =>
  String(s ?? '')
    .toUpperCase()
    .split(/[^0-9X-]+/)
    .map((x) => x.replace(/-/g, ''))
    .filter((x) => /^\d{7}[\dX]$/.test(x));

/** Trần của một tạp chí kể tên ở năm công bố; null = năm đó chưa vào danh mục (trước mốc đầu). */
export function tranTheoNam(tc: TapChiTrongNuoc, nam: number | null): number | null {
  let tran: number | null = null;
  for (const m of tc.moc) {
    if (m.tu == null || (nam != null && nam >= m.tu)) tran = m.max;
  }
  // Năm không rõ → lấy mức mới nhất (đang áp dụng), có cảnh báo ở nơi gọi.
  if (nam == null) tran = tc.moc[tc.moc.length - 1].max;
  return tran;
}

export function timTapChiTrongNuoc(issn: string | null | undefined): TapChiTrongNuoc | null {
  const ds = chuanIssn(issn);
  if (!ds.length) return null;
  return TAP_CHI_TRONG_NUOC.find((t) => t.issn.some((x) => ds.includes(x))) ?? null;
}

// ── Hạng mục ───────────────────────────────────────────────────────────────────
export const HANG_MUC = {
  wos: 'Mục 1 — Tạp chí quốc tế uy tín (WoS Core / Scopus)',
  'wos-baocao': 'Báo cáo trong kỷ yếu WoS/Scopus — tính như bài báo (QĐ 25/2020 IV.4)',
  'quocte-khac': 'Mục 2 — Tạp chí quốc tế khác có ISSN, chỉ mục Google Scholar',
  'hoinghi-qt': 'Mục 3 — Kỷ yếu hội nghị quốc tế tiếng Anh, ISBN, ngoài WoS/Scopus',
  'hoinghi-qg': 'Mục 4 — Kỷ yếu hội nghị quốc gia, có phản biện, ISBN',
  'trongnuoc-kten': 'Mục 5–29 — Tạp chí trong nước kể tên trong danh mục',
  'trongnuoc-khac': 'Mục 18 — Tạp chí trong nước khác thuộc lĩnh vực Vật lý, KH&CN',
  'sach-chuyen-khao': 'Sách chuyên khảo (QĐ 25/2020 III.1)',
  'giao-trinh': 'Giáo trình (QĐ 25/2020 III.2)',
  'sach-tham-khao': 'Sách tham khảo (QĐ 25/2020 III.3)',
  'sach-huong-dan': 'Sách hướng dẫn / từ điển chuyên ngành (QĐ 25/2020 III.4)',
  'chuong-sach': 'Chương sách tại NXB uy tín thế giới (QĐ 25/2020 III.6)',
  'sang-che': 'Bằng độc quyền sáng chế (QĐ 25/2020 II.1)',
  gphi: 'Giải pháp hữu ích được ứng dụng (QĐ 25/2020 II.2)',
  'khong-tinh': 'Không thuộc danh mục tính điểm',
} as const;
export type HangMuc = keyof typeof HANG_MUC;
export const HANG_MUC_KEYS = Object.keys(HANG_MUC) as HangMuc[];

/**
 * Nhóm để cộng theo chuẩn GS/PGS (Điều 5 khoản 9, Điều 6 khoản 8).
 *
 * Báo cáo trong kỷ yếu WoS/Scopus thuộc nhóm BÀI BÁO (chốt 21/11/2026): QĐ 25/2020
 * Phụ lục I mục IV.4 cho nó "được tính điểm như bài báo khoa học nhưng không được coi
 * là bài báo khoa học công bố trên tạp chí khoa học quốc tế có uy tín" — vế loại trừ
 * chỉ gạt nó khỏi phép ĐẾM bài quốc tế uy tín (quocTeUyTin = false), không gạt khỏi
 * ngưỡng "điểm tính từ các bài báo khoa học hoặc (và) bằng độc quyền sáng chế; giải
 * pháp hữu ích" (12 điểm GS / 6 điểm PGS). Bản trước để nó ở 'bao-cao' nên ngưỡng
 * này thấp oan với người công bố nhiều ở hội nghị WoS/Scopus. Báo cáo NGOÀI WoS/Scopus
 * (mục IV.1–3) vẫn là 'bao-cao' — không vào ngưỡng.
 */
export type NhomDiem = 'bai-bao' | 'bao-cao' | 'sach' | 'shtt' | 'khac';
const NHOM: Record<HangMuc, NhomDiem> = {
  wos: 'bai-bao',
  'wos-baocao': 'bai-bao',
  'quocte-khac': 'bai-bao',
  'hoinghi-qt': 'bao-cao',
  'hoinghi-qg': 'bao-cao',
  'trongnuoc-kten': 'bai-bao',
  'trongnuoc-khac': 'bai-bao',
  'sach-chuyen-khao': 'sach',
  'giao-trinh': 'sach',
  'sach-tham-khao': 'sach',
  'sach-huong-dan': 'sach',
  'chuong-sach': 'sach',
  'sang-che': 'shtt',
  gphi: 'shtt',
  'khong-tinh': 'khac',
};
export const nhomCua = (h: HangMuc): NhomDiem => NHOM[h];

/** Từ mã Phụ lục 2 (Trường) đoán hạng mục HĐGS — chỉ là GỢI Ý, cán bộ chọn lại được. */
export function hangMucTuMa(code: string | null | undefined): HangMuc | null {
  const c = String(code ?? '');
  if (/^1\.1[a-f]$/.test(c)) return 'wos';
  if (c === '1.2') return 'quocte-khac';
  if (c === '1.3' || /^1\.4[ab]$/.test(c)) return 'trongnuoc-khac'; // ISSN kể tên sẽ đè lên
  if (/^2\.1[a-e]$/.test(c)) return 'wos-baocao';
  if (c === '2.2') return 'hoinghi-qt';
  if (c === '2.3') return 'hoinghi-qg';
  if (/^2\.4[abc]$/.test(c)) return 'khong-tinh';
  if (['3.1a', '3.2a', '3.2b'].includes(c)) return 'sach-chuyen-khao';
  if (c === '3.1b') return 'giao-trinh';
  if (c === '3.1c') return 'sach-tham-khao';
  if (['3.2c', '3.2d'].includes(c)) return 'chuong-sach';
  if (c === '3.2e') return 'khong-tinh';
  if (['4.1', '4.2'].includes(c)) return 'sang-che';
  if (c === '4.3') return 'gphi';
  if (c === '4.4') return 'khong-tinh';
  return null;
}

/** Q từ mã Phụ lục 2 — dùng khi không có bảng SCImago đúng năm. */
export function qTuMa(code: string | null | undefined): string | null {
  return ({ '1.1a': 'Q1', '1.1b': 'Q1', '1.1c': 'Q2', '1.1d': 'Q3', '1.1e': 'Q4' } as Record<string, string>)[String(code ?? '')] ?? null;
}

// ── Mục 1: bậc trần theo tiêu chí (áp một hoặc/và các tiêu chí → lấy bậc CAO NHẤT) ──
export type TieuChiQuocTe = {
  quartile?: string | null;
  hIndex?: number | null;
  impactFactor?: number | null;
  /** Trích dẫn Google Scholar của BÀI, không tính tự trích dẫn. */
  trichDan?: number | null;
};

export function tranMuc1(t: TieuChiQuocTe): { tran: number; vi: string } {
  const ung: { tran: number; vi: string }[] = [{ tran: 1.5, vi: 'Q4 hoặc chưa có Q và IF' }];
  const q = (t.quartile ?? '').toUpperCase();
  if (q === 'Q1') {
    if ((t.hIndex ?? 0) > 50) ung.push({ tran: 3.0, vi: `Q1, H-index ${t.hIndex} > 50` });
    else ung.push({ tran: 2.5, vi: t.hIndex == null ? 'Q1 (chưa biết H-index)' : `Q1, H-index ${t.hIndex} ≤ 50` });
  } else if (q === 'Q2') ung.push({ tran: 2.5, vi: 'Q2' });
  else if (q === 'Q3') ung.push({ tran: 2.0, vi: 'Q3' });
  const IF = t.impactFactor;
  if (IF != null) {
    if (IF >= 4) ung.push({ tran: 3.0, vi: `IF ${IF} ≥ 4,0` });
    else if (IF >= 3) ung.push({ tran: 2.5, vi: `IF ${IF} ≥ 3,0` });
    else ung.push({ tran: 2.0, vi: `IF ${IF} < 3,0` });
  }
  const td = t.trichDan;
  if (td != null) {
    if (td > 30) ung.push({ tran: 3.0, vi: `${td} trích dẫn > 30` });
    else if (td > 20) ung.push({ tran: 2.5, vi: `${td} trích dẫn > 20` });
  }
  return ung.reduce((a, b) => (b.tran > a.tran ? b : a));
}

// ── Phần của một tác giả (QĐ 37/2018 Điều 8 + mục c danh mục Vật lý) ─────────────
export const TRAN_TAC_GIA = 10;

export type ViTriTacGia = {
  /** Tổng số tác giả của công trình. */
  tongTacGia: number;
  /** Số tác giả chính của công trình (đầu tiên + liên hệ duy nhất nếu khác người…). */
  soTacGiaChinh: number;
  laTacGiaChinh: boolean;
  /** % đóng góp ghi rõ của người này trên phần 2/3 (0–100); bỏ trống = chia đều. */
  dongGop?: number | null;
};

export function phanCuaToi(v: ViTriTacGia): { tyLe: number; vi: string } {
  const T = Math.max(1, Math.round(v.tongTacGia || 1));
  const n = Math.min(T, TRAN_TAC_GIA);
  const m = Math.max(1, v.soTacGiaChinh || 1);
  const motPhanBa = v.laTacGiaChinh ? 1 / 3 / m : 0;
  const coDongGop = v.dongGop != null && Number.isFinite(v.dongGop);
  const haiPhanBa = coDongGop ? (2 / 3) * Math.min(100, Math.max(0, v.dongGop as number)) / 100 : 2 / 3 / n;
  const phanChinh = v.laTacGiaChinh ? `tác giả chính 1/3${m > 1 ? ` ÷ ${m}` : ''}` : '';
  const phanChung = coDongGop
    ? `2/3 × ${v.dongGop}% đóng góp`
    : `2/3 ÷ ${n}${T > TRAN_TAC_GIA ? ` (${T} tác giả, tính tròn 10)` : ' tác giả'}`;
  return { tyLe: motPhanBa + haiPhanBa, vi: [phanChinh, phanChung].filter(Boolean).join(' + ') };
}

/**
 * Ai là tác giả chính THEO HĐGS NGÀNH VẬT LÝ: tác giả đầu tiên, và tác giả liên hệ
 * NẾU bài chỉ có MỘT tác giả liên hệ. KHÁC Phụ lục 2 của Trường: tác giả CUỐI không
 * được tính, nhiều tác giả liên hệ thì không ai trong số đó là tác giả chính.
 */
export function tacGiaChinhHdgs(lienHe: number[]): number[] {
  const duyNhat = [...new Set(lienHe.filter((i) => i >= 0))];
  return [...new Set([0, ...(duyNhat.length === 1 ? duyNhat : [])])];
}

// ── Chuẩn tối thiểu (QĐ 37/2018) ─────────────────────────────────────────────
export const CHUAN = {
  PGS: {
    nhan: 'Phó giáo sư (Điều 6 khoản 8, khoản 4b)',
    tong: 10,
    baNamCuoi: 2.5,
    baiBaoShtt: 6,
    sach: null as number | null,
    baiQuocTeChinh: 3,
    ghiChuBaiQT: 'bài báo trên tạp chí quốc tế uy tín là tác giả chính, tính từ sau khi bảo vệ luận án tiến sĩ',
  },
  GS: {
    nhan: 'Giáo sư (Điều 5 khoản 9, khoản 4b)',
    tong: 20,
    baNamCuoi: 5,
    baiBaoShtt: 12,
    sach: 3 as number | null,
    baiQuocTeChinh: 5,
    ghiChuBaiQT: 'bài báo trên tạp chí quốc tế uy tín là tác giả chính, tính từ sau khi đạt chuẩn phó giáo sư',
  },
} as const;
