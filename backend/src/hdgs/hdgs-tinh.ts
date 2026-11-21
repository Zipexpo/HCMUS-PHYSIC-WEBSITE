/**
 * Tính điểm HĐGS ngành Vật lý cho TỪNG công trình của một người, và cộng theo chuẩn
 * GS/PGS — luật và căn cứ ở hdgs-vat-ly.ts. Tệp THUẦN (không Nest, không Prisma).
 */
import {
  CHUAN,
  HANG_MUC,
  HANG_MUC_KEYS,
  hangMucTuMa,
  nhomCua,
  phanCuaToi,
  qTuMa,
  tacGiaChinhHdgs,
  timTapChiTrongNuoc,
  tranMuc1,
  tranTheoNam,
  type HangMuc,
  type NhomDiem,
  type TapChiTrongNuoc,
} from './hdgs-vat-ly';

/** Dữ kiện hệ thống tự biết về một công trình của một người. */
export type CongTrinhVao = {
  id: string;
  title: string;
  containerTitle: string | null;
  type: string;
  catalogCode: string | null;
  issn: string | null;
  nam: number | null;
  status: string;
  /** Có DOI hoặc đường dẫn — coi như có xuất bản trực tuyến (cán bộ sửa được). */
  coOnline: boolean;
  tongTacGia: number;
  /** Hàng của người này (từ 0); -1/null = chưa chỉ hàng. */
  viTriToi: number | null;
  toiLaFirst: boolean;
  toiLaLienHe: boolean;
  /** Hàng của MỌI tác giả liên hệ trên bài (có tài khoản lẫn không). */
  lienHe: number[];
  /**
   * Bảng SCImago dùng cho bài này (bảng hiện hành lúc xuất bản), nếu tìm thấy.
   * `napLuc` = lúc nạp bảng đó (lần cập nhật cuối); `can` = năm bảng LẼ RA phải dùng
   * (năm xuất bản − 1) — khác `nam` khi `lech`.
   */
  sjr: {
    nam: number;
    quartile: string | null;
    hIndex: number | null;
    type: string;
    lech: boolean;
    napLuc?: Date | string | null;
    can?: number;
  } | null;
};

/** Phần cán bộ tự nhập (bảng HdgsInput). Bỏ trống = theo hệ thống. */
export type NhapTay = {
  hangMuc?: string | null;
  impactFactor?: number | null;
  trichDan?: number | null;
  quartile?: string | null;
  hIndex?: number | null;
  online?: boolean | null;
  dongGop?: number | null;
  laTacGiaChinh?: boolean | null;
  nxbUyTin?: boolean | null;
};

