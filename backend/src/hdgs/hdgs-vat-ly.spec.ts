import { describe, expect, it } from 'vitest';
import { chuanIssn, phanCuaToi, tacGiaChinhHdgs, timTapChiTrongNuoc, tranMuc1, tranTheoNam } from './hdgs-vat-ly';
import { tinhCongTrinh, tongHop, type CongTrinhVao } from './hdgs-tinh';

const ct = (x: Partial<CongTrinhVao> = {}): CongTrinhVao => ({
  id: 'p',
  title: 'Bài',
  containerTitle: 'J',
  type: 'journal-article',
  catalogCode: null,
  issn: null,
  nam: 2025,
  status: 'PUBLISHED',
  coOnline: true,
  tongTacGia: 5,
  viTriToi: 0,
  toiLaFirst: true,
  toiLaLienHe: false,
  lienHe: [0],
  sjr: null,
  ...x,
});
const gan = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.002);

describe('Mục 1 — trần theo tiêu chí, lấy bậc cao nhất (QĐ 26/QĐ-HĐGSNN 2025)', () => {
  it.each([
    [{ quartile: 'Q1', hIndex: 120 }, 3.0],
    [{ quartile: 'Q1', hIndex: 40 }, 2.5],
    [{ quartile: 'Q1', hIndex: 50 }, 2.5],
    [{ quartile: 'Q1' }, 2.5],
    [{ quartile: 'Q2' }, 2.5],
    [{ quartile: 'Q3' }, 2.0],
    [{ quartile: 'Q4' }, 1.5],
    [{}, 1.5],
    [{ quartile: 'Q3', impactFactor: 4.2 }, 3.0],
    [{ quartile: 'Q4', impactFactor: 3.1 }, 2.5],
    [{ quartile: 'Q4', impactFactor: 1.2 }, 2.0],
    [{ quartile: 'Q4', trichDan: 25 }, 2.5],
    [{ quartile: 'Q2', trichDan: 31 }, 3.0],
    [{ quartile: 'Q2', trichDan: 30 }, 2.5],
  ])('%j → %s', (t, tran) => expect(tranMuc1(t).tran).toBe(tran));
});

describe('Phần của tác giả (QĐ 37/2018 Điều 8 + mục c danh mục Vật lý)', () => {
  it('5 tác giả, tôi là tác giả chính duy nhất: 1/3 + 2/3 ÷ 5', () =>
    gan(phanCuaToi({ tongTacGia: 5, soTacGiaChinh: 1, laTacGiaChinh: true }).tyLe, 1 / 3 + 2 / 15));
  it('đồng tác giả: 2/3 ÷ 5', () => gan(phanCuaToi({ tongTacGia: 5, soTacGiaChinh: 1, laTacGiaChinh: false }).tyLe, 2 / 15));
  it('15 tác giả tính tròn 10', () => gan(phanCuaToi({ tongTacGia: 15, soTacGiaChinh: 1, laTacGiaChinh: false }).tyLe, 2 / 30));
  it('hai tác giả chính chia đôi phần 1/3', () =>
    gan(phanCuaToi({ tongTacGia: 4, soTacGiaChinh: 2, laTacGiaChinh: true }).tyLe, 1 / 6 + 1 / 6));
  it('một tác giả: trọn công trình', () => gan(phanCuaToi({ tongTacGia: 1, soTacGiaChinh: 1, laTacGiaChinh: true }).tyLe, 1));
  it('có % đóng góp ghi rõ: 2/3 × %', () =>
    gan(phanCuaToi({ tongTacGia: 6, soTacGiaChinh: 1, laTacGiaChinh: false, dongGop: 30 }).tyLe, 0.2));
});

describe('Tác giả chính theo HĐGS Vật lý — đầu tiên + liên hệ DUY NHẤT, không có tác giả cuối', () => {
  it('liên hệ duy nhất là người khác → hai tác giả chính', () => expect(tacGiaChinhHdgs([3])).toEqual([0, 3]));
  it('hai tác giả liên hệ → chỉ tác giả đầu', () => expect(tacGiaChinhHdgs([2, 3])).toEqual([0]));
  it('tác giả cuối (hàng 4/5), không liên hệ → KHÔNG phải tác giả chính', () => {
    const k = tinhCongTrinh(ct({ catalogCode: '1.1c', viTriToi: 4, toiLaFirst: false, lienHe: [0] }));
    expect(k.laTacGiaChinh).toBe(false);
    gan(k.diem, 2.5 * (2 / 15));
  });
});

