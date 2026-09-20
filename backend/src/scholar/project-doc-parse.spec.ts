import { describe, expect, it } from 'vitest';
import { bocTachTruongDeTai, gopTruong, maTuTenTep } from './project-doc-parse';

/**
 * Fixture là TEXT OCR THẬT (đo 19/9/2026, tesseract-vie trên bản scan hợp đồng
 * C2025-18-11) và text trích thẳng từ thuyết minh R01. Giữ nguyên cả lỗi OCR
 * ("kính phí", `@`→"(2", "QÐ") để test bám sát thực tế chứ không phải bản đã dọn.
 */
const HOP_DONG = `
Số: C2025-18-11/HĐ-KHCN
Căn cứ Quyết định số: 86/QÐ- ĐHQG ngày 25 tháng 01 năm 2025 của Giám đốc Đại học
Quốc gia Thành phố Hồ Chí Minh về việc giao nhiệm vụ và phê duyệt kinh phí
Bên giao (Bên A): Trường Đại học Khoa học Tự nhiên - ĐHQG-HCM (Cơ quan chủ trì)
- Đại diện: TRÀN MINH TRIẾT
Bên nhận (Bên B): Chủ nhiệm
- Họ và tên: NGUYÊN VƯƠNG THÙY NGÂN
- Địa chỉ: 227 Nguyễn Văn Cừ, Phường 4, Quận 5, Tp. HCM
- Email: nvtngan(2hcmus.edu.vn
Bên A đặt hàng và Bên B nhận đặt hàng thực hiện Đề tài "Nâng cao chất lượng ảnh cộng hưởng
từ não và tách khối u", theo các nội dung trong Thuyết minh đã được cấp có thẩm quyền phê duyệt
Điều 2. Thời gian thực hiện Hợp đồng
Thời gian thực hiện Đề tài là 24 tháng, từ tháng 02 năm 2025 đến tháng 02 năm 2027.
Điều 3. Kinh phí thực hiện Đề tài
1. Tổng kính phí thực hiện Đề tài là 125.000.000 đồng (Một trăm hai mươi lăm triệu đồng),
`;

const THUYET_MINH = `
A1. Tên nhiệm vụ
- Tên tiếng Việt: Nâng cao chất lượng ảnh cộng hưởng từ não và tách khối u
- Tên tiếng Anh: Enhancement of brain MRI and tumor detection
A4. Thời gian thực hiện
24 tháng (kể từ khi được duyệt).
A5. Tổng kinh phí
Tổng kinh phí: 125.000.000 đồng, gồm
A6. Chủ nhiệm
Học hàm, học vị, họ và tên: ThS. Nguyễn Vương Thùy Ngân
Ngày, tháng, năm sinh: 6/8/1992; Giới tính: Nữ
Điện thoại di động: 0765551728; Email: nvtngan@hcmus.edu.vn
`;

const TEN_TEP_HD = 'C2025-18-11-HD-KHCN-NguyenVuongThuyNgan-HopDong.pdf';

describe('maTuTenTep — mã đề tài lấy từ tên tệp', () => {
  it('mã loại C', () => {
    expect(maTuTenTep(TEN_TEP_HD)).toBe('C2025-18-11');
  });
  it('mã loại VL', () => {
    expect(maTuTenTep('VL2020-18-02-abc.pdf')).toBe('VL2020-18-02');
  });
  it('không có mã trong tên → null', () => {
    expect(maTuTenTep('HopDong-cuoicung.pdf')).toBeNull();
    expect(maTuTenTep(null)).toBeNull();
  });
});

