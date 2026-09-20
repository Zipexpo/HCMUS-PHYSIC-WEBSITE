/**
 * Bóc tách trường đề tài từ TEXT (do OCR hợp đồng hoặc trích thẳng thuyết minh).
 *
 * Đây là hàm THUẦN — không đọc đĩa, không gọi OCR — để test được bằng chính text
 * OCR thật mà không cần tesseract. Tầng trên (project-doc.service) lo phần đọc tệp
 * và gọi tesseract; ở đây chỉ nhận chuỗi và trả các ô đã điền sẵn.
 *
 * Kết quả LUÔN là gợi ý để người dùng SOÁT, không phải số chốt: OCR bản scan có
 * mộc đỏ đọc sai chữ số là chuyện thường (đo 19/9/2026: `@` thành `(2`, thiếu dấu
 * trong tên). Mọi ô đều có thể null; nút Lưu vẫn còn chốt chặn ngày ngược.
 */

export type TruongDeTaiOcr = {
  /** Mã đề tài, vd C2025-18-11. Ưu tiên lấy từ TÊN TỆP (chắc hơn OCR). */
  code: string | null;
  title: string | null;
  /** Số quyết định phê duyệt — căn cứ mốc "trong thời gian được phê duyệt". */
  decisionNo: string | null;
  /** VND, đã bỏ dấu chấm nghìn. */
  budget: number | null;
  months: number | null;
  startMonth: number | null;
  startYear: number | null;
  endMonth: number | null;
  endYear: number | null;
  funder: string | null;
  leadName: string | null;
  leadEmail: string | null;
};

const RONG: TruongDeTaiOcr = {
  code: null,
  title: null,
  decisionNo: null,
  budget: null,
  months: null,
  startMonth: null,
  startYear: null,
  endMonth: null,
  endYear: null,
  funder: null,
  leadName: null,
  leadEmail: null,
};

