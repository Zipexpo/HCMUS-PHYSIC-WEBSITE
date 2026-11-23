import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveService } from './resolve.service';
import {
  danhDauChuong,
  docMuc,
  doiSachTuChuong,
  gomSach,
  isbn13,
  type MucCrossref,
} from './sach-crossref';

/**
 * Tra ISBN qua Crossref + chọn chương (23/11/2026). Ca thật: một chương trong
 * "Handbook of Applications of Chaos Theory" (CRC) — tra ISBN không ra vì hệ thống
 * chỉ hỏi OpenLibrary + Google Books. Dữ liệu dưới đây dựng theo hình dạng bản ghi
 * Crossref của cuốn đó (tên người là tên giả).
 */

const BIA_CUNG = '9781466590434';
const DIEN_TU_1 = '9781466590441';
const DIEN_TU_2 = '9781315374109';

const ngay = (y: number, m?: number) => ({ 'date-parts': [m ? [y, m] : [y]] });
const nguoi = (given: string, family: string, sequence = 'additional') => ({
  given,
  family,
  sequence,
});

/** Một mục `message.items` kiểu Crossref. */
function muc(o: {
  doi: string;
  type?: string;
  title: string;
  isbn: string[];
  nam: number;
  thang?: number;
  author?: unknown[];
  page?: string;
}) {
  return {
    DOI: o.doi,
    type: o.type ?? 'book-chapter',
    title: [o.title],
    'container-title': ['Handbook of Applications of Chaos Theory'],
    ISBN: o.isbn,
    publisher: 'Chapman and Hall/CRC',
    page: o.page,
    issued: ngay(o.nam, o.thang),
    'published-print': ngay(o.nam, o.thang),
    author: o.author,
  };
}

// Bộ chương in 2016 (ISBN bìa cứng) — chỉ vài chương, có trang phụ "Index".
const IN_2016 = [
  muc({
    doi: '10.1201/b20232-41',
    title: 'Chaos Methods in Pathology',
    isbn: [BIA_CUNG, DIEN_TU_1],
    nam: 2016,
    thang: 6,
    author: [nguoi('W.', 'Klon', 'first')],
  }),
  muc({
    doi: '10.1201/b20232-42',
    title: 'Chaos in Mechanical Sciences',
    isbn: [BIA_CUNG, DIEN_TU_1],
    nam: 2016,
    thang: 6,
  }),
  muc({
    doi: '10.1201/b20232-54',
    title: 'Index',
    isbn: [BIA_CUNG, DIEN_TU_1],
    nam: 2016,
    thang: 6,
  }),
];
// Bộ chương điện tử 2017 (ISBN điện tử khác) — có chương của người Khoa.
const DIEN_TU_2017 = [
  muc({
    doi: '10.1201/b20232-5',
    title: 'Nonlinear Dynamics of Two-Dimensional Chaotic Maps',
    isbn: [DIEN_TU_2],
    nam: 2017,
    thang: 12,
    page: '83-91',
    author: [
      nguoi('Van A.', 'Tran', 'first'),
      nguoi('Thu Van', 'An'),
      nguoi('Shun', 'Kawa'),
    ],
  }),
  muc({
    doi: '10.1201/b20232-2',
    title: 'Deterministic Chaos and Evolutionary Dynamics',
    isbn: [DIEN_TU_2],
    nam: 2017,
    thang: 12,
    page: '11-20',
    author: [nguoi('Ivan', 'Zel', 'first')],
  }),
  muc({
    doi: '10.1201/b20232-32',
    title: 'Chaos Methods in Pathology',
    isbn: [DIEN_TU_2],
    nam: 2017,
    thang: 12,
    author: [nguoi('W.', 'Klon', 'first')],
  }),
];
const SACH = {
  DOI: '10.1201/b20232',
  type: 'edited-book',
  title: ['Handbook of Applications of Chaos Theory'],
  ISBN: [DIEN_TU_2],
  publisher: 'Chapman and Hall/CRC',
  issued: ngay(2017, 12),
  editor: [nguoi('Christos', 'Skia', 'first'), nguoi('Charilaos', 'Skia')],
};

const docHet = (ds: unknown[]) =>
  ds.map(docMuc).filter((m): m is MucCrossref => !!m);

describe('isbn13 / doiSachTuChuong', () => {
  it('ISBN-10 đổi sang 13 số, 13 số giữ nguyên', () => {
    expect(isbn13('0-306-40615-2')).toBe('9780306406157');
    expect(isbn13('080442957X')).toBe('9780804429573');
    expect(isbn13(BIA_CUNG)).toBe(BIA_CUNG);
  });

  it('suy DOI cả cuốn từ DOI chương theo cách đặt của các NXB lớn', () => {
    expect(doiSachTuChuong('10.1201/b20232-5')).toBe('10.1201/b20232');
    expect(doiSachTuChuong('10.1201/9781003171553-12')).toBe(
      '10.1201/9781003171553',
    );
    expect(doiSachTuChuong('10.1007/978-3-030-12345-6_5')).toBe(
      '10.1007/978-3-030-12345-6',
    );
    expect(doiSachTuChuong('10.1142/9789811234567_0005')).toBe(
      '10.1142/9789811234567',
    );
    expect(doiSachTuChuong('10.1002/9781119123456.ch5')).toBe(
      '10.1002/9781119123456',
    );
    expect(doiSachTuChuong('10.1088/978-0-7503-1234-5ch5')).toBe(
      '10.1088/978-0-7503-1234-5',
    );
    expect(doiSachTuChuong('10.1201/b20232')).toBeNull();
    expect(doiSachTuChuong('không phải doi')).toBeNull();
  });
});