describe('Tạp chí trong nước kể tên — mức theo năm công bố', () => {
  it('ISSN nhiều dạng', () => expect(chuanIssn('1859-221x; e-2615-9678')).toEqual(['1859221X', '26159678']));
  const cip = timTapChiTrongNuoc('0868-3166')!;
  it('Communications in Physics: 1,0 → 1,25 từ 2019 → 1,0 từ 2025', () => {
    expect(tranTheoNam(cip, 2018)).toBe(1.0);
    expect(tranTheoNam(cip, 2024)).toBe(1.25);
    expect(tranTheoNam(cip, 2025)).toBe(1.0);
  });
  it('Nguyễn Tất Thành chỉ từ 2024: năm 2023 tạm xét mục 18 + cảnh báo', () => {
    const k = tinhCongTrinh(ct({ issn: '2615-9015', nam: 2023 }));
    expect(k.hangMuc).toBe('trongnuoc-kten');
    expect(k.tran).toBe(0.5);
    expect(k.canhBao.join(' ')).toMatch(/từ năm 2024/);
    expect(tinhCongTrinh(ct({ issn: '2615-9015', nam: 2024 })).tran).toBe(0.25);
  });
  it('Tạp chí PT KH&CN ĐHQG-HCM (mã 1.3) ra đúng mục 11, 1,0 từ 2019', () => {
    const k = tinhCongTrinh(ct({ catalogCode: '1.3', issn: '2588-106X', nam: 2024 }));
    expect(k.tapChiKeTen).toBe(11);
    expect(k.tran).toBe(1.0);
  });
  it('VJST (mục 12) mà Scopus Q3 → lấy mức cao hơn của mục 1', () => {
    const k = tinhCongTrinh(
      ct({ issn: '2525-2518', nam: 2024, sjr: { nam: 2023, quartile: 'Q3', hIndex: 10, type: 'journal', lech: false } }),
    );
    expect(k.tran).toBe(2.0);
  });
  it('tạp chí trong nước khác (1.4b, không kể tên) → mục 18: 0,5 online / 0,25 không', () => {
    expect(tinhCongTrinh(ct({ catalogCode: '1.4b', issn: '1111-1111' })).tran).toBe(0.5);
    expect(tinhCongTrinh(ct({ catalogCode: '1.4b', issn: '1111-1111' }), { online: false }).tran).toBe(0.25);
  });
});

describe('Một công trình — hạng mục, nhập tay, trạng thái', () => {
  it('bài 1.1a, bảng SCImago Q1 H 180, tác giả đầu, 5 tác giả → 3,0 × (1/3 + 2/15)', () => {
    const k = tinhCongTrinh(ct({ catalogCode: '1.1a', sjr: { nam: 2024, quartile: 'Q1', hIndex: 180, type: 'journal', lech: false } }));
    expect(k.tran).toBe(3);
    gan(k.diem, 3 * (1 / 3 + 2 / 15));
    expect(k.quocTeUyTin).toBe(true);
  });
  it('báo cáo WoS/Scopus (2.1e) tính như bài báo nhưng KHÔNG đếm là bài quốc tế uy tín', () => {
    const k = tinhCongTrinh(ct({ catalogCode: '2.1e', type: 'proceedings-article' }));
    expect(k.hangMuc).toBe('wos-baocao');
    expect(k.tran).toBe(1.5);
    expect(k.quocTeUyTin).toBe(false);
  });
  it('nhập tay IF 5 nâng bài Q3 lên 3,0', () => expect(tinhCongTrinh(ct({ catalogCode: '1.1d' }), { impactFactor: 5 }).tran).toBe(3));
  it('giáo trình ở NXB uy tín thế giới cộng 25%', () =>
    expect(tinhCongTrinh(ct({ catalogCode: '3.1b', type: 'book' }), { nxbUyTin: true }).tran).toBe(2.5));
  it('bài chưa xuất bản → 0 điểm', () => expect(tinhCongTrinh(ct({ catalogCode: '1.1b', status: 'ACCEPTED' })).diem).toBe(0));
  it('tham luận 2.4c → không thuộc danh mục', () => expect(tinhCongTrinh(ct({ catalogCode: '2.4c' })).tran).toBe(0));
  it('không mã, không bảng → đoán + cảnh báo', () => {
    const k = tinhCongTrinh(ct({ catalogCode: null }));
    expect(k.hangMuc).toBe('quocte-khac');
    expect(k.canhBao.join(' ')).toMatch(/ĐOÁN/);
  });
});

