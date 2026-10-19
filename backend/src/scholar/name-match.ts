/**
 * Khớp tên tác giả — nền của cơ chế "bài này có phải của bạn không".
 *
 * Tên người Việt khi đăng báo biến dạng rất nhiều:
 *   Nguyễn Vương Thuỳ Ngân → "Ngan V. T. Nguyen" · "N. V. T. Nguyen"
 *                          → "Nguyen Vuong Thuy Ngan" · "Thuy-Ngan V. Nguyen"
 *
 * Vì vậy KHÔNG đoán mò. Ba loại bằng chứng, theo đúng thứ tự tin cậy:
 *
 *   1. ORCID trùng                                   → chắc chắn
 *   2. Trùng một dạng tên đã đăng ký (ScholarNameVariant)
 *   3. So với HỌ TÊN THẬT (`khopHoTen`)
 *
 * và mỗi kết quả mang cờ `chac`: chỉ kết quả CHẮC mới được giao diện gắn sẵn (và
 * gửi lời mời); kết quả không chắc chỉ hiện thành GỢI Ý để người khai tự bấm.
 * Không mức nào tự gắn tên người khác vào bài: mọi lời mời đều PENDING cho tới
 * khi chính chủ bấm xác nhận.
 *
 * Luật cũ (tới 5/10/2026) coi là "giống" khi cùng bộ chữ cái đầu và chung MỘT từ
 * — với tên Việt, từ chung gần như luôn là họ "Nguyen" hay tên đệm "Van/Thi", nên
 * "Nguyen Van Thanh" khớp Nguyễn Văn Thắng, "Thi Huong Nguyen" khớp Nguyễn Thị
 * Hiên. Đo trên dữ liệu thật: luật cũ khớp 60/62 lời mời bị TỪ CHỐI (tức là mời
 * nhầm), 83 lời mời nhầm khác còn treo. Luật mới chỉ còn 2/62, và vẫn gắn chắc
 * 350/357 lời mời đã được XÁC NHẬN (7 còn lại thành gợi ý).
 */

/** Bỏ dấu tiếng Việt, hạ chữ thường, bỏ dấu câu, gom khoảng trắng. */
export function normalizeName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bo dau thanh + dau mu
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Ghép tên tác giả từ dạng Crossref {family, given} thành một chuỗi. */
export function joinAuthorName(a: {
  family?: string | null;
  given?: string | null;
  name?: string | null;
}): string {
  if (a.name) return String(a.name).trim();
  return [a.given, a.family].filter(Boolean).join(' ').trim();
}

const tachTu = (s: string) => normalizeName(s).split(' ').filter(Boolean);

type Signature = {
  /** Các từ đầy đủ (dài ≥ 2 ký tự): "nguyen", "ngan", "thuy". */
  words: Set<string>;
  /** Chữ cái đầu của MỌI từ, đã sắp xếp: "nntv". */
  initials: string;
};

export function signatureOf(name: string): Signature {
  const tokens = tachTu(name);
  return {
    words: new Set(tokens.filter((t) => t.length >= 2)),
    initials: tokens
      .map((t) => t[0])
      .sort()
      .join(''),
  };
}

/**
 * Giống LỎNG (luật cũ): cùng bộ chữ cái đầu VÀ chung ít nhất một từ đầy đủ.
 * Giữ lại cho chỗ chỉ cần "na ná" để XẾP HẠNG gợi ý — KHÔNG dùng để quyết định ai
 * là ai: "Nguyen Van Thanh" và "Nguyen Van Thang" giống nhau theo luật này.
 */
export function looselyMatches(a: string, b: string): boolean {
  const sa = signatureOf(a);
  const sb = signatureOf(b);
  if (!sa.initials || sa.initials !== sb.initials) return false;
  for (const w of sa.words) if (sb.words.has(w)) return true;
  return false;
}