describe('bocTachTruongDeTai — hợp đồng (bản scan OCR)', () => {
  const r = bocTachTruongDeTai(HOP_DONG, TEN_TEP_HD);

  it('mã lấy từ tên tệp', () => {
    expect(r.code).toBe('C2025-18-11');
  });

  it('tên đề tài từ chuỗi trong ngoặc kép ở Điều 1', () => {
    expect(r.title).toBe(
      'Nâng cao chất lượng ảnh cộng hưởng từ não và tách khối u',
    );
  });

  it('hai mốc + số tháng từ Điều 2 — đúng từng chữ số', () => {
    expect(r.months).toBe(24);
    expect(r.startMonth).toBe(2);
    expect(r.startYear).toBe(2025);
    expect(r.endMonth).toBe(2);
    expect(r.endYear).toBe(2027);
  });

  it('kinh phí bỏ dấu chấm nghìn, dù OCR ghi "kính phí"', () => {
    expect(r.budget).toBe(125000000);
  });

  it('số quyết định (chấp nhận QÐ do OCR)', () => {
    expect(r.decisionNo).toMatch(/^86\//);
    expect(r.decisionNo).toContain('HQG');
  });

  it('nhận ra tài trợ ĐHQG', () => {
    expect(r.funder).toBe('ĐHQG-HCM');
  });

  it('họ tên chủ nhiệm ở khối Bên B, không dính "Đại diện" bên A', () => {
    expect(r.leadName).toBe('NGUYÊN VƯƠNG THÙY NGÂN');
  });
});

describe('bocTachTruongDeTai — thuyết minh (bản chữ)', () => {
  const r = bocTachTruongDeTai(THUYET_MINH);

  it('tên đề tài từ "Tên tiếng Việt:"', () => {
    expect(r.title).toBe(
      'Nâng cao chất lượng ảnh cộng hưởng từ não và tách khối u',
    );
  });

  it('số tháng từ A4 "24 tháng kể từ khi được duyệt"', () => {
    expect(r.months).toBe(24);
  });

  it('KHÔNG có mốc ngày — thuyết minh không ghi ngày cụ thể', () => {
    expect(r.startYear).toBeNull();
    expect(r.endYear).toBeNull();
  });

  it('kinh phí', () => {
    expect(r.budget).toBe(125000000);
  });

  it('email chủ nhiệm (bản chữ nên @ đúng)', () => {
    expect(r.leadEmail).toBe('nvtngan@hcmus.edu.vn');
  });

  it('họ tên chủ nhiệm', () => {
    expect(r.leadName).toContain('Nguyễn Vương Thùy Ngân');
  });
});

describe('gopTruong — hợp đồng trước, thuyết minh sau', () => {
  const hd = bocTachTruongDeTai(HOP_DONG, TEN_TEP_HD);
  const tm = bocTachTruongDeTai(THUYET_MINH);
  const g = gopTruong([hd, tm]);

  it('lấy mốc ngày từ hợp đồng', () => {
    expect(g.startYear).toBe(2025);
    expect(g.endYear).toBe(2027);
  });

  it('lấy email sạch từ thuyết minh khi hợp đồng thiếu', () => {
    expect(g.leadEmail).toBe('nvtngan@hcmus.edu.vn');
  });

  it('mã và số quyết định vẫn từ hợp đồng', () => {
    expect(g.code).toBe('C2025-18-11');
    expect(g.decisionNo).toMatch(/^86\//);
  });
});

/**
 * Thuyết minh có mục A9 (nhân lực) và B5.3 (phân công theo tháng công). Giữ
 * nguyên chỗ tên bị XUỐNG DÒNG giữa chừng ở B5.3 như bản trích thật, để chắc
 * hàm gom khoảng trắng vẫn ghép đúng.
 */
const THUYET_MINH_NHAN_SU = `
A9. Nhân lực nghiên cứu
Chủ nhiệm/ thư ký khoa học/ thành viên chính
Chủ nhiệm
TT Học hàm, học vị, Họ tên Giới tính Đơn vị công tác
1 ThS. Nguyễn Vương Thùy Ngân Nữ Trường Đại học Khoa học tự nhiên
Thành viên
TT Học hàm, học vị, Họ tên Giới tính Đơn vị công tác
1 PGS. TS. Đặng Văn Liệt Nam
A10. Kết quả nghiên cứu
B5.3 Tóm tắt công việc và phân công
Nội dung 1 Khử nhiễu. Chủ trì:
Nguyễn Vương Thùy
Ngân: 5.7 tháng
Tham gia:
Đặng Văn Liệt: 2.6 tháng
Nội dung 2 Phân tách khối u. Chủ trì:
Nguyễn Vương Thùy Ngân: 5.6 tháng
Tham gia:
Đặng Văn Liệt: 2.6 tháng
`;

describe('bocTachTruongDeTai — nhân sự A9 + chia theo tháng công', () => {
  const r = bocTachTruongDeTai(THUYET_MINH_NHAN_SU);

  it('rút đúng hai người, đúng vai trò', () => {
    expect(r.members.map((m) => [m.name, m.role])).toEqual([
      ['Nguyễn Vương Thùy Ngân', 'LEAD'],
      ['Đặng Văn Liệt', 'MEMBER'],
    ]);
  });

  it('bỏ học hàm/học vị khỏi tên', () => {
    expect(r.members[0].name).not.toMatch(/ThS|PGS|TS/);
    expect(r.members[1].name).not.toMatch(/PGS|TS/);
  });

  it('cộng dồn tháng công qua các nội dung', () => {
    expect(r.members[0].laborMonths).toBeCloseTo(11.3, 5); // 5.7 + 5.6
    expect(r.members[1].laborMonths).toBeCloseTo(5.2, 5); // 2.6 + 2.6
  });

  it('chia tỷ lệ theo tháng công, tổng đúng 100', () => {
    expect(r.members[0].sharePercent).toBe(68);
    expect(r.members[1].sharePercent).toBe(32);
    expect(r.members.reduce((s, m) => s + (m.sharePercent ?? 0), 0)).toBe(100);
  });

  it('đơn vị của chủ nhiệm lấy được từ cột Đơn vị công tác', () => {
    expect(r.members[0].org).toContain('Khoa học tự nhiên');
  });
});

describe('gopTruong — nhân sự chỉ có ở thuyết minh, không bị hợp đồng ghi đè', () => {
  it('lấy danh sách từ thuyết minh dù hợp đồng đứng trước', () => {
    const hd = bocTachTruongDeTai(HOP_DONG, TEN_TEP_HD); // không có A9
    const tm = bocTachTruongDeTai(THUYET_MINH_NHAN_SU);
    const g = gopTruong([hd, tm]);
    expect(g.members).toHaveLength(2);
    expect(g.members[0].name).toBe('Nguyễn Vương Thùy Ngân');
  });
});

/**
 * ĐÚNG dạng `pdftotext -layout` của bản thật (đo 20/9): cột cách nhau nhiều
 * khoảng trắng, dòng thành viên thứ hai bị chèn dấu bullet "•" ở đầu, và mục
 * B5.3 ghi TÊN GỌI rút gọn ("Ngân") kèm chữ mô tả đứng trước. Đây là bản mà
 * lần đầu chỉ rút được 1 người — giữ test để không tái lỗi.
 */
const TM_LAYOUT = `
    A9. Nhân lực nghiên cứu
    (Cung cấp lý lịch khoa học của cá nhân...)
    Chủ nhiệm/ thư ký khoa học/ thành viên chính
    Chủ nhiệm
      TT          Học hàm, học vị, Họ tên                 Giới tính                     Đơn vị công tác
      1    ThS. Nguyễn Vương Thùy Ngân               Nữ                    Trường Đại học Khoa học tự nhiên
    Thành viên
      TT          Học hàm, học vị, Họ tên                 Giới tính                     Đơn vị công tác
•      1     PGS. TS. Đặng Văn Liệt                  Nam
    A10. Kết quả nghiên cứu
    B5.3 Tóm tắt công việc và phân công
                   khử nhiễu và tăng cường ảnh                              Ngân: 5.7 tháng
                                                                            Đặng Văn Liệt: 2.6 tháng
                                                                            Ngân: 5.6 tháng
                                                                            Đặng Văn Liệt: 2.6 tháng
`;

describe('bocTachTruongDeTai — đúng dạng pdftotext -layout (bullet + tên rút gọn)', () => {
  const r = bocTachTruongDeTai(TM_LAYOUT);

  it('rút ĐỦ hai người dù dòng thứ hai có dấu bullet "•" ở đầu', () => {
    expect(r.members.map((m) => [m.name, m.role])).toEqual([
      ['Nguyễn Vương Thùy Ngân', 'LEAD'],
      ['Đặng Văn Liệt', 'MEMBER'],
    ]);
  });

  it('khớp tháng công theo tên gọi rút gọn "Ngân", tổng 100', () => {
    expect(r.members[0].laborMonths).toBeCloseTo(11.3, 5);
    expect(r.members[1].laborMonths).toBeCloseTo(5.2, 5);
    expect(r.members[0].sharePercent).toBe(68);
    expect(r.members[1].sharePercent).toBe(32);
  });
});
