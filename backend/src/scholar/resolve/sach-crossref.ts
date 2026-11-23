import { matchAuthors, type CandidateProfile } from '../name-match';
import {
  asArr,
  asObj,
  asStr,
  dateParts,
  dig,
  firstStr,
  khoaTieuDe,
  normalizeDoi,
  normalizeIsbn,
  parseMonth,
  parseYear,
  type ResolvedAuthor,
  type ResolvedWork,
} from './work';

/**
 * SÁCH TRA THEO ISBN QUA CROSSREF — và các CHƯƠNG của nó.
 *
 * Trước 23/11/2026 tra ISBN chỉ hỏi OpenLibrary + Google Books (không khoá, hạn mức
 * chung hay hết). Sách học thuật quốc tế (CRC, Springer, World Scientific…) hầu hết
 * có DOI trên Crossref, kèm từng chương và tác giả từng chương — đúng thứ người khai
 * CHƯƠNG SÁCH cần. Crossref miễn phí, không cần khoá.
 *
 * Một cuốn thường có nhiều ISBN (bìa cứng, bìa mềm, điện tử), và nhà xuất bản hay
 * đăng ký chương dưới MỘT ISBN khác ISBN người khai cầm (ca thật: Handbook of
 * Applications of Chaos Theory — 14 chương ghi ISBN bìa cứng, 41 chương ghi ISBN điện
 * tử). Nên sau lượt hỏi đầu, hỏi tiếp các ISBN anh em và bản ghi SÁCH suy từ DOI
 * chương (10.1201/b20232-5 → 10.1201/b20232).
 *
 * ISBN chưa từng đăng ký trên Crossref (vd bìa mềm in lại) thì vẫn không ra — khi
 * đó người khai dán DOI chương, hoặc nhập ISBN bản gốc.
 */

/** Loại Crossref là cả cuốn sách. */
const LOAI_SACH = new Set([
  'book',
  'edited-book',
  'monograph',
  'reference-book',
]);
/** Loại Crossref là một phần trong sách. */
const LOAI_CHUONG = new Set([
  'book-chapter',
  'book-part',
  'book-section',
  'reference-entry',
]);

/** Trang phụ của sách — không phải chương ai khai. */
const TRANG_PHU =
  /^(index|subject index|author index|preface|foreword|contents|table of contents|front ?matter|back ?matter|editors?|about the (authors?|editors?)|(list of )?contributors|acknowledge?ments?|bibliography|references|copyright( page)?|title page|half title|dedication|series page|glossary)$/i;

/** Một mục Crossref đã bóc gọn. */
export type MucCrossref = {
  doi: string;
  type: string;
  title: string;
  containerTitle: string | null;
  isbns: string[];
  publisher: string | null;
  pages: string | null;
  year: number | null;
  month: number | null;
  url: string | null;
  authors: ResolvedAuthor[];
  editors: ResolvedAuthor[];
};

/** Chương gửi về giao diện để người khai chọn. */
export type ChuongSach = {
  doi: string;
  title: string;
  pages: string | null;
  year: number | null;
  tacGia: string[];
  /** Người trong Khoa đứng tên chương (khớp CHẮC theo tên/ORCID). */
  nguoiKhoa: string[];
  /** Có hàng tác giả khớp người đang khai (kể cả chỉ là gợi ý). */
  cuaToi: boolean;
};

export type SachCrossref = {
  /** Cuốn sách — null khi Crossref không có gì cho ISBN này. */
  sach: ResolvedWork | null;
  /** `sach` ghép từ thông tin của các chương (Crossref không có bản ghi cả cuốn). */
  ghep: boolean;
  /** Năm sớm nhất trong mọi bản ghi của cuốn (thường là lần in đầu). */
  namSomNhat: number | null;
  /** Chương kèm tác giả gốc — để dò người trong Khoa. */
  chuong: Array<ChuongSach & { authors: ResolvedAuthor[] }>;
};