/**
 * Tên trên bài so với HỌ TÊN THẬT (thứ tự Việt: họ … tên riêng):
 *
 *   'du'       mọi từ của họ tên thật đều có mặt, HỌ và TÊN RIÊNG viết ĐỦ (tên
 *              đệm được viết tắt) — "Thang V. Nguyen", "Nguyen Van Thang" ↔ Nguyễn Văn Thắng
 *   'mot-phan' thiếu vài từ (thường là tên đệm), họ và tên riêng viết đủ —
 *              "Thang Nguyen" ↔ Nguyễn Văn Thắng
 *   'viet-tat' đủ số từ nhưng HỌ hoặc TÊN RIÊNG chỉ có chữ cái đầu — mơ hồ:
 *              "T. V. Nguyen" (cũng là Nguyễn Văn Tịnh), "H. N. Long" (cũng là
 *              Hoàng Ngọc Long) ↔ Nguyễn Hoàng Long
 *   null       có từ ĐẦY ĐỦ không thuộc họ tên thật ("Nguyen Van Thanh" ↔ Thắng),
 *              hoặc thiếu họ, hoặc thiếu tên riêng.
 */
export type MucKhopTen = 'du' | 'mot-phan' | 'viet-tat';

export function khopHoTen(tenTrenBai: string, hoTen: string): MucKhopTen | null {
  const a = tachTu(tenTrenBai);
  const s = tachTu(hoTen);
  if (a.length < 2 || s.length < 2) return null;
  // 'day' = khớp bằng từ đầy đủ, 'tat' = bằng chữ cái đầu.
  const dung: Array<'day' | 'tat' | null> = new Array(s.length).fill(null);
  // Từ đầy đủ trước, dò từ CUỐI (tên riêng) — "Thanh Thanh" không ăn nhầm họ.
  for (const w of a.filter((t) => t.length >= 2)) {
    let k = -1;
    for (let j = s.length - 1; j >= 0; j--) {
      if (!dung[j] && s[j] === w) {
        k = j;
        break;
      }
    }
    if (k < 0) return null;
    dung[k] = 'day';
  }
  for (const c of a.filter((t) => t.length === 1)) {
    let k = -1;
    for (let j = 0; j < s.length; j++) {
      if (!dung[j] && s[j][0] === c) {
        k = j;
        break;
      }
    }
    if (k < 0) return null;
    dung[k] = 'tat';
  }
  const ten = dung[s.length - 1];
  const ho = dung[0];
  if (!ho) return null;
  const du = dung.every(Boolean);
  if (ten === 'day' && ho === 'day') return du ? 'du' : 'mot-phan';
  // HỌ hoặc TÊN RIÊNG chỉ còn chữ cái đầu → mơ hồ, chỉ là gợi ý. Ca thật 5/10/2026:
  // "H. N. Long" (OpenAlex viết tắt Hoàng Ngọc Long, ORCID khác) khớp đủ chữ cái
  // với Nguyễn Hoàng Long — thứ tự viết tắt không nói được chữ nào là họ. Họ viết
  // tắt + tên riêng đủ thì vẫn tính là "có thể" dù thiếu tên đệm: nhóm cộng tác lớn
  // in "T. Loan" cho Trương Thị Hồng Loan (bài COMET, 195 tác giả) — coi là
  // "không có tên" thì soát sẽ đòi gỡ một tác giả thật.
  if (ten === 'day' && ho === 'tat') return 'viet-tat';
  return du && ho === 'day' ? 'viet-tat' : null;
}

/**
 * Một dạng tên (đã đăng ký hoặc sắp lưu) có HỢP với họ tên thật không: mọi từ ánh
 * xạ được vào họ tên thật (từ đầy đủ khớp nguyên, chữ cái đầu khớp chữ đầu), và có
 * họ. Bắt ca bấm "Đó là tôi" NHẦM HÀNG rồi lưu luôn tên người khác thành tên mình
 * (gặp thật 3/10/2026: "Kieu T. Thi Huynh" trong danh sách tên của một thầy).
 */
export function hopVoiHoTen(dangTen: string, hoTen: string): boolean {
  const a = tachTu(dangTen);
  const s = tachTu(hoTen);
  if (!a.length || s.length < 2) return true;
  const dung = new Array<boolean>(s.length).fill(false);
  for (const w of a.filter((t) => t.length >= 2)) {
    let k = -1;
    for (let j = s.length - 1; j >= 0; j--) {
      if (!dung[j] && s[j] === w) {
        k = j;
        break;
      }
    }
    if (k < 0) return false;
    dung[k] = true;
  }
  for (const c of a.filter((t) => t.length === 1)) {
    const k = dung.findIndex((x, j) => !x && s[j][0] === c);
    if (k < 0) return false;
    dung[k] = true;
  }
  return dung[0];
}