describe('docMuc', () => {
  it('lấy năm SỚM nhất giữa bản in / online / issued, gộp ISBN về 13 số', () => {
    const m = docMuc({
      DOI: '10.1007/X_1',
      type: 'book-chapter',
      title: ['Tên'],
      subtitle: ['Phụ đề'],
      ISBN: ['3-540-12345-X'],
      'isbn-type': [{ value: '9783540123456', type: 'electronic' }],
      issued: ngay(2021),
      'published-online': ngay(2020, 11),
      'published-print': ngay(2021, 2),
    });
    expect(m).toMatchObject({
      doi: '10.1007/x_1',
      title: 'Tên: Phụ đề',
      year: 2020,
      month: 11,
    });
    expect(m?.isbns).toEqual([isbn13('354012345X'), '9783540123456']);
    expect(docMuc({ DOI: '10.1/x' })).toBeNull();
  });
});

describe('gomSach', () => {
  it('cuốn sách lấy từ bản ghi cả cuốn (người biên tập), ISBN = ISBN người khai', () => {
    const kq = gomSach(BIA_CUNG, docHet([...IN_2016, ...DIEN_TU_2017, SACH]));
    expect(kq.ghep).toBe(false);
    expect(kq.sach).toMatchObject({
      doi: '10.1201/b20232',
      isbn: BIA_CUNG,
      type: 'book',
      title: 'Handbook of Applications of Chaos Theory',
      publishedYear: 2017,
      source: 'crossref',
    });
    expect(kq.sach?.authors.map((a) => a.family)).toEqual(['Skia', 'Skia']);
    // Bản ghi sớm nhất của cuốn là bộ chương in 6/2016.
    expect(kq.namSomNhat).toBe(2016);
  });

  it('bỏ trang phụ, gộp chương đăng ký hai lần, xếp như mục lục, chương không tác giả xuống cuối', () => {
    const kq = gomSach(BIA_CUNG, docHet([...IN_2016, ...DIEN_TU_2017, SACH]));
    expect(kq.chuong.map((c) => c.doi)).toEqual([
      '10.1201/b20232-2',
      '10.1201/b20232-5',
      '10.1201/b20232-41', // "Chaos Methods in Pathology": hai bản cùng 1 tác giả → giữ bản gặp trước
      '10.1201/b20232-42', // tiêu đề phần, không tác giả
    ]);
    expect(kq.chuong[1]).toMatchObject({
      pages: '83-91',
      year: 2017,
      tacGia: ['Van A. Tran', 'Thu Van An', 'Shun Kawa'],
    });
  });

  it('Crossref không có bản ghi cả cuốn → GHÉP từ chương; không có gì → sach null', () => {
    const kq = gomSach(BIA_CUNG, docHet(IN_2016));
    expect(kq.ghep).toBe(true);
    expect(kq.sach).toMatchObject({
      title: 'Handbook of Applications of Chaos Theory',
      isbn: BIA_CUNG,
      publishedYear: 2016,
    });
    expect(kq.sach?.doi).toBeUndefined(); // DOI cả cuốn chưa xác minh → không đoán
    expect(gomSach(BIA_CUNG, [])).toEqual({
      sach: null,
      ghep: false,
      namSomNhat: null,
      chuong: [],
    });
  });
});

describe('danhDauChuong', () => {
  const ungVien = [
    {
      userId: 'u-toi',
      orcid: null,
      normalizedVariants: ['thu van an', 'an thu van'],
      displayName: 'An Văn Thử',
    },
    {
      userId: 'u-khac',
      orcid: null,
      normalizedVariants: ['ivan zel'],
      displayName: 'Zel Ivan',
    },
  ];
  it('chương của người đang khai lên đầu, rồi chương có người Khoa', () => {
    const { chuong } = gomSach(
      BIA_CUNG,
      docHet([...IN_2016, ...DIEN_TU_2017, SACH]),
    );
    const ds = danhDauChuong(chuong, ungVien, 'u-toi');
    expect(ds[0]).toMatchObject({
      doi: '10.1201/b20232-5',
      cuaToi: true,
      nguoiKhoa: ['An Văn Thử'],
    });
    expect(ds[1]).toMatchObject({
      doi: '10.1201/b20232-2',
      cuaToi: false,
      nguoiKhoa: ['Zel Ivan'],
    });
    expect(ds.slice(2).every((c) => !c.cuaToi && !c.nguoiKhoa.length)).toBe(
      true,
    );
    expect(ds[0]).not.toHaveProperty('authors');
  });
});

