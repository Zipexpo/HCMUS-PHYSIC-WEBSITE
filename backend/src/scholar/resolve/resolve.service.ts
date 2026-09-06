import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  normalizeArxiv,
  normalizeDoi,
  normalizeIsbn,
  normalizeIssn,
  parseMonth,
  parseYear,
  asArr,
  asObj,
  asStr,
  dateParts,
  dig,
  firstStr,
  type Json,
  type ResolvedAuthor,
  type ResolvedWork,
} from './work';

/**
 * Tra dữ liệu thư mục từ một chuỗi người dùng dán vào: DOI, link DOI, arXiv ID,
 * ISBN, hay URL bài báo.
 *
 * Chạy ở SERVER chứ không ở trình duyệt vì ba lý do:
 *   · gọi Crossref từ server mới gửi kèm được một mailto thống nhất để vào hàng
 *     đợi ưu tiên (điều khoản "polite pool" của họ);
 *   · kết quả cache thẳng vào Redis sẵn có, cùng một DOI chỉ gọi ra ngoài 1 lần;
 *   · trình duyệt gọi thẳng sẽ vướng CORS và giới hạn tần suất theo IP người dùng.
 *
 * Mọi nguồn ở đây đều MIỄN PHÍ và không cần khoá. Scopus cần khoá trả phí của
 * Elsevier nên không có ở đây; ResearchGate không có API công khai và điều khoản
 * cấm cào, nên chỉ được lưu như một đường dẫn để hiển thị.
 *
 * Không nguồn nào cho biết bài thuộc Q mấy — phân loại là việc của tác giả.
 */

@Injectable()
export class ResolveService {
  private readonly logger = new Logger(ResolveService.name);
  /** Crossref khuyến nghị gắn email liên hệ để được ưu tiên. */
  private readonly mailto = process.env.CROSSREF_MAILTO || '';
  private readonly timeoutMs = 12_000;
  /** Metadata thư mục gần như không đổi → cache dài. */
  private readonly ttlMs = 7 * 24 * 60 * 60 * 1000;

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /** Đoán loại định danh rồi tra. Trả null nếu không nhận ra hoặc không tìm thấy. */
  async resolve(input: string): Promise<ResolvedWork | null> {
    const raw = String(input ?? '').trim();
    if (!raw) return null;

    const doi = normalizeDoi(raw) ?? this.doiInsideUrl(raw);
    if (doi) return this.byDoi(doi);

    const arxiv = normalizeArxiv(raw);
    if (arxiv) return this.byArxiv(arxiv);

    // Link Nhà sách HCMUS: sách NXB trong nước không tra được bằng ISBN, nhưng
    // trang sản phẩm có đủ tên/tác giả/NXB/năm/số trang để bóc ra.
    const storeUrl = this.hcmusBookstoreUrl(raw);
    if (storeUrl) return this.byHcmusBookstore(storeUrl);

    const isbn = normalizeIsbn(raw);
    if (isbn && /^\d{9}[\dxX]$|^\d{13}$/.test(raw.replace(/[^0-9xX]/g, ''))) {
      return this.byIsbn(isbn);
    }
    return null;
  }

  /** Nhiều trang xuất bản nhét DOI vào giữa URL. */
  private doiInsideUrl(raw: string): string | null {
    const m = raw.match(/10\.\d{4,9}\/[^\s"'<>&]+/);
    return m ? normalizeDoi(m[0].replace(/[.,;)\]]+$/, '')) : null;
  }

  // ── DOI ───────────────────────────────────────────────────────────────────
  /**
   * Crossref là nguồn chính (có thứ tự tác giả và ORCID từng người). OpenAlex
   * bù ISSN chuẩn hoá và affiliation — hai chỗ Crossref hay thiếu.
   * Crossref không có thì thử DataCite (Zenodo, Figshare, bộ dữ liệu).
   */
  async byDoi(doi: string): Promise<ResolvedWork | null> {
    return this.cached(`scholar:doi:${doi}`, async () => {
      const [crossref, openalex] = await Promise.all([
        this.fetchCrossref(doi),
        this.fetchOpenAlex(doi),
      ]);
      const base = crossref ?? (await this.fetchDataCite(doi));
      if (!base) return openalex;
      if (!openalex) return base;
      return {
        ...base,
        issn: base.issn ?? openalex.issn,
        publisher: base.publisher ?? openalex.publisher,
        url: base.url ?? openalex.url,
        authors: this.mergeAffiliations(base.authors, openalex.authors),
      };
    });
  }