export type CandidateProfile = {
  userId: string;
  orcid: string | null;
  /** Dạng tên đã đăng ký, đã chuẩn hoá. */
  normalizedVariants: string[];
  /** Họ tên trong hệ thống (họ trước, tên riêng sau). */
  displayName: string;
};

export type AuthorMatch = {
  authorIndex: number;
  userId: string;
  /** Vì sao khớp — hiện thẳng lên giao diện để người dùng hiểu và sửa được. */
  reason: 'orcid' | 'variant' | 'loose';
  /**
   * Đủ chắc để giao diện GẮN SẴN (và gửi lời mời khi lưu). false = chỉ gợi ý:
   * tên mơ hồ ("Long Nguyen", "T. V. Nguyen"), hoặc một hàng khớp nhiều người.
   */
  chac: boolean;
  /** ORCID trên bài khác ORCID trong hồ sơ — có thể vẫn là một người (nhiều người có 2 ORCID). */
  orcidKhac?: boolean;
};

const chuanOrcid = (v?: string | null) =>
  String(v ?? '')
    .replace(/[^0-9X]/gi, '')
    .toUpperCase()
    .slice(-16);

/** Mức tin của MỘT cặp (tác giả trên bài, người trong Khoa); null = không phải. */
export function danhGiaCap(
  author: {
    family?: string | null;
    given?: string | null;
    name?: string | null;
    orcid?: string | null;
  },
  c: CandidateProfile,
): (Omit<AuthorMatch, 'authorIndex' | 'userId'> & { diem: number }) | null {
  const ten = joinAuthorName(author);
  const oa = chuanOrcid(author.orcid);
  const oc = chuanOrcid(c.orcid);
  if (oa && oc && oa === oc) return { reason: 'orcid', chac: true, diem: 3 };
  const orcidKhac = Boolean(oa && oc);
  const extra = orcidKhac ? { orcidKhac: true } : {};
  const norm = normalizeName(ten);
  if (!norm) return null;
  const daDangKy = c.normalizedVariants.includes(norm);
  const reason = daDangKy ? 'variant' : 'loose';
  const soTu = norm.split(' ').length;
  const k = khopHoTen(ten, c.displayName);
  if (k === 'du') return { reason, chac: true, diem: 2, ...extra };
  if (k === 'mot-phan') return { reason, chac: soTu >= 3, diem: 1, ...extra };
  if (daDangKy) {
    // Dạng tên chính chủ đã đăng ký nhưng không theo khuôn họ tên (tên lạ, gõ
    // dính): tin khi đủ cụ thể — ≥ 3 từ trong đó ≥ 2 từ đầy đủ; viết tắt thì không.
    const day = norm.split(' ').filter((t) => t.length >= 2).length;
    return { reason, chac: soTu >= 3 && day >= 2, diem: 1, ...extra };
  }
  if (k === 'viet-tat') return { reason, chac: false, diem: 0.5, ...extra };
  return null;
}

/**
 * Dò danh sách tác giả của một bài, tìm những người trong Khoa có mặt trong đó.
 * Trả MỌI cặp có bằng chứng, mỗi cặp kèm `chac`:
 *   - mỗi hàng có nhiều nhất MỘT người chắc (nhiều người cùng chắc mà không ai
 *     hơn hẳn → không ai chắc: "Ngan Nguyen" giữa hai cô Ngân);
 *   - mỗi người chắc ở nhiều nhất MỘT hàng (bằng chứng mạnh hơn thắng).
 */
