/**
 * BẢNG XẾP HẠNG cho Phụ lục 2 — phần THUẦN: đọc tệp CSV của SCImago / CORE, tính
 * hạng trong ngành, suy ra mã, áp luật tr. 2.2. Không CSDL, không mạng.
 *
 * Vì sao NẠP TỆP chứ không gọi thẳng SCImago: trang của họ chặn máy chủ
 * (Cloudflare), còn quản trị tải tệp CSV bằng trình duyệt mỗi năm một lần là xong.
 *
 * Trước 4/10/2026 form khai ghi "hệ thống không tự đoán Q1–Q4": giảng viên tự chọn
 * mã, không ai đối chiếu, và đợt soát toàn Khoa tìm ra hàng chục mã lệch.
 */

/** Thứ bậc mã tạp chí — số càng lớn càng cao (định mức 4500 → 1800 giờ). */
export const HANG_MA: Record<string, number> = {
  '1.1a': 5,
  '1.1b': 4,
  '1.1c': 3,
  '1.1d': 2,
  '1.1e': 1,
};
/** Thứ bậc mã hội nghị (CORE A* → C). */
export const HANG_MA_HOI_NGHI: Record<string, number> = {
  '2.1a': 4,
  '2.1b': 3,
  '2.1c': 2,
  '2.1d': 1,
};

