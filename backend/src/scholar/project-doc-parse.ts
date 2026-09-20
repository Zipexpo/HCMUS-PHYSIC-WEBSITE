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

/** Một thành viên rút từ mục A9 (nhân lực) của thuyết minh — LUÔN là gợi ý. */
export type ThanhVienOcr = {
  /** Đã bỏ học hàm/học vị (ThS., PGS. TS.…). */
  name: string;
  role: 'LEAD' | 'SECRETARY' | 'MEMBER';
  org: string | null;
  /** Tổng tháng công lao động (B5.3) nếu có — cơ sở gợi ý tỷ lệ chia. */
  laborMonths: number | null;
  /** Tỷ lệ chia giờ gợi ý theo tháng công; null khi không có căn cứ. */
  sharePercent: number | null;
};

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
  /** Nhân sự (A9 thuyết minh) kèm tỷ lệ chia gợi ý. Rỗng nếu không rút được. */
  members: ThanhVienOcr[];
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
  members: [],
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

/** Bỏ dấu + hạ chữ thường để so tên (độc lập với name-match của backend). */
function chuanTen(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "ít nhất 2 từ có nghĩa" — lọc rác khỏi tên người. */
function nhieuTu(s: string): boolean {
  return (
    chuanTen(s)
      .split(' ')
      .filter((w) => w.length >= 2).length >= 2
  );
}

const HOC_VI =
  /^(?:gs\.?\s*tskh\.?|gs\.?\s*ts\.?|pgs\.?\s*ts\.?|gs\.?|pgs\.?|tskh\.?|ts\.?|ths\.?|th\.?\s*s\.?|cn\.?|ks\.?|bs\.?)\s+/i;

/** Lột học hàm/học vị đầu tên (tối đa hai tầng, vd "PGS. TS."). */
function boHocVi(s: string): string {
  let r = s.trim();
  for (let i = 0; i < 2; i++) r = r.replace(HOC_VI, '').trim();
  return r;
}

/**
 * Tháng công lao động của từng người trong thuyết minh (mục B5.3): các cụm dạng
 * "Nguyễn Vương Thùy Ngân: 5.7 tháng". Cộng dồn qua các nội dung. Khoá theo tên
 * đã chuẩn hoá (bỏ dấu) để ghép với danh sách A9.
 */
function thangCongTheoNguoi(
  text: string,
): Array<{ chuan: string; months: number }> {
  const phang = gonKhoangTrang(text);
  const out: Array<{ chuan: string; months: number }> = [];
  const re = /([^:>\d\n]{2,60}?):\s*(\d+(?:[.,]\d+)?)\s*tháng/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(phang))) {
    const chuan = chuanTen(boHocVi(m[1]));
    const so = Number(m[2].replace(',', '.'));
    if (chuan && Number.isFinite(so)) out.push({ chuan, months: so });
  }
  return out;
}

/**
 * Tổng tháng công của MỘT thành viên. B5.3 hay ghi TÊN GỌI rút gọn ("Ngân") kèm
 * chữ đứng trước, còn A9 ghi tên đầy đủ ("Nguyễn Vương Thùy Ngân") — nên khớp
 * theo TỪ CUỐI (tên gọi, phần định danh nhất trong tên Việt). Trả null nếu không
 * có căn cứ.
 */
function thangCongCuaNguoi(
  entries: Array<{ chuan: string; months: number }>,
  fullName: string,
): number | null {
  const toks = chuanTen(fullName).split(' ').filter(Boolean);
  const ten = toks[toks.length - 1]; // từ cuối = tên gọi
  if (!ten) return null;
  let sum = 0;
  let thay = false;
  for (const e of entries) {
    if (e.chuan === ten || e.chuan.endsWith(' ' + ten)) {
      sum += e.months;
      thay = true;
    }
  }
  return thay ? Math.round(sum * 10) / 10 : null;
}

/**
 * Nhân sự ở mục A9 của thuyết minh. Theo dõi vai trò theo dòng tiêu đề
 * ("Chủ nhiệm" / "Thành viên" / "Thư ký"), lấy các dòng bắt đầu bằng số thứ tự.
 */