export type KetQuaCongTrinh = {
  id: string;
  title: string;
  containerTitle: string | null;
  nam: number | null;
  catalogCode: string | null;
  hangMuc: HangMuc;
  hangMucTuDong: HangMuc;
  nhanHangMuc: string;
  nhom: NhomDiem;
  tapChiKeTen: number | null;
  tran: number;
  viTran: string;
  quartile: string | null;
  nguonQ: string | null;
  hIndex: number | null;
  online: boolean;
  tongTacGia: number;
  laTacGiaChinh: boolean;
  soTacGiaChinh: number;
  tyLe: number;
  viTyLe: string;
  diem: number;
  /** Bài trên tạp chí quốc tế uy tín (mục 1, KHÔNG gồm báo cáo) — đếm cho chuẩn GS/PGS. */
  quocTeUyTin: boolean;
  daXuatBan: boolean;
  canhBao: string[];
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const HE_SO_NXB_UY_TIN = 1.25;
const TRAN_CO_DINH: Partial<Record<HangMuc, number>> = {
  'quocte-khac': 1.25,
  'sach-chuyen-khao': 3,
  'giao-trinh': 2,
  'sach-tham-khao': 1.5,
  'sach-huong-dan': 1,
  'chuong-sach': 1,
  'sang-che': 3,
  gphi: 2,
  'khong-tinh': 0,
};
const SACH_CONG_25: HangMuc[] = ['sach-chuyen-khao', 'giao-trinh', 'sach-tham-khao', 'sach-huong-dan'];

/**
 * " · nạp 21/11/2026" (giờ Việt Nam) — lần cập nhật cuối của bảng SCImago đã dùng.
 * Bảng lưu theo tạp chí × năm: nạp một lần là mọi bài dùng chung, muốn cập nhật thì
 * quản trị nạp lại bảng năm đó ở /xep-hang.
 */
function ngayNap(luc: Date | string | null | undefined): string {
  if (!luc) return '';
  const t = new Date(luc).getTime();
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return ` · nạp ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function doanHangMuc(ct: CongTrinhVao, keTen: TapChiTrongNuoc | null): { h: HangMuc; doan: boolean } {
  if (keTen) return { h: 'trongnuoc-kten', doan: false };
  const tuMa = hangMucTuMa(ct.catalogCode);
  if (tuMa) return { h: tuMa, doan: false };
  if (ct.sjr) return { h: /journal/i.test(ct.sjr.type) ? 'wos' : 'wos-baocao', doan: false };
  const t = ct.type;
  if (t === 'journal-article') return { h: 'quocte-khac', doan: true };
  if (t === 'proceedings-article') return { h: 'hoinghi-qt', doan: true };
  if (t === 'book' || t === 'monograph') return { h: 'sach-tham-khao', doan: true };
  if (t === 'patent') return { h: 'sang-che', doan: true };
  return { h: 'khong-tinh', doan: true };
}

export function tinhCongTrinh(ct: CongTrinhVao, nhap: NhapTay = {}): KetQuaCongTrinh {
  const canhBao: string[] = [];
  const keTen = timTapChiTrongNuoc(ct.issn);
  const tuDong = doanHangMuc(ct, keTen);
  const chon =
    nhap.hangMuc && (HANG_MUC_KEYS as string[]).includes(nhap.hangMuc) ? (nhap.hangMuc as HangMuc) : null;
  const h = chon ?? tuDong.h;
  if (!chon && tuDong.doan) {
    canhBao.push('Hạng mục do hệ thống ĐOÁN theo loại công trình (chưa có mã Phụ lục 2) — chọn lại nếu sai.');
  }
  const online = nhap.online ?? ct.coOnline;

  // Q / H-index: nhập tay > bảng SCImago hiện hành lúc xuất bản > mã đã khai.
  const qNhap = nhap.quartile ? nhap.quartile.toUpperCase() : null;
  const quartile = qNhap ?? ct.sjr?.quartile ?? qTuMa(ct.catalogCode);
  let nguonQ: string | null = null;
  if (qNhap) nguonQ = 'nhập tay';
  else if (ct.sjr?.quartile) {
    const luc = ngayNap(ct.sjr.napLuc);
    nguonQ = ct.sjr.lech
      ? `SCImago ${ct.sjr.nam}${luc} — chưa nạp bảng ${ct.sjr.can ?? '(năm xuất bản − 1)'}, đang tạm lấy bảng gần nhất; kiểm lại nếu hạng đã đổi`
      : `SCImago ${ct.sjr.nam}${luc}`;
  } else if (qTuMa(ct.catalogCode)) nguonQ = `theo mã ${ct.catalogCode} đã khai`;
  const hIndex = nhap.hIndex ?? ct.sjr?.hIndex ?? null;
  const muc1 = () => tranMuc1({ quartile, hIndex, impactFactor: nhap.impactFactor, trichDan: nhap.trichDan });

  let tran = 0;
  let viTran = '';
  if (h === 'wos' || h === 'wos-baocao') {
    const m1 = muc1();
    tran = m1.tran;
    viTran = m1.vi;
    if (quartile === 'Q1' && hIndex == null) {
      canhBao.push('Q1 nhưng chưa biết H-index tạp chí — nếu H-index > 50 thì trần là 3,0.');
    }
  } else if (h === 'hoinghi-qt') {
    tran = online ? 1.0 : 0.75;
    viTran = online ? 'kỷ yếu có online' : 'kỷ yếu không online';
  } else if (h === 'hoinghi-qg') {
    tran = online ? 0.75 : 0.5;
    viTran = online ? 'xuất bản trực tuyến' : 'không trực tuyến';
    if ((ct.nam ?? 0) >= 2017) canhBao.push('Từ năm 2017 kỷ yếu hội nghị quốc gia phải có ISBN.');
  } else if (h === 'trongnuoc-kten' && keTen) {
    const t = tranTheoNam(keTen, ct.nam);
    if (t == null) {
      tran = online ? 0.5 : 0.25;
      viTran = `mục ${keTen.tt} chưa vào danh mục năm ${ct.nam} — tạm xét theo mục 18`;
      canhBao.push(`Mục ${keTen.tt} chỉ được tính từ năm ${keTen.moc[0].tu}.`);
    } else {
      tran = t;
      viTran = `mục ${keTen.tt}: ${keTen.ten}` + (ct.nam ? `, năm ${ct.nam}` : '');
    }
    if (ct.nam == null) canhBao.push('Chưa có năm công bố — tạm lấy mức đang áp dụng.');
    // Tạp chí kể tên mà đồng thời thuộc Scopus/WoS (vd mục 12) → lấy mức cao hơn.
    if (ct.sjr && /journal/i.test(ct.sjr.type)) {
      const m1 = muc1();
      if (m1.tran > tran) {
        tran = m1.tran;
        viTran = `thuộc Scopus — theo mục 1 (${m1.vi})`;
      }
    }
  } else if (h === 'trongnuoc-kten' || h === 'trongnuoc-khac') {
    tran = online ? 0.5 : 0.25;
    viTran = online ? 'mục 18, có online' : 'mục 18, không online';
  } else {
    tran = TRAN_CO_DINH[h] ?? 0;
    viTran = HANG_MUC[h];
    if (nhap.nxbUyTin && SACH_CONG_25.includes(h)) {
      tran = tran * HE_SO_NXB_UY_TIN;
      viTran += ' + 25% (NXB uy tín thế giới)';
    }
    if (h === 'gphi') canhBao.push('Giải pháp hữu ích chỉ được tính khi được ứng dụng có hiệu quả trong thực tiễn.');
  }

  // Tác giả chính theo HĐGS ngành Vật lý.
  const chinhTheoViTri = tacGiaChinhHdgs(ct.lienHe);
  const biet = ct.viTriToi != null && ct.viTriToi >= 0;
  const laChinhTuDong = biet
    ? chinhTheoViTri.includes(ct.viTriToi as number)
    : ct.toiLaFirst || (ct.toiLaLienHe && new Set(ct.lienHe).size <= 1);
  const laTacGiaChinh = nhap.laTacGiaChinh ?? laChinhTuDong;
  if (!biet && nhap.laTacGiaChinh == null) {
    canhBao.push('Chưa chỉ hàng tác giả của Thầy/Cô trên bài — xác định tác giả chính theo cờ đã khai.');
  }
  const tongTacGia = Math.max(1, ct.tongTacGia || 1);
  let soTacGiaChinh = chinhTheoViTri.length;
  if (laTacGiaChinh && biet && !chinhTheoViTri.includes(ct.viTriToi as number)) soTacGiaChinh += 1;
  soTacGiaChinh = Math.max(1, Math.min(soTacGiaChinh, tongTacGia));
  const phan = phanCuaToi({ tongTacGia, soTacGiaChinh, laTacGiaChinh, dongGop: nhap.dongGop });

  const daXuatBan = ct.status === 'PUBLISHED';
  if (!daXuatBan) canhBao.push('Công trình chưa ở trạng thái đã xuất bản — chưa cộng điểm.');
  const diem = daXuatBan ? tran * phan.tyLe : 0;

  return {
    id: ct.id,
    title: ct.title,
    containerTitle: ct.containerTitle,
    nam: ct.nam,
    catalogCode: ct.catalogCode,
    hangMuc: h,
    hangMucTuDong: tuDong.h,
    nhanHangMuc: HANG_MUC[h],
    nhom: nhomCua(h),
    tapChiKeTen: keTen?.tt ?? null,
    tran: r3(tran),
    viTran,
    quartile,
    nguonQ,
    hIndex,
    online,
    tongTacGia,
    laTacGiaChinh,
    soTacGiaChinh,
    tyLe: r3(phan.tyLe),
    viTyLe: phan.vi,
    diem: r3(diem),
    quocTeUyTin: h === 'wos',
    daXuatBan,
    canhBao,
  };
}

// ── Cộng theo chuẩn GS / PGS ────────────────────────────────────────────────
export type MucChuan = { muc: string; dat: boolean; co: number; can: number };
export type TongHop = {
  tong: number;
  baNamCuoi: number;
  baiBaoShtt: number;
  baoCao: number;
  sach: number;
  sachGiaoTrinhChuyenKhao: number;
  baiQuocTeChinh: number;
  soCongTrinh: number;
  denNam: number;
  tuNamQuocTe: number | null;
  dat: { PGS: MucChuan[]; GS: MucChuan[] };
};

/**
 * `denNam` = năm hết hạn nộp hồ sơ: "ba năm cuối" lấy theo NĂM công bố (denNam−2 …
 * denNam) — nhiều bài chỉ có năm. `tuNamQuocTe` = năm bảo vệ luận án TS (PGS) / năm
 * đạt chuẩn PGS (GS): chỉ đếm bài quốc tế từ năm đó; bỏ trống = đếm hết.
 */
export function tongHop(ds: KetQuaCongTrinh[], denNam: number, tuNamQuocTe: number | null = null): TongHop {
  const cong = (f: (k: KetQuaCongTrinh) => boolean) => r3(ds.filter(f).reduce((t, k) => t + k.diem, 0));
  const tong = cong(() => true);
  const baNamCuoi = cong((k) => k.nam != null && k.nam >= denNam - 2 && k.nam <= denNam);
  // Bài báo GỒM cả báo cáo kỷ yếu WoS/Scopus (xem NHOM ở hdgs-vat-ly.ts);
  // `baoCao` chỉ còn báo cáo ngoài WoS/Scopus — không vào ngưỡng bài báo.
  const baiBaoShtt = cong((k) => k.nhom === 'bai-bao' || k.nhom === 'shtt');
  const baoCao = cong((k) => k.nhom === 'bao-cao');
  const sach = cong((k) => k.nhom === 'sach');
  const sachGiaoTrinhChuyenKhao = cong((k) => k.hangMuc === 'giao-trinh' || k.hangMuc === 'sach-chuyen-khao');
  const baiQuocTeChinh = ds.filter(
    (k) => k.quocTeUyTin && k.laTacGiaChinh && k.daXuatBan && (tuNamQuocTe == null || (k.nam ?? 0) >= tuNamQuocTe),
  ).length;
  const theo = (c: (typeof CHUAN)['PGS'] | (typeof CHUAN)['GS']): MucChuan[] =>
    [
      { muc: 'Tổng điểm công trình quy đổi', co: tong, can: c.tong },
      { muc: 'Điểm trong 3 năm cuối', co: baNamCuoi, can: c.baNamCuoi },
      {
        muc: 'Điểm từ bài báo (kể cả báo cáo kỷ yếu WoS/Scopus), sáng chế, giải pháp hữu ích',
        co: baiBaoShtt,
        can: c.baiBaoShtt,
      },
      ...(c.sach != null
        ? [
            { muc: 'Điểm từ sách phục vụ đào tạo', co: sach, can: c.sach },
            { muc: 'trong đó từ giáo trình / sách chuyên khảo', co: sachGiaoTrinhChuyenKhao, can: 1.5 },
          ]
        : []),
      { muc: `Số ${c.ghiChuBaiQT}`, co: baiQuocTeChinh, can: c.baiQuocTeChinh },
    ].map((x) => ({ ...x, dat: x.co >= x.can }));
  return {
    tong,
    baNamCuoi,
    baiBaoShtt,
    baoCao,
    sach,
    sachGiaoTrinhChuyenKhao,
    baiQuocTeChinh,
    soCongTrinh: ds.length,
    denNam,
    tuNamQuocTe,
    dat: { PGS: theo(CHUAN.PGS), GS: theo(CHUAN.GS) },
  };
}