describe('ResolveService.sachCrossrefTheoIsbn — hỏi cả ISBN anh em + DOI cả cuốn', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** `tra` trả undefined = lỗi 500; trả số = mã HTTP đó. */
  function dung(tra: (url: string, lan: number) => unknown) {
    const goi: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        goi.push(url);
        const body = tra(url, goi.filter((u) => u === url).length);
        if (body === undefined || typeof body === 'number') {
          return { ok: false, status: body ?? 500, text: async () => '' };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(body),
        };
      }),
    );
    const luu = new Map<string, unknown>();
    const cache = {
      get: vi.fn(async (k: string) => luu.get(k)),
      set: vi.fn(async (k: string, v: unknown) => void luu.set(k, v)),
    };
    const svc = new ResolveService(cache as never);
    svc.khoangCrossrefMs = 0;
    return { svc, goi, luu };
  }
  const traCrossref = (url: string) => {
    const u = decodeURIComponent(url);
    const items = (ds: unknown[]) => ({ message: { items: ds } });
    if (u.includes(`isbn:${BIA_CUNG}`) || u.includes(`isbn:${DIEN_TU_1}`))
      return items(IN_2016);
    if (u.includes(`isbn:${DIEN_TU_2}`)) return items([...DIEN_TU_2017, SACH]);
    if (u.includes('/works/10.1201/b20232')) return { message: SACH };
    if (u.includes('openlibrary')) return {};
    return undefined;
  };

  it('nhập ISBN bìa cứng vẫn thấy chương đăng ký dưới ISBN điện tử', async () => {
    const { svc, goi } = dung(traCrossref);
    const kq = await svc.sachCrossrefTheoIsbn('978-1-4665-9043-4');
    expect(kq?.chuong.map((c) => c.doi)).toContain('10.1201/b20232-5');
    expect(kq?.sach?.doi).toBe('10.1201/b20232');
    const cr = goi.map(decodeURIComponent);
    expect(cr.filter((u) => u.includes('filter=isbn:'))).toHaveLength(3); // bìa cứng + 2 anh em
    expect(cr.filter((u) => u.includes('/works/10.1201/b20232'))).toHaveLength(
      1,
    );
  });

  it('byIsbn ưu tiên bản ghi cả cuốn của Crossref; resolve() tra ISBN như trước', async () => {
    const { svc, goi } = dung(traCrossref);
    const w = await svc.resolve('ISBN 978-1-4665-9043-4');
    expect(w).toMatchObject({
      doi: '10.1201/b20232',
      isbn: BIA_CUNG,
      source: 'crossref',
    });
    expect(goi.some((u) => u.includes('openlibrary'))).toBe(false);
    expect(svc.isbnTrongChuoi('10.1201/b20232-5')).toBeNull();
    expect(svc.isbnTrongChuoi('978-1-4665-9043-4')).toBe(BIA_CUNG);
  });

  it('Crossref không biết ISBN → hỏi OpenLibrary như cũ; lỗi mạng → null và KHÔNG cache', async () => {
    const { svc, goi } = dung((url) =>
      url.includes('crossref')
        ? { message: { items: [] } }
        : url.includes('openlibrary')
          ? {}
          : undefined,
    );
    expect(await svc.byIsbn('9780367737047')).toBeNull();
    expect(goi.some((u) => u.includes('openlibrary'))).toBe(true);

    const hong = dung(() => undefined);
    expect(await hong.svc.sachCrossrefTheoIsbn('9780367737047')).toBeNull();
    expect(
      [...hong.luu.keys()].some((k) => k.startsWith('scholar:isbn-crossref')),
    ).toBe(false);
  });

  it('Crossref trả 429 (quá nhịp 1 lượt/giây) → chờ rồi hỏi lại', async () => {
    const laDienTu2 = (u: string) =>
      decodeURIComponent(u).includes(`isbn:${DIEN_TU_2}`);
    const { svc, goi } = dung((url, lan) =>
      lan === 1 && laDienTu2(url) ? 429 : traCrossref(url),
    );
    const kq = await svc.sachCrossrefTheoIsbn(DIEN_TU_2);
    expect(kq?.chuong.map((c) => c.doi)).toContain('10.1201/b20232-5');
    expect(goi.filter(laDienTu2)).toHaveLength(2);
  });

  it('các lượt hỏi danh sách Crossref đi lần lượt, không chồng nhau', async () => {
    let dangChay = 0;
    let toiDa = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        toiDa = Math.max(toiDa, ++dangChay);
        await new Promise((r) => setTimeout(r, 5));
        dangChay--;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ message: { items: [] } }),
        };
      }),
    );
    const svc = new ResolveService({
      get: async () => undefined,
      set: async () => undefined,
    } as never);
    svc.khoangCrossrefMs = 0;
    await Promise.all(
      ['9781466590434', '9781315374109', '9780367737047'].map((x) =>
        svc.sachCrossrefTheoIsbn(x),
      ),
    );
    expect(toiDa).toBe(1);
  });
});