function nhanSuA9(text: string): Array<{
  name: string;
  role: 'LEAD' | 'SECRETARY' | 'MEMBER';
  org: string | null;
}> {
  const ra: Array<{
    name: string;
    role: 'LEAD' | 'SECRETARY' | 'MEMBER';
    org: string | null;
  }> = [];
  let trong = false;
  let vai: 'LEAD' | 'SECRETARY' | 'MEMBER' | null = null;
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const c = chuanTen(line);
    if (/^a9\b/.test(c) || c.startsWith('a9.')) {
      trong = true;
      continue;
    }
    if (trong && /^a1[0-9]\b/.test(c)) break; // sang A10, A11…
    if (!trong || !line) continue;
    // Dòng đánh dấu vai trò (ngắn, không phải dòng phân loại có dấu "/").
    if (!line.includes('/')) {
      if (c === 'chu nhiem') {
        vai = 'LEAD';
        continue;
      }
      if (c === 'thanh vien' || c === 'thanh vien chinh') {
        vai = 'MEMBER';
        continue;
      }
      if (c.startsWith('thu ky')) {
        vai = 'SECRETARY';
        continue;
      }
    }
    if (/hoc ham|^tt\b/.test(c)) continue; // dòng tiêu đề bảng
    // Cho phép rác đầu dòng (dấu bullet "•", khoảng trắng) trước số thứ tự —
    // pdftotext -layout hay chèn "•" vào đầu dòng thành viên.
    const row = line.match(/^\W*\d+\s+(.+)$/);
    if (!row || !vai) continue;
    const clean = boHocVi(row[1]);
    // Giới tính (Nam/Nữ) là token đứng riêng, ngăn tên với đơn vị. KHÔNG dùng \b
    // sau "Nữ": ký tự có dấu không phải \w nên \b không khớp.
    const mg = clean.match(/^(.+?)\s+(?:Nam|Nữ)(?:\s+(.*))?$/);
    const name = gonKhoangTrang(mg ? mg[1] : clean);
    const org = mg ? gonKhoangTrang(mg[2] ?? '') || null : null;
    if (nhieuTu(name)) ra.push({ name, role: vai, org });
  }
  return ra;
}

/** Chia tỷ lệ theo tháng công, làm tròn sao cho tổng đúng 100 (nếu có căn cứ). */
function chiaTheoCong(
  ms: Array<{ laborMonths: number | null }>,
): (number | null)[] {
  const tong = ms.reduce((s, m) => s + (m.laborMonths ?? 0), 0);
  if (tong <= 0) return ms.map(() => null);
  const raw = ms.map((m) => ((m.laborMonths ?? 0) / tong) * 100);
  const san = raw.map((x) => Math.floor(x));
  let du = 100 - san.reduce((a, b) => a + b, 0);
  const thuTu = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < thuTu.length && du > 0; k++, du--) san[thuTu[k].i]++;
  return ms.map((m, i) => ((m.laborMonths ?? 0) > 0 ? san[i] : null));
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

  // Nhân sự (A9) + tháng công (B5.3) → gợi ý tỷ lệ chia. Chỉ thuyết minh mới có;
  // hợp đồng không liệt kê thành viên nên mảng rỗng, gopTruong sẽ lấy từ nguồn kia.
  const ns = nhanSuA9(t);
  if (ns.length) {
    const cong = thangCongTheoNguoi(t);
    const kemCong = ns.map((m) => ({
      ...m,
      laborMonths: thangCongCuaNguoi(cong, m.name),
    }));
    const shares = chiaTheoCong(kemCong);
    kq.members = kemCong.map((m, i) => ({ ...m, sharePercent: shares[i] }));
  }

  return kq;
}

/**
 * Gộp kết quả từ nhiều nguồn (hợp đồng, thuyết minh). Nguồn ĐỨNG TRƯỚC thắng ở
 * mỗi ô — nên truyền hợp đồng trước (có mã + hai mốc + số quyết định), thuyết
 * minh sau (bù tên/email/kinh phí khi hợp đồng thiếu).
 */
export function gopTruong(nguon: TruongDeTaiOcr[]): TruongDeTaiOcr {
  const kq: TruongDeTaiOcr = { ...RONG, members: [] };
  for (const key of Object.keys(kq) as (keyof TruongDeTaiOcr)[]) {
    if (key === 'members') continue; // mảng — xử lý riêng bên dưới
    for (const n of nguon) {
      const v = n[key];
      if (v !== null && v !== undefined && v !== '') {
        (kq as Record<keyof TruongDeTaiOcr, unknown>)[key] = v;
        break;
      }
    }
  }
  // Danh sách nhân sự: lấy nguồn ĐẦU TIÊN có danh sách không rỗng (thuyết minh) —
  // KHÔNG để mảng rỗng của hợp đồng ghi đè.
  for (const n of nguon) {
    if (n.members?.length) {
      kq.members = n.members;
      break;
    }
  }
  return kq;
}