/** ISBN-10 → ISBN-13 (Crossref ghi bản 13 số); ISBN-13 giữ nguyên. */
export function isbn13(isbn: string): string {
  const s = normalizeIsbn(isbn);
  if (!s || s.length === 13) return s ?? isbn;
  const goc = `978${s.slice(0, 9)}`;
  const tong = [...goc].reduce((t, c, i) => t + Number(c) * (i % 2 ? 3 : 1), 0);
  return `${goc}${(10 - (tong % 10)) % 10}`;
}

/**
 * DOI cuốn sách suy từ DOI chương, theo cách đặt của các nhà xuất bản lớn:
 * 10.1201/b20232-5 → 10.1201/b20232 (CRC/T&F), 10.1007/978-3-030-1-6_5 →
 * 10.1007/978-3-030-1-6 (Springer), 10.1142/9789811234567_0005 (World Scientific),
 * 10.1002/9781119.ch5 (Wiley), 10.1088/978-0-7503-1-5ch5 (IOP). Không đoán được → null.
 */
export function doiSachTuChuong(doi: string): string | null {
  const d = normalizeDoi(doi);
  if (!d) return null;
  const sach = d.replace(/(?:[-_]\d{1,4}|\.ch\d{1,3}|ch\d{1,3})$/i, '');
  return sach !== d && normalizeDoi(sach) ? sach : null;
}

const tacGia = (raw: unknown): ResolvedAuthor[] =>
  asArr(raw).map((x, i): ResolvedAuthor => {
    const a = asObj(x);
    return {
      family: asStr(a.family),
      given: asStr(a.given),
      name: asStr(a.name),
      orcid: asStr(a.ORCID),
      sequence:
        asStr(a.sequence) === 'first' || (i === 0 && !asStr(a.sequence))
          ? 'first'
          : 'additional',
      affiliation: null,
    };
  });

/** Một mục trong `message.items` của Crossref → MucCrossref; thiếu DOI/tên → null. */
export function docMuc(raw: unknown): MucCrossref | null {
  const m = asObj(raw);
  const doi = normalizeDoi(asStr(m.DOI));
  const title = firstStr(m.title);
  if (!doi || !title) return null;
  const subtitle = firstStr(m.subtitle);
  // Sách in: "published-print"/"issued"; sớm hơn thì có "published-online".
  const ngay = [
    dateParts(m['published-print']),
    dateParts(m['published-online']),
    dateParts(m.issued),
  ]
    .map((p) => ({ y: parseYear(asStr(p[0])), m: parseMonth(asStr(p[1])) }))
    .filter((p) => p.y !== null)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))[0];
  return {
    doi,
    type: asStr(m.type) ?? '',
    title:
      subtitle && !title.includes(subtitle) ? `${title}: ${subtitle}` : title,
    containerTitle: firstStr(m['container-title']),
    isbns: [
      ...new Set(
        [
          ...asArr(m.ISBN).map(asStr),
          ...asArr(m['isbn-type']).map((x) => asStr(dig(x, 'value'))),
        ]
          .map((x) => normalizeIsbn(x))
          .filter((x): x is string => !!x)
          .map(isbn13),
      ),
    ],
    publisher: asStr(m.publisher),
    pages: asStr(m.page),
    year: ngay?.y ?? null,
    month: ngay?.m ?? null,
    url: asStr(m.URL) ?? `https://doi.org/${doi}`,
    authors: tacGia(m.author),
    editors: tacGia(m.editor),
  };
}

export const laSach = (m: MucCrossref) => LOAI_SACH.has(m.type);
export const laChuong = (m: MucCrossref) => LOAI_CHUONG.has(m.type);

export const tenTacGia = (a: ResolvedAuthor) =>
  (a.name ?? [a.given, a.family].filter(Boolean).join(' ')).trim();

/** Số thứ tự chương lấy từ đuôi DOI (…-5, …_0005, .ch5) để xếp như mục lục. */
const soThuTu = (doi: string) =>
  Number(doi.match(/(\d{1,4})$/)?.[1] ?? Number.MAX_SAFE_INTEGER);

/**
 * Gom các mục Crossref (đã hỏi theo ISBN và theo DOI sách) thành MỘT cuốn + danh
 * sách chương. `isbn` = ISBN người khai nhập — gắn vào cuốn sách trả về.
 */