describe('Cộng theo chuẩn PGS / GS (QĐ 37/2018 Điều 5–6)', () => {
  it('ba năm cuối theo năm công bố, đếm bài quốc tế tác giả chính từ năm cho trước', () => {
    const ds = [
      tinhCongTrinh(ct({ id: 'a', catalogCode: '1.1c', nam: 2025, tongTacGia: 1 })), // 2,5
      tinhCongTrinh(ct({ id: 'b', catalogCode: '1.1c', nam: 2019, tongTacGia: 1 })), // 2,5
      tinhCongTrinh(ct({ id: 'c', catalogCode: '3.1b', type: 'book', nam: 2024, tongTacGia: 1 })), // 2,0
    ];
    const t = tongHop(ds, 2026, 2020);
    expect(t.tong).toBe(7);
    expect(t.baNamCuoi).toBe(4.5);
    expect(t.baiBaoShtt).toBe(5);
    expect(t.sach).toBe(2);
    expect(t.baiQuocTeChinh).toBe(1);
    expect(t.dat.PGS.find((m) => m.muc.startsWith('Tổng'))?.dat).toBe(false);
    expect(t.dat.PGS.find((m) => m.muc.startsWith('Điểm trong 3'))?.dat).toBe(true);
  });

  it('báo cáo kỷ yếu WoS/Scopus vào ngưỡng điểm bài báo; báo cáo ngoài WoS/Scopus thì không (21/11/2026)', () => {
    const ds = [
      tinhCongTrinh(ct({ id: 'a', catalogCode: '1.1c', nam: 2025, tongTacGia: 1 })), // bài báo 2,5
      tinhCongTrinh(ct({ id: 'b', catalogCode: '2.1e', type: 'proceedings-article', nam: 2024, tongTacGia: 1 })), // 1,5
      tinhCongTrinh(ct({ id: 'c', catalogCode: '2.2', type: 'proceedings-article', nam: 2024, tongTacGia: 1 }), { online: true }), // 1,0
    ];
    expect(ds.map((k) => k.hangMuc)).toEqual(['wos', 'wos-baocao', 'hoinghi-qt']);
    const t = tongHop(ds, 2026);
    expect(t.tong).toBe(5);
    expect(t.baiBaoShtt).toBe(4);
    expect(t.baoCao).toBe(1);
    // Vẫn không đếm là bài quốc tế uy tín.
    expect(t.baiQuocTeChinh).toBe(1);
    expect(t.dat.PGS.find((m) => m.muc.startsWith('Điểm từ bài báo'))?.co).toBe(4);
  });
});

describe('Nguồn hạng Q ghi bảng SCImago đã dùng + lúc nạp (lần cập nhật cuối)', () => {
  const sjr = { nam: 2023, quartile: 'Q2', hIndex: 60, type: 'journal', lech: false, napLuc: new Date('2026-11-20T15:59:00Z'), can: 2023 };
  it('bảng đúng năm: ghi năm bảng và ngày nạp theo giờ Việt Nam', () => {
    expect(tinhCongTrinh(ct({ nam: 2024, sjr })).nguonQ).toBe('SCImago 2023 · nạp 20/11/2026');
    // 17:30Z ngày 20 = 00:30 ngày 21 giờ Việt Nam.
    const muon = { ...sjr, napLuc: '2026-11-20T17:30:00.000Z' };
    expect(tinhCongTrinh(ct({ nam: 2024, sjr: muon })).nguonQ).toBe('SCImago 2023 · nạp 21/11/2026');
  });
  it('chưa nạp bảng năm xuất bản − 1: nói rõ năm thiếu và đang tạm lấy bảng nào', () => {
    const q = tinhCongTrinh(ct({ nam: 2019, sjr: { ...sjr, lech: true, can: 2018 } })).nguonQ;
    expect(q).toContain('SCImago 2023 · nạp 20/11/2026');
    expect(q).toContain('chưa nạp bảng 2018');
  });
  it('dữ liệu cũ không có lúc nạp: chỉ ghi năm bảng', () => {
    expect(tinhCongTrinh(ct({ nam: 2024, sjr: { ...sjr, napLuc: undefined } })).nguonQ).toBe('SCImago 2023');
  });
});