export function matchAuthors(
  authors: Array<{
    family?: string | null;
    given?: string | null;
    name?: string | null;
    orcid?: string | null;
  }>,
  candidates: CandidateProfile[],
): AuthorMatch[] {
  type Cap = AuthorMatch & { diem: number };
  const caps: Cap[] = [];
  authors.forEach((a, i) => {
    for (const c of candidates) {
      const r = danhGiaCap(a ?? {}, c);
      if (r) caps.push({ authorIndex: i, userId: c.userId, ...r });
    }
  });

  // Mỗi hàng: chỉ người chắc có điểm cao NHẤT, và cao hơn hẳn người thứ hai.
  const theoHang = new Map<number, Cap[]>();
  for (const c of caps.filter((x) => x.chac)) {
    theoHang.set(c.authorIndex, [...(theoHang.get(c.authorIndex) ?? []), c]);
  }
  for (const ds of theoHang.values()) {
    const max = Math.max(...ds.map((x) => x.diem));
    const dau = ds.filter((x) => x.diem === max);
    for (const x of ds) x.chac = dau.length === 1 && x === dau[0];
  }
  // Mỗi người: chỉ chắc ở hàng có điểm cao nhất, và cao hơn hẳn hàng khác.
  const theoNguoi = new Map<string, Cap[]>();
  for (const c of caps.filter((x) => x.chac)) {
    theoNguoi.set(c.userId, [...(theoNguoi.get(c.userId) ?? []), c]);
  }
  for (const ds of theoNguoi.values()) {
    const max = Math.max(...ds.map((x) => x.diem));
    const dau = ds.filter((x) => x.diem === max);
    for (const x of ds) x.chac = dau.length === 1 && x === dau[0];
  }

  return caps
    .sort(
      (x, y) =>
        x.authorIndex - y.authorIndex ||
        Number(y.chac) - Number(x.chac) ||
        y.diem - x.diem,
    )
    .map(({ diem: _diem, ...m }) => m);
}

/**
 * Hàng tốt nhất của MỘT người trong danh sách tác giả: hàng chắc trước, rồi tới
 * hàng điểm cao nhất. Dùng gợi ý "bạn là tác giả thứ mấy" lúc xác nhận lời mời.
 */
export function hangCuaNguoi(
  authors: Parameters<typeof matchAuthors>[0],
  nguoi: CandidateProfile,
): { authorIndex: number; chac: boolean } | null {
  let tot: { authorIndex: number; chac: boolean; diem: number } | null = null;
  const chacs: number[] = [];
  authors.forEach((a, i) => {
    const r = danhGiaCap(a ?? {}, nguoi);
    if (!r) return;
    if (r.chac) chacs.push(i);
    if (
      !tot ||
      Number(r.chac) > Number(tot.chac) ||
      (r.chac === tot.chac && r.diem > tot.diem)
    ) {
      tot = { authorIndex: i, chac: r.chac, diem: r.diem };
    }
  });
  if (!tot) return null;
  const t = tot as { authorIndex: number; chac: boolean; diem: number };
  // Hai hàng cùng "chắc" (bài ghi trùng tên) → không chắc hàng nào.
  return { authorIndex: t.authorIndex, chac: t.chac && chacs.length === 1 };
}

/**
 * Sinh sẵn các dạng tên hay gặp từ tên đầy đủ tiếng Việt, để người dùng chỉ phải
 * bỏ tick những dạng họ không dùng thay vì tự gõ ra từng dạng.
 *
 * "Nguyễn Vương Thuỳ Ngân" (họ = từ đầu) →
 *   Nguyen Vuong Thuy Ngan · Ngan V. T. Nguyen · N. V. T. Nguyen
 *   Vuong Thuy Ngan Nguyen · Ngan Nguyen
 */
export function suggestNameVariants(fullNameVi: string): string[] {
  const tokens = normalizeName(fullNameVi).split(' ').filter(Boolean);
  if (tokens.length < 2) return [];

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const family = cap(tokens[0]);
  const rest = tokens.slice(1).map(cap);
  const last = rest[rest.length - 1];
  const middle = rest.slice(0, -1);
  const mid = middle.map((w) => `${w[0]}.`).join(' ');

  const out = [
    [family, ...rest].join(' '), // Nguyen Vuong Thuy Ngan
    [last, mid, family].filter(Boolean).join(' '), // Ngan V. T. Nguyen
    [`${last[0]}.`, mid, family].filter(Boolean).join(' '), // N. V. T. Nguyen
    [...rest, family].join(' '), // Vuong Thuy Ngan Nguyen
    [last, family].join(' '), // Ngan Nguyen
  ];

  return [...new Set(out.filter((s) => s.trim().length > 1))];
}