export function gomSach(isbn: string, muc: MucCrossref[]): SachCrossref {
  const theoDoi = new Map<string, MucCrossref>();
  for (const m of muc) if (!theoDoi.has(m.doi)) theoDoi.set(m.doi, m);
  const tatCa = [...theoDoi.values()];
  const i13 = isbn13(isbn);

  const sachDs = tatCa.filter(laSach);
  const banSach =
    sachDs.find((s) => s.isbns.includes(i13)) ?? sachDs[0] ?? null;

  // Một chương có thể được đăng ký HAI lần (bản in + bản điện tử, hai DOI) — giữ
  // bản nhiều tác giả hơn, có số trang, rồi DOI nhỏ hơn.
  const theoTen = new Map<string, MucCrossref>();
  for (const c of tatCa.filter(laChuong)) {
    if (TRANG_PHU.test(c.title.trim())) continue;
    const k = khoaTieuDe(c.title);
    const cu = theoTen.get(k);
    const hon =
      !cu ||
      c.authors.length > cu.authors.length ||
      (c.authors.length === cu.authors.length && !!c.pages && !cu.pages);
    if (hon) theoTen.set(k, c);
  }
  const chuongDs = [...theoTen.values()].sort(
    (a, b) =>
      // Chương có tác giả lên trước; tiêu đề phần (không tác giả) xuống cuối.
      Number(!a.authors.length) - Number(!b.authors.length) ||
      soThuTu(a.doi) - soThuTu(b.doi) ||
      a.title.localeCompare(b.title),
  );

  const nam = tatCa.map((m) => m.year).filter((y): y is number => y !== null);
  const namSomNhat = nam.length ? Math.min(...nam) : null;

  let sach: ResolvedWork | null = null;
  let ghep = false;
  if (banSach) {
    sach = {
      doi: banSach.doi,
      isbn: i13,
      type: 'book',
      title: banSach.title,
      publisher: banSach.publisher,
      url: banSach.url,
      publishedYear: banSach.year,
      publishedMonth: banSach.month,
      // Sách biên tập: Crossref ghi người biên tập ở `editor`, không có `author`.
      authors: banSach.authors.length ? banSach.authors : banSach.editors,
      source: 'crossref',
    };
  } else if (chuongDs.length) {
    const c = chuongDs[0];
    ghep = true;
    sach = {
      isbn: i13,
      type: 'book',
      title: c.containerTitle ?? c.title,
      publisher: c.publisher,
      url: null,
      publishedYear: namSomNhat,
      publishedMonth: null,
      authors: c.editors,
      source: 'crossref',
    };
  }

  return {
    sach,
    ghep,
    namSomNhat,
    chuong: chuongDs.map((c) => ({
      doi: c.doi,
      title: c.title,
      pages: c.pages,
      year: c.year,
      tacGia: c.authors.map(tenTacGia).filter(Boolean),
      nguoiKhoa: [],
      cuaToi: false,
      authors: c.authors,
    })),
  };
}

/**
 * Đánh dấu chương có người trong Khoa đứng tên, đưa chương của người đang khai lên
 * đầu. Dò bằng đúng bộ khớp tên dùng cho bài báo (name-match).
 */
export function danhDauChuong(
  chuong: SachCrossref['chuong'],
  candidates: CandidateProfile[],
  userId: string,
): ChuongSach[] {
  const ten = new Map(candidates.map((c) => [c.userId, c.displayName]));
  const ds = chuong.map(({ authors, ...c }, i) => {
    const khop = matchAuthors(authors, candidates);
    return {
      i,
      c: {
        ...c,
        cuaToi: khop.some((k) => k.userId === userId),
        nguoiKhoa: [
          ...new Set(
            khop.filter((k) => k.chac).map((k) => ten.get(k.userId) ?? ''),
          ),
        ].filter(Boolean),
      },
    };
  });
  return ds
    .sort(
      (a, b) =>
        Number(b.c.cuaToi) - Number(a.c.cuaToi) ||
        Number(b.c.nguoiKhoa.length > 0) - Number(a.c.nguoiKhoa.length > 0) ||
        a.i - b.i,
    )
    .map((x) => x.c);
}