/** Đọc CSV có nháy kép ("" là một dấu nháy trong ô). SCImago dùng `;`, CORE dùng `,`. */
export function docCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let f = '';
  let row: string[] = [];
  let q = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (q) {
      if (c === '"') {
        if (text[k + 1] === '"') {
          f += '"';
          k++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(f);
      f = '';
    } else if (c === '\n') {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else if (c !== '\r') f += c;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}

/** "1234-5678, 8765-432x" hoặc "12345678" → ["12345678", "8765432X"]. */
export function chuanHoaIssn(s?: string | null): string[] {
  const ds = (s ?? '').toUpperCase().match(/\d{4}-?\d{3}[\dX]/g) ?? [];
  return [...new Set(ds.map((x) => x.replace('-', '')))];
}

export type NganhHang = {
  name: string;
  quartile: string | null;
  /** Hạng trong ngành theo SJR giảm dần — như trang journalrank.php?category=… */
  rank: number;
  total: number;
};

export type TapChiNam = {
  sourceId: string;
  title: string;
  type: string;
  issns: string[];
  sjr: number | null;
  bestQuartile: string | null;
  categories: NganhHang[];
  /** Mã Phụ lục 2 theo RIÊNG bảng năm này. */
  code: string | null;
};

const MA_THEO_Q: Record<string, string> = { Q2: '1.1c', Q3: '1.1d', Q4: '1.1e' };

/** TOP 20 (mục 1.1a) = hạng ≤ 20 ở một ngành mà tạp chí là Q1 — hạng 18 ở ngành nó chỉ Q2 thì không tính. */
export function top20(cats: NganhHang[]): string[] {
  return cats
    .filter((c) => c.quartile === 'Q1' && c.rank > 0 && c.rank <= 20)
    .map((c) => `${c.name} #${c.rank}`);
}

/** Mã của MỘT bảng: Q1 + TOP 20 → 1.1a; Q1 → 1.1b; Q2/Q3/Q4 → 1.1c/d/e; kỷ yếu → 2.1e. */
export function maTheoBang(type: string, cats: NganhHang[]): string | null {
  if (type === 'conference and proceedings') return '2.1e';
  if (type !== 'journal') return null;
  let best: string | null = null;
  for (const c of cats) {
    if (!c.quartile) continue;
    const m =
      c.quartile === 'Q1'
        ? c.rank > 0 && c.rank <= 20
          ? '1.1a'
          : '1.1b'
        : MA_THEO_Q[c.quartile];
    if (m && (!best || HANG_MA[m] > HANG_MA[best])) best = m;
  }
  return best;
}

/**
 * Đọc tệp CSV SCImago MỘT năm (nút "Download data" ở journalrank.php) và tính hạng
 * TRONG NGÀNH: xếp các nguồn của từng ngành theo SJR giảm dần, đúng cách trang
 * SCImago xếp. Năm của bảng lấy từ cột "Total Docs. (YYYY)" — khỏi chọn nhầm.
 */
export function docBangSjr(text: string): { nam: number | null; ds: TapChiNam[] } {
  const rows = docCsv(text.replace(/^﻿/, ''), ';');
  const h = (rows[0] ?? []).map((x) => x.trim());
  const I = {
    sid: h.indexOf('Sourceid'),
    title: h.indexOf('Title'),
    type: h.indexOf('Type'),
    issn: h.indexOf('Issn'),
    sjr: h.indexOf('SJR'),
    bq: h.indexOf('SJR Best Quartile'),
    cats: h.lastIndexOf('Categories'),
  };
  if (I.sid < 0 || I.sjr < 0 || I.cats < 0) {
    throw new Error(
      'Tệp không phải bảng CSV của SCImago (thiếu cột Sourceid / SJR / Categories).',
    );
  }
  const namCot = h.map((c) => c.match(/^Total Docs\. \((\d{4})\)$/)).find(Boolean);
  type Tho = Omit<TapChiNam, 'categories' | 'code'> & {
    cats: [string, string | null][];
  };
  const ds: Tho[] = [];
  for (const r of rows.slice(1)) {
    if (r.length <= I.cats || !(r[I.sid] ?? '').trim()) continue;
    const sjr = Number.parseFloat((r[I.sjr] ?? '').replace(',', '.'));
    ds.push({
      sourceId: r[I.sid].trim(),
      title: (r[I.title] ?? '').trim(),
      type: (r[I.type] ?? '').trim(),
      issns: chuanHoaIssn(r[I.issn]),
      sjr: Number.isFinite(sjr) ? sjr : null,
      bestQuartile: (r[I.bq] ?? '').trim() || null,
      cats: (r[I.cats] ?? '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s): [string, string | null] => {
          const m = s.match(/^(.*) \((Q[1-4])\)$/);
          return m ? [m[1], m[2]] : [s.replace(/ \(-\)$/, ''), null];
        }),
    });
  }
  const theoNganh = new Map<string, Tho[]>();
  for (const x of ds) {
    for (const [c] of x.cats) {
      const a = theoNganh.get(c);
      if (a) a.push(x);
      else theoNganh.set(c, [x]);
    }
  }
  const hang = new Map<string, Map<string, number>>();
  for (const [c, a] of theoNganh) {
    a.sort((p, q) => (q.sjr ?? 0) - (p.sjr ?? 0));
    hang.set(c, new Map(a.map((x, i) => [x.sourceId, i + 1])));
  }
  return {
    nam: namCot ? Number(namCot[1]) : null,
    ds: ds.map(({ cats, ...x }) => {
      const categories = cats.map(([name, quartile]) => ({
        name,
        quartile,
        rank: hang.get(name)?.get(x.sourceId) ?? 0,
        total: theoNganh.get(name)?.length ?? 0,
      }));
      return { ...x, categories, code: maTheoBang(x.type, categories) };
    }),
  };
}

export type BangNam = {
  nam: number;
  ma: string | null;
  quartile: string | null;
  top20: string[];
};

/**
 * PHỤ LỤC 2 TR. 2.2: "Nếu trong năm công bố bài báo khoa học có bảng xếp hạng mới
 * … tính theo kết quả CAO HƠN giữa bảng xếp hạng mới được công bố và bảng xếp
 * hạng liền trước." SCImago công bố bảng năm (Y−1) trong năm Y, nên bài công bố
 * năm Y xét SJR (Y−1) và SJR (Y−2). Bảng (Y−1) chưa nạp (đầu năm SCImago chưa ra)
 * thì dùng hai bảng mới nhất đã có — và nói ra. Tạp chí vắng mặt ở một bảng đã
 * nạp (chưa vào / bị loại khỏi Scopus) thì bảng đó không cho mã nào.
 */
export function goiYTheoTr22(
  theoNam: Map<
    number,
    { code: string | null; bestQuartile: string | null; categories: NganhHang[] }
  >,
  namCongBo: number,
  namDaNap: number[],
): { ma: string | null; bang: BangNam[]; thieuBang: number | null } {
  const moi = namCongBo - 1;
  const coMoi = namDaNap.includes(moi);
  const xet = coMoi
    ? [moi, moi - 1].filter((n) => namDaNap.includes(n))
    : [...namDaNap].filter((n) => n < moi).sort((a, b) => b - a).slice(0, 2);
  const bang = xet.map((n) => {
    const x = theoNam.get(n);
    return {
      nam: n,
      ma: x?.code ?? null,
      quartile: x?.bestQuartile ?? null,
      top20: x ? top20(x.categories) : [],
    };
  });
  let ma: string | null = null;
  for (const b of bang) {
    if (b.ma && (!ma || (HANG_MA[b.ma] ?? 0) > (HANG_MA[ma] ?? 0))) ma = b.ma;
  }
  return { ma, bang, thieuBang: coMoi ? null : moi };
}

// ── CORE (hội nghị, Phụ lục 2 mục 2.1) ─────────────────────────────────────

export type HoiNghiCore = {
  source: string;
  title: string;
  acronym: string | null;
  rank: string;
};

/** Tệp CSV của portal.core.edu.au/conf-ranks (nút Export): Id, Title, Acronym, Source, Rank, … — KHÔNG có dòng tiêu đề. */
export function docBangCore(text: string): HoiNghiCore[] {
  return docCsv(text.replace(/^﻿/, ''), ',')
    .filter((r) => r.length >= 5 && /^\d+$/.test((r[0] ?? '').trim()) && (r[1] ?? '').trim())
    .map((r) => ({
      title: r[1].trim(),
      acronym: (r[2] ?? '').trim() || null,
      source: (r[3] ?? '').trim(),
      rank: (r[4] ?? '').trim(),
    }));
}

export function maTheoCore(rank: string | null | undefined): string | null {
  return ({ 'A*': '2.1a', A: '2.1b', B: '2.1c', C: '2.1d' } as Record<string, string>)[
    (rank ?? '').trim()
  ] ?? null;
}

/** Năm của một phiên bản CORE: "CORE2023" → 2023, "ICORE2026" → 2026. */
export function namBanCore(source: string): number {
  const m = source.match(/(\d{4})/);
  return m ? Number(m[1]) : 0;
}

/** Tên hội nghị để SO: bỏ dấu, năm, số thứ tự ("7th"), ngoặc, từ đệm. */
export function chuanTenHoiNghi(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)\b/g, ' ')
    .replace(/\b(proceedings|proc|of|the|on|in|and|for|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chữ viết tắt trong tên kỷ yếu: "(ICECIE)", "(IPMV 2026)", "ICASSP 2025 - …". */
export function vietTatUngVien(s: string): string[] {
  const ra = new Set<string>();
  for (const m of s.matchAll(/\(([A-Za-z][A-Za-z0-9&-]{1,15})(?:\s*'?\d{2,4})?\)/g)) {
    ra.add(m[1].toUpperCase());
  }
  for (const m of s.matchAll(/\b([A-Z][A-Z0-9&-]{2,15})(?=\s*'?\d{2,4}\b)/g)) {
    ra.add(m[1].toUpperCase());
  }
  return [...ra];
}

const tu = (s: string) => new Set(chuanTenHoiNghi(s).split(' ').filter(Boolean));
const giongNhau = (a: string, b: string) => {
  const x = tu(a);
  const y = tu(b);
  if (!x.size || !y.size) return 0;
  let chung = 0;
  for (const t of x) if (y.has(t)) chung++;
  return chung / (x.size + y.size - chung);
};

/**
 * Hội nghị trong CORE khớp với tên kỷ yếu. Ưu tiên chữ viết tắt (kèm ít nhiều chữ
 * trùng tên để khỏi nhầm hai hội nghị cùng viết tắt), sau đó mới so cả tên.
 * Trả mọi phiên bản của hội nghị khớp nhất.
 */
export function khopHoiNghi(venue: string, ds: HoiNghiCore[]): HoiNghiCore[] {
  const vt = new Set(vietTatUngVien(venue));
  const theoTen = new Map<string, HoiNghiCore[]>();
  for (const h of ds) {
    const k = chuanTenHoiNghi(h.title);
    const a = theoTen.get(k);
    if (a) a.push(h);
    else theoTen.set(k, [h]);
  }
  let tot: { diem: number; ds: HoiNghiCore[] } = { diem: 0, ds: [] };
  for (const nhom of theoTen.values()) {
    const h = nhom[0];
    const g = giongNhau(venue, h.title);
    const trungVietTat = nhom.some((x) => x.acronym && vt.has(x.acronym.toUpperCase()));
    const diem = trungVietTat ? (g >= 0.3 ? 1 + g : 0) : g >= 0.85 ? g : 0;
    if (diem > tot.diem) tot = { diem, ds: nhom };
  }
  return tot.ds;
}

/**
 * Mã gợi ý cho kỷ yếu theo CORE: phiên bản mới nhất ra không muộn hơn năm công bố
 * và phiên bản liền trước — lấy kết quả cao hơn, cùng tinh thần tr. 2.2 (Phụ lục 2
 * chỉ ghi "theo CORE"; Khoa vẫn quyết lần cuối).
 */
export function goiYTheoCore(
  khop: HoiNghiCore[],
  namCongBo: number,
): { ma: string | null; ban: HoiNghiCore[] } {
  const ban = [...khop]
    .filter((h) => namBanCore(h.source) <= namCongBo)
    .sort((a, b) => namBanCore(b.source) - namBanCore(a.source))
    .slice(0, 2);
  let ma: string | null = null;
  for (const h of ban) {
    const m = maTheoCore(h.rank);
    if (m && (!ma || HANG_MA_HOI_NGHI[m] > HANG_MA_HOI_NGHI[ma])) ma = m;
  }
  return { ma, ban };
}

// ── Tự động hoá (4/10/2026): tải CORE, nhắc nạp SJR, soát mã lệch ─────────────

/** Các phiên bản CORE ở ô chọn "source" của portal.core.edu.au/conf-ranks — mới nhất trước. */
export function docDanhSachBanCore(html: string): string[] {
  const chon =
    html.match(/<select[^>]*name=["']?source["']?[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? '';
  const ds = [...chon.matchAll(/<option[^>]*value=["']?([^"'>\s]+)/gi)]
    .map((m) => m[1])
    .filter((v) => /\d{4}/.test(v));
  return [...new Set(ds)].sort((a, b) => namBanCore(b) - namBanCore(a));
}

/** Hai phiên bản CORE cần có: mới nhất và liền trước — gợi ý xét cả hai, lấy cao hơn. */
export const banCoreCanCo = (dsTrenWeb: string[]) => dsTrenWeb.slice(0, 2);

/**
 * Bảng SJR còn THIẾU cho kỳ đánh giá đang chạy (01/11 năm Y−1 → 31/10 năm Y). Bài
 * công bố năm P cần SJR (P−1) và (P−2) (tr. 2.2), nên kỳ này cần SJR Y−1, Y−2, Y−3.
 * SCImago ra bảng năm n vào khoảng giữa năm n+1 — trước tháng 7 năm đó chưa nhắc.
 */
export function nhacBangSjr(daNap: number[], homNay: Date): string[] {
  const nam = homNay.getFullYear();
  const thang = homNay.getMonth() + 1;
  const Y = thang >= 11 ? nam + 1 : nam;
  const daRa = (n: number) => nam > n + 1 || (nam === n + 1 && thang >= 7);
  return [Y - 1, Y - 2, Y - 3]
    .filter((n) => daRa(n) && !daNap.includes(n))
    .map(
      (n) =>
        `Chưa nạp bảng SJR ${n} — kỳ đánh giá ${Y - 1}-${Y} cần bảng này (tr. 2.2 xét bảng mới và bảng liền trước của năm công bố).`,
    );
}

/** Định mức giờ của các mã so được với nhau — tạp chí (1.1) và kỷ yếu (2.1). */
export const GIO_MA: Record<string, number> = {
  '1.1a': 4500,
  '1.1b': 3600,
  '1.1c': 3000,
  '1.1d': 2400,
  '1.1e': 1800,
  '2.1a': 4500,
  '2.1b': 3600,
  '2.1c': 3000,
  '2.1d': 2400,
  '2.1e': 1800,
};

/** Quartile đi kèm mã (ô "Xếp hạng tạp chí" của bài) — kỷ yếu không có. */
export const QUARTILE_MA: Record<string, string> = {
  '1.1a': 'Q1',
  '1.1b': 'Q1',
  '1.1c': 'Q2',
  '1.1d': 'Q3',
  '1.1e': 'Q4',
};

/**
 * Mã đang khai LỆCH gợi ý theo hướng nào: 'nang' = bảng cho mã cao hơn (người khai
 * đang thiệt), 'ha' = khai cao hơn bảng, 'doi' = cùng định mức nhưng khác mục (vd
 * tạp chí ↔ kỷ yếu). null = trùng, hoặc mã ngoài nhóm so được (1.1f, 1.2, 2.2…).
 */
export function soSanhMa(
  maKhai: string | null | undefined,
  maGoiY: string | null | undefined,
): 'nang' | 'ha' | 'doi' | null {
  if (!maKhai || !maGoiY || maKhai === maGoiY) return null;
  const a = GIO_MA[maKhai];
  const b = GIO_MA[maGoiY];
  if (a === undefined || b === undefined) return null;
  return b > a ? 'nang' : b < a ? 'ha' : 'doi';
}