  /**
   * Giữ nguyên thứ tự tác giả của Crossref (đó mới là thứ tự in trên bài), chỉ
   * mượn OpenAlex phần affiliation và ORCID còn thiếu. Ghép theo vị trí vì hai
   * nguồn cùng lấy từ bản ghi của nhà xuất bản; lệch số lượng thì bỏ qua, thà
   * thiếu affiliation còn hơn gán nhầm cơ quan cho người khác.
   */
  private mergeAffiliations(
    base: ResolvedAuthor[],
    extra: ResolvedAuthor[],
  ): ResolvedAuthor[] {
    if (base.length !== extra.length) return base;
    return base.map((a, i) => ({
      ...a,
      orcid: a.orcid ?? extra[i]?.orcid ?? null,
      affiliation: a.affiliation ?? extra[i]?.affiliation ?? null,
    }));
  }

  private async fetchCrossref(doi: string): Promise<ResolvedWork | null> {
    const qs = this.mailto ? `?mailto=${encodeURIComponent(this.mailto)}` : '';
    const json = await this.getJson(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}${qs}`,
    );
    const m = asObj(dig(json, 'message'));
    const title = firstStr(m.title);
    if (!title) return null;

    const issued = dateParts(m.issued);
    // published-online có tháng chính xác hơn "issued" ở nhiều nhà xuất bản.
    const online = dateParts(m['published-online']);
    const accepted = this.crossrefAccepted(m);

    return {
      doi,
      issn: normalizeIssn(firstStr(m.ISSN)),
      isbn: normalizeIsbn(firstStr(m.ISBN)),
      type: asStr(m.type) ?? 'journal-article',
      title,
      containerTitle: firstStr(m['container-title']),
      volume: asStr(m.volume),
      issue: asStr(m.issue),
      pages: asStr(m.page),
      publisher: asStr(m.publisher),
      url: asStr(m.URL) ?? `https://doi.org/${doi}`,
      publishedYear: parseYear(asStr(online[0] ?? issued[0])),
      publishedMonth: parseMonth(asStr(online[1] ?? issued[1])),
      acceptedYear: accepted?.year ?? null,
      acceptedMonth: accepted?.month ?? null,
      authors: asArr(m.author).map((raw): ResolvedAuthor => {
        const a = asObj(raw);
        return {
          family: asStr(a.family),
          given: asStr(a.given),
          name: asStr(a.name),
          orcid: asStr(a.ORCID),
          sequence: asStr(a.sequence) === 'first' ? 'first' : 'additional',
          affiliation: asStr(dig(asArr(a.affiliation)[0], 'name')),
        };
      }),
      source: 'crossref',
      raw: m,
    };
  }

  /** Một số nhà xuất bản khai ngày chấp nhận đăng trong mảng `assertion`. */
  private crossrefAccepted(
    m: Json,
  ): { year: number; month: number | null } | null {
    const parts = dateParts(m.accepted);
    const partYear = parseYear(asStr(parts[0]));
    if (partYear) return { year: partYear, month: parseMonth(asStr(parts[1])) };

    const found = asArr(m.assertion)
      .map(asObj)
      .find((a) =>
        /accept/i.test(`${asStr(a.name) ?? ''}${asStr(a.label) ?? ''}`),
      );
    const value = asStr(found?.value);
    const year = parseYear(value);
    if (!year) return null;
    const month = value?.match(/^\s*\d{4}-(\d{1,2})/);
    return { year, month: month ? parseMonth(month[1]) : null };
  }

  private async fetchOpenAlex(doi: string): Promise<ResolvedWork | null> {
    const json = await this.getJson(
      `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`,
    );
    const w = asObj(json);
    const title = asStr(w.display_name) ?? asStr(w.title);
    if (!title) return null;

    const venue = asObj(dig(w, 'primary_location', 'source'));
    const biblio = asObj(w.biblio);
    const firstPage = asStr(biblio.first_page);
    const lastPage = asStr(biblio.last_page);

    return {
      doi,
      issn: normalizeIssn(asStr(venue.issn_l) ?? firstStr(venue.issn)),
      type: asStr(w.type) ?? 'journal-article',
      title,
      containerTitle: asStr(venue.display_name),
      volume: asStr(biblio.volume),
      issue: asStr(biblio.issue),
      pages: firstPage && lastPage ? `${firstPage}–${lastPage}` : firstPage,
      publisher: asStr(venue.host_organization_name),
      url: asStr(dig(w, 'primary_location', 'landing_page_url')),
      publishedYear: parseYear(asStr(w.publication_year)),
      publishedMonth: parseMonth(
        (asStr(w.publication_date) ?? '').split('-')[1],
      ),
      authors: asArr(w.authorships).map((raw): ResolvedAuthor => {
        const a = asObj(raw);
        return {
          name: asStr(dig(a, 'author', 'display_name')),
          orcid: asStr(dig(a, 'author', 'orcid')),
          sequence:
            asStr(a.author_position) === 'first' ? 'first' : 'additional',
          affiliation: asStr(dig(asArr(a.institutions)[0], 'display_name')),
        };
      }),
      source: 'openalex',
      raw: w,
    };
  }

  private async fetchDataCite(doi: string): Promise<ResolvedWork | null> {
    const json = await this.getJson(
      `https://api.datacite.org/dois/${encodeURIComponent(doi)}`,
    );
    const a = asObj(dig(json, 'data', 'attributes'));
    const title = asStr(dig(asArr(a.titles)[0], 'title'));
    if (!title) return null;

    return {
      doi,
      type: (
        asStr(dig(a, 'types', 'resourceTypeGeneral')) ?? 'other'
      ).toLowerCase(),
      title,
      containerTitle: asStr(dig(a, 'container', 'title')),
      publisher: asStr(a.publisher),
      url: asStr(a.url) ?? `https://doi.org/${doi}`,
      publishedYear: parseYear(asStr(a.publicationYear)),
      authors: asArr(a.creators).map((raw, i): ResolvedAuthor => {
        const c = asObj(raw);
        const orcidEntry = asArr(c.nameIdentifiers)
          .map(asObj)
          .find((n) => /orcid/i.test(asStr(n.nameIdentifierScheme) ?? ''));
        return {
          family: asStr(c.familyName),
          given: asStr(c.givenName),
          name: asStr(c.name),
          orcid: asStr(orcidEntry?.nameIdentifier),
          sequence: i === 0 ? 'first' : 'additional',
        };
      }),
      source: 'datacite',
      raw: a,
    };
  }

  // ── arXiv ─────────────────────────────────────────────────────────────────
  /** API arXiv trả Atom XML, không có JSON — bóc bằng regex vì cấu trúc rất cạn. */
  async byArxiv(id: string): Promise<ResolvedWork | null> {
    return this.cached(`scholar:arxiv:${id}`, async () => {
      const xml = await this.getText(
        `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
      );
      if (!xml) return null;
      const entry = xml.split('<entry>')[1];
      if (!entry) return null;

      const pick = (tag: string) =>
        entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
      const title = pick('title')?.replace(/\s+/g, ' ');
      if (!title) return null;

      const published = pick('published') ?? '';
      const names = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) =>
        m[1].trim(),
      );
      // Bài arXiv đã lên tạp chí thì thẻ doi trỏ về bản chính thức.
      const doi = normalizeDoi(pick('arxiv:doi'));

      return {
        arxivId: id,
        doi,
        type: 'preprint',
        title,
        containerTitle: 'arXiv',
        url: `https://arxiv.org/abs/${id}`,
        publishedYear: parseYear(published.slice(0, 4)),
        publishedMonth: parseMonth(published.slice(5, 7)),
        authors: names.map((n, i) => ({
          name: n,
          sequence: i === 0 ? ('first' as const) : ('additional' as const),
        })),
        source: 'arxiv',
        raw: { id, published },
      } satisfies ResolvedWork;
    });
  }

  // ── ISBN ──────────────────────────────────────────────────────────────────
  /**
   * OpenLibrary trước (không cần khoá). Phần lớn sách NXB trong nước không có ở
   * đó, nên trượt thì hỏi tiếp Google Books — kho phủ sách tiếng Việt rộng hơn.
   */
  async byIsbn(isbn: string): Promise<ResolvedWork | null> {
    return this.cached(
      `scholar:isbn:${isbn}`,
      async () =>
        (await this.openLibraryByIsbn(isbn)) ??
        (await this.googleBooksByIsbn(isbn)),
    );
  }

  private async openLibraryByIsbn(isbn: string): Promise<ResolvedWork | null> {
    const json = await this.getJson(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
    );
    const b = asObj(dig(json, `ISBN:${isbn}`));
    const title = asStr(b.title);
    if (!title) return null;

    return {
      isbn,
      type: 'book',
      title,
      publisher: asStr(dig(asArr(b.publishers)[0], 'name')),
      url: asStr(b.url),
      publishedYear: parseYear(asStr(b.publish_date)),
      publishedMonth: null,
      authors: asArr(b.authors).map((raw, i) => ({
        name: asStr(asObj(raw).name),
        sequence: i === 0 ? ('first' as const) : ('additional' as const),
      })),
      source: 'openlibrary',
      raw: b,
    } satisfies ResolvedWork;
  }

  /**
   * Google Books — kho lớn, phủ nhiều sách tiếng Việt OpenLibrary thiếu. Không
   * có khoá thì Google giới hạn theo IP (hay 429); đặt GOOGLE_BOOKS_KEY thì ổn
   * định 1000 lượt/ngày (miễn phí). Thiếu khoá vẫn thử — chỉ kém chắc chứ không
   * chặn ai: hỏng thì getJson trả null, người dùng vẫn khai tay được.
   */
  private async googleBooksByIsbn(isbn: string): Promise<ResolvedWork | null> {
    const key = process.env.GOOGLE_BOOKS_KEY
      ? `&key=${process.env.GOOGLE_BOOKS_KEY}`
      : '';
    const json = await this.getJson(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=VN${key}`,
    );
    const v = asObj(dig(asArr(asObj(json).items)[0], 'volumeInfo'));
    const title = asStr(v.title);
    if (!title) return null;
    const subtitle = asStr(v.subtitle);

    return {
      isbn,
      type: 'book',
      title: subtitle ? `${title}: ${subtitle}` : title,
      publisher: asStr(v.publisher),
      url: asStr(v.canonicalVolumeLink) ?? asStr(v.infoLink),
      publishedYear: parseYear(asStr(v.publishedDate)),
      publishedMonth: parseMonth(asStr(v.publishedDate)),
      authors: asArr(v.authors).map((raw, i) => ({
        name: asStr(raw),
        sequence: i === 0 ? ('first' as const) : ('additional' as const),
      })),
      source: 'googlebooks',
      raw: v,
    } satisfies ResolvedWork;
  }

  // ── Nhà sách HCMUS ─────────────────────────────────────────────────────────
  /**
   * Nhận diện link sản phẩm Nhà sách HCMUS. CHỈ đúng host này — không mở cửa cho
   * SSRF sang host tuỳ ý. Trả URL đã chuẩn hoá (bỏ query/hash), hoặc null.
   */
  private hcmusBookstoreUrl(raw: string): string | null {
    let u: URL;
    try {
      u = new URL(raw.trim());
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.hostname.toLowerCase() !== 'bookstore.hcmus.edu.vn') return null;
    return `https://bookstore.hcmus.edu.vn${u.pathname}`;
  }

  /**
   * Bóc thông tin sách từ trang Nhà sách HCMUS (nền Google Sites). Trang KHÔNG in
   * ISBN, nên chỉ lấy tên/tác giả/NXB/năm/số trang — người khai tự điền ISBN. Cào
   * bằng regex trên văn bản đã lột thẻ: bố cục là "nhãn đậm + giá trị", giá trị
   * hay bị xé thành nhiều <span> nên phải lột thẻ trước rồi mới dò theo nhãn.
   */
  async byHcmusBookstore(url: string): Promise<ResolvedWork | null> {
    return this.cached(`scholar:hcmus-store:${url}`, async () => {
      const html = await this.getText(url);
      if (!html) return null;

      const title = this.decodeEntities(
        (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim(),
      );
      const text = this.stripHtml(html);
      const grab = (re: RegExp): string | null => {
        const m = text.match(re);
        return m ? m[1].replace(/\s+/g, ' ').trim() : null;
      };
      // Dừng ở nhãn kế tiếp / tiêu đề khối để không nuốt sang phần sau.
      const STOP =
        'Số trang|Năm xuất bản|Nhà xuất bản|Tác giả|Khổ|Giá|ISBN|Tóm tắt|Nội dung';
      const authorsRaw = grab(
        new RegExp(`Tác giả\\s*:?\\s*(.+?)\\s*(?:${STOP})`, 'i'),
      );
      const publisher = grab(
        new RegExp(`Nhà xuất bản\\s*:?\\s*(.+?)\\s*(?:${STOP})`, 'i'),
      );
      const pages = grab(/Số trang\s*:?\s*(\d{1,5})/i);
      const year = grab(/Năm xuất bản\s*:?\s*(\d{4})/i);

      if (!title && !authorsRaw) return null;

      const authors = (authorsRaw ?? '')
        .replace(/[.…]+\s*$/, '') // bỏ "…"/"..." cuối = "và những người khác"
        .split(/\s*[;,]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name, i) => ({
          name,
          sequence: i === 0 ? ('first' as const) : ('additional' as const),
        }));

      return {
        type: 'book',
        title: title || authors[0]?.name || 'Sách',
        publisher: publisher ?? null,
        url,
        pages: pages ?? null,
        publishedYear: year ? Number(year) : null,
        publishedMonth: null,
        authors,
        source: 'hcmus-bookstore',
        raw: { title, authorsRaw, publisher, pages, year },
      } satisfies ResolvedWork;
    });
  }

  private stripHtml(html: string): string {
    const noScript = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
    return this.decodeEntities(noScript.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  private decodeEntities(s: string): string {
    return s
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
        String.fromCharCode(parseInt(n, 16)),
      )
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
  }

  // ── ORCID ─────────────────────────────────────────────────────────────────
  /**
   * Kéo toàn bộ công bố của một ORCID. Bản tóm tắt của ORCID chỉ đủ tiêu đề +
   * năm + DOI, nên mục nào có DOI thì tra lại Crossref cho đầy đủ tác giả.
   * Giới hạn `limit` để một hồ sơ vài trăm bài không treo request.
   */
  async byOrcid(orcid: string, limit = 100): Promise<ResolvedWork[]> {
    const id = String(orcid).trim();
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dXx]$/.test(id)) return [];

    const json = await this.getJson(`https://pub.orcid.org/v3.0/${id}/works`, {
      Accept: 'application/json',
    });

    const summaries = asArr(asObj(json).group)
      .map((rawGroup) => {
        const g = asObj(rawGroup);
        const s = asObj(asArr(g['work-summary'])[0]);
        const title = asStr(dig(s, 'title', 'title', 'value'));
        if (!title) return null;

        const ids = asArr(dig(g, 'external-ids', 'external-id')).map(asObj);
        const doiEntry = ids.find((e) =>
          /doi/i.test(asStr(e['external-id-type']) ?? ''),
        );
        return {
          doi: normalizeDoi(asStr(doiEntry?.['external-id-value'])),
          title,
          year: parseYear(asStr(dig(s, 'publication-date', 'year', 'value'))),
          month: parseMonth(
            asStr(dig(s, 'publication-date', 'month', 'value')),
          ),
          type: (asStr(s.type) ?? 'other').toLowerCase().replace(/_/g, '-'),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, limit);

    // Tra Crossref/OpenAlex cho từng bài chạy SONG SONG (tối đa 6 cùng lúc).
    // Trước đây nối đuôi nhau (for await) nên hồ sơ nhiều bài kéo cả phút, vượt
    // timeout của request → "lần đầu lỗi, phải thử lại". byDoi vẫn cache 7 ngày,
    // nên lượt sau vẫn nhanh; lượt ĐẦU giờ cũng nhanh vì không còn chờ nối đuôi.
    return this.mapLimit(summaries, 6, async (s): Promise<ResolvedWork> => {
      if (s.doi) {
        const full = await this.byDoi(s.doi);
        if (full) return full;
      }
      return {
        doi: s.doi,
        type: s.type,
        title: s.title,
        publishedYear: s.year,
        publishedMonth: s.month,
        authors: [],
        source: 'orcid',
      };
    });
  }

  // ── Hạ tầng ───────────────────────────────────────────────────────────────
  private async cached<T>(key: string, run: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get<T>(key).catch(() => undefined);
    if (hit !== undefined && hit !== null) return hit;
    const value = await run();
    if (value)
      await this.cache.set(key, value, this.ttlMs).catch(() => undefined);
    return value;
  }

  /**
   * map có GIỚI HẠN ĐỒNG THỜI: chạy `fn` cho mọi phần tử, tối đa `limit` cái
   * cùng lúc, giữ NGUYÊN thứ tự kết quả. Dùng cho byOrcid để tra hàng loạt bài
   * vừa nhanh (không nối đuôi) vừa không bung hết một lúc (tránh rate-limit).
   */
  private async mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await fn(items[i]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, worker),
    );
    return out;
  }

  /** Gọi mạng hỏng thì trả null — người dùng vẫn nhập tay được, không chặn họ. */
  private async getText(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': `hcmus-physics-scholar/1.0${this.mailto ? ` (mailto:${this.mailto})` : ''}`,
          ...headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Tra cứu thất bại ${url}: ${msg}`);
      return null;
    }
  }

  private async getJson(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const text = await this.getText(url, {
      Accept: 'application/json',
      ...headers,
    });
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
}