/** Gộp nhiều dòng OCR rời thành một chuỗi phẳng, gom khoảng trắng. */
function gonKhoangTrang(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** "125.000.000" → 125000000. Trả null nếu không phải chuỗi số. */
function soVnd(raw: string): number | null {
  const digits = raw.replace(/[.\s,]/g, '');
  if (!/^\d{4,}$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mã đề tài trong tên tệp: cụm CHỮ + 4 SỐ NĂM + "-số-số", vd C2025-18-11,
 * VL2020-18-02, DS.C2025-18-07. Đây là nguồn chắc nhất cho mã vì không qua OCR.
 */
export function maTuTenTep(fileName?: string | null): string | null {
  if (!fileName) return null;
  const m = fileName.match(/([A-Za-zĐĐ]{1,4}\d{4}-\d+-\d+)/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Bóc tách các ô từ một chuỗi text. `fileName` (nếu có) chỉ dùng để đoán mã.
 * KHÔNG suy diễn: ô nào không thấy mỏ neo thì để null, không đoán bừa.
 */
export function bocTachTruongDeTai(
  text: string,
  fileName?: string | null,
): TruongDeTaiOcr {
  const kq: TruongDeTaiOcr = { ...RONG };
  const t = text ?? '';
  const phang = gonKhoangTrang(t);

  // Mã: tên tệp trước, rồi tới "Số: C....-..-../HĐ" trong hợp đồng.
  kq.code = maTuTenTep(fileName);
  if (!kq.code) {
    const m = phang.match(/S[ốôo]\s*:?\s*([A-Za-zĐĐ]{1,4}\d{4}-\d+-\d+)/);
    if (m) kq.code = m[1].toUpperCase();
  }

  // Tên đề tài: chuỗi trong ngoặc kép sau "Đề tài" (Điều 1 hợp đồng), hoặc dòng
  // "Tên tiếng Việt:" (thuyết minh).
  const trongNgoac = phang.match(/Đề tài\s*["“”']([^"“”']{3,300}?)["“”']/);
  if (trongNgoac) {
    kq.title = gonKhoangTrang(trongNgoac[1]);
  } else {
    const tenVi = t.match(/Tên tiếng Việt\s*:?\s*(.+)/);
    if (tenVi) kq.title = gonKhoangTrang(tenVi[1]);
  }

  // Thời gian: "N tháng, từ tháng M năm Y đến tháng M2 năm Y2" (Điều 2 hợp đồng).
  const mocDay = phang.match(
    /(\d{1,3})\s*tháng[,.]?\s*từ\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})\s*đến\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i,
  );
  if (mocDay) {
    kq.months = Number(mocDay[1]);
    kq.startMonth = Number(mocDay[2]);
    kq.startYear = Number(mocDay[3]);
    kq.endMonth = Number(mocDay[4]);
    kq.endYear = Number(mocDay[5]);
  } else {
    // Không có đủ hai mốc (thường là thuyết minh: "24 tháng kể từ khi được
    // duyệt"). Lấy riêng số tháng gần chữ "Thời gian thực hiện".
    const chiThang =
      phang.match(/Thời gian thực hiện[^0-9]{0,40}(\d{1,3})\s*tháng/i) ||
      phang.match(/(\d{1,3})\s*tháng\s*\(?\s*kể từ/i);
    if (chiThang) kq.months = Number(chiThang[1]);
  }

  // Kinh phí: "Tổng kinh phí ... 125.000.000 đồng". "kính" là lỗi OCR hay gặp.
  const kinhPhi =
    phang.match(
      /T[oổ]ng\s*k[íiì]nh?\s*ph[íi][^0-9]{0,40}([\d.\s]{6,})\s*đồng/i,
    ) || phang.match(/([\d.]{7,})\s*đồng/);
  if (kinhPhi) kq.budget = soVnd(kinhPhi[1]);

  // Số quyết định: "Quyết định số: 86/QĐ-ĐHQG". Dừng ở ĐHQG, bỏ phần "ngày…".
  const qd = phang.match(
    /Quyết định số\s*:?\s*(\d+\s*\/\s*Q[ĐĐDÐ][-\s]*Đ?HQG)/,
  );
  if (qd) {
    kq.decisionNo = gonKhoangTrang(qd[1])
      .replace(/\s*\/\s*/, '/')
      .replace(/\s*-\s*/g, '-');
  }

  // Cơ quan tài trợ: chỉ điền khi thấy ĐHQG (đề tài loại A/B/C của ĐHQG-HCM).
  if (/ĐHQG/.test(phang)) kq.funder = 'ĐHQG-HCM';

  // Email: cụm hợp lệ đầu tiên. Trên hợp đồng scan `@` hay hỏng thành "(2" nên
  // thường bắt được từ thuyết minh (bản chữ) khi ghép chung.
  const email = phang.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (email) kq.leadEmail = email[1].toLowerCase();

  // Họ tên chủ nhiệm: "Họ và tên:" (không dính "…thủ trưởng:"). Dừng trước dấu
  // gạch đầu dòng hoặc nhãn kế (Địa chỉ / Điện thoại / Ngày sinh…), rồi cắt đuôi.
  const ten = phang.match(
    /Họ và tên\s*:?\s*(.{3,80}?)\s*(?:[-–]\s*)?(?=Địa chỉ|Điện thoại|Giới tính|Ngày|Email|Số CMND|$)/i,
  );
  if (ten) kq.leadName = gonKhoangTrang(ten[1]).replace(/[\s\-–:.]+$/, '');

  return kq;
}

/**
 * Gộp kết quả từ nhiều nguồn (hợp đồng, thuyết minh). Nguồn ĐỨNG TRƯỚC thắng ở
 * mỗi ô — nên truyền hợp đồng trước (có mã + hai mốc + số quyết định), thuyết
 * minh sau (bù tên/email/kinh phí khi hợp đồng thiếu).
 */
export function gopTruong(nguon: TruongDeTaiOcr[]): TruongDeTaiOcr {
  const kq: TruongDeTaiOcr = { ...RONG };
  for (const key of Object.keys(kq) as (keyof TruongDeTaiOcr)[]) {
    for (const n of nguon) {
      const v = n[key];
      if (v !== null && v !== undefined && v !== '') {
        (kq as Record<keyof TruongDeTaiOcr, unknown>)[key] = v;
        break;
      }
    }
  }
  return kq;
}
