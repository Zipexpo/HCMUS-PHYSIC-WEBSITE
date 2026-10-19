/**
 * SOÁT NHẬN DIỆN TÁC GIẢ cho Khoa (5/10/2026) — hàm thuần, không đụng CSDL.
 *
 * Mỗi loại dưới đây là một lỗi ĐÃ GẶP khi soát tay dữ liệu thật (3–5/10/2026);
 * con số trong ngoặc là số ca đếm được trên toàn bộ dữ liệu lúc viết:
 *
 *   nham-hang       tài khoản trỏ vào hàng mang TÊN NGƯỜI KHÁC (8) — bấm "Đó là
 *                   tôi" nhầm hàng, hoặc form cũ xoá hàng làm hàng lệch theo
 *   trung-hang      hai tài khoản cùng nhận một hàng (1)
 *   chua-chi-hang   đã xác nhận nhưng chưa chỉ hàng nào (84) — đa số tự gán được
 *   lech-so-tac-gia số tác giả khác số hàng trong danh sách (5)
 *   moi-nham        lời mời đang chờ mà tên người được mời KHÔNG có trên bài (83)
 *                   — phần lớn do luật khớp tên cũ ghép "Thi Huong Nguyen" với Nguyễn
 *                   Thị Hiên. KHÔNG có thao tác huỷ cho Khoa: soát từng ca 5/10/2026
 *                   thấy có bài danh sách trên web Khoa THIẾU tác giả (11 so với 13 ở
 *                   OpenAlex) — người được mời có thể là tác giả thật. Chỉ người được
 *                   mời tự bấm «Không phải tôi», hoặc người mời tự rút lời mời.
 *   trung-ten       nhiều bản cùng tên (5 nhóm) — khai tay lại một bài đã có
 *   khai-tay-mot-tac-gia  khai tay chỉ một tác giả (15) — để Khoa nhìn lại
 *   ngoai-truong-dia-chi-truong  hàng không tài khoản bị đánh dấu NGOÀI Trường dù
 *                   địa chỉ trên bài là Trường (73) — phần lớn là mặc định của form
 *   bien-the-la     dạng tên đã lưu không hợp họ tên (4)
 */
import {
  danhGiaCap,
  hangCuaNguoi,
  hopVoiHoTen,
  joinAuthorName,
  looselyMatches,
  normalizeName,
  type CandidateProfile,
} from './name-match';
import { khoaTieuDe } from './resolve/work';

export type DongTacGiaSoat = {
  userId: string;
  authorIndex: number;
  claimStatus: 'CONFIRMED' | 'PENDING' | 'REJECTED';
  invitedBy: string | null;
};

export type HangSoat = {
  family?: string | null;
  given?: string | null;
  name?: string | null;
  orcid?: string | null;
  affiliation?: string | null;
  isNonSchool?: boolean | null;
};

export type BaiSoat = {
  id: string;
  title: string;
  doi: string | null;
  source: string;
  totalAuthors: number;
  publishedYear: number | null;
  publishedMonth: number | null;
  acceptedYear: number | null;
  acceptedMonth: number | null;
  createdBy: string | null;
  authorsRaw: HangSoat[];
  authors: DongTacGiaSoat[];
};

export type NguoiSoat = CandidateProfile & { bienThe: string[] };

export type LoaiSoat =
  | 'nham-hang'
  | 'trung-hang'
  | 'chua-chi-hang'
  | 'lech-so-tac-gia'
  | 'moi-nham'
  | 'trung-ten'
  | 'khai-tay-mot-tac-gia'
  | 'ngoai-truong-dia-chi-truong'
  | 'bien-the-la';

export type MucSoat = {
  loai: LoaiSoat;
  publicationId: string | null;
  title: string;
  nam: number | null;
  thang: number | null;
  moTa: string;
  userId: string | null;
  /** Chỉ thao tác KHÔNG lấy đi quyền lợi của ai (gán hàng); lời mời thì không huỷ hộ. */
  thaoTac: 'gan-hang' | null;
  lienQuan: Array<{ id: string; moTa: string }>;
};

/**
 * Địa chỉ trên bài là của TRƯỜNG ĐH KHTN (ĐHQG-HCM). Chặt: phải có tên trường VÀ
 * dấu hiệu TP.HCM; loại "VNU University of Science" Hà Nội và các trường "…of
 * Science and Technology".
 */
export function laDiaChiTruong(diaChi?: string | null): boolean {
  const s = normalizeName(diaChi ?? '');
  if (!s) return false;
  if (/\b(ha noi|hanoi)\b/.test(s)) return false;
  const coTruong =
    /\b(hcmus|dai hoc khoa hoc tu nhien|truong dai hoc khoa hoc tu nhien)\b/.test(s) ||
    /\buniversity of (natural )?science\b(?! and technology)/.test(s);
  const oHcm = /\b(ho chi minh|hcm|hcmc|vnu ?hcm|vnuhcm|hcmus|tp ?hcm)\b/.test(s);
  return coTruong && oHcm;
}

/** Bài khai tay (người dùng tự gõ danh sách) — khác bài tra từ nguồn. */
export const laKhaiTay = (source?: string | null) =>
  /^(manual|khai tay)$/i.test((source ?? '').trim());

const tenNguoi = (n: NguoiSoat | undefined) => n?.displayName || '(không rõ tên)';
const tenHang = (a: HangSoat | undefined) => (a ? joinAuthorName(a) : '');

/**
 * Soát toàn bộ. `trongKy(bai)` = bài thuộc khoảng đang xem; bài trùng tên được so
 * trên MỌI bài nhưng chỉ báo nhóm có ít nhất một bài trong khoảng.
 */
export function soatTacGia(
  bais: BaiSoat[],
  nguoi: Map<string, NguoiSoat>,
  trongKy: (b: BaiSoat) => boolean = () => true,
): MucSoat[] {
  const out: MucSoat[] = [];
  const muc = (
    b: BaiSoat,
    loai: LoaiSoat,
    moTa: string,
    them: Partial<MucSoat> = {},
  ): MucSoat => ({
    loai,
    publicationId: b.id,
    title: b.title,
    nam: b.publishedYear ?? b.acceptedYear,
    thang: b.publishedYear ? b.publishedMonth : b.acceptedMonth,
    moTa,
    userId: null,
    thaoTac: null,
    lienQuan: [],
    ...them,
  });

  for (const b of bais.filter(trongKy)) {
    const raw = Array.isArray(b.authorsRaw) ? b.authorsRaw : [];
    const song = b.authors.filter((a) => a.claimStatus !== 'REJECTED');
    const giuHang = new Map<number, string[]>();
    for (const a of song.filter((x) => x.authorIndex >= 0)) {
      giuHang.set(a.authorIndex, [...(giuHang.get(a.authorIndex) ?? []), a.userId]);
    }

    for (const a of song) {
      const n = nguoi.get(a.userId);
      if (!n) continue;
      if (a.authorIndex >= 0 && raw.length) {
        const h = raw[a.authorIndex];
        if (!h) {
          out.push(
            muc(b, 'nham-hang', `${tenNguoi(n)} trỏ vào hàng ${a.authorIndex + 1} nhưng danh sách chỉ có ${raw.length} tác giả.`, { userId: a.userId }),
          );
        } else if (!danhGiaCap(h, n)) {
          const dung = hangCuaNguoi(raw, n);
          const goiY =
            dung && dung.authorIndex !== a.authorIndex
              ? ` Tên giống ${tenNguoi(n)} nằm ở hàng ${dung.authorIndex + 1} («${tenHang(raw[dung.authorIndex])}»${raw[dung.authorIndex]?.isNonSchool ? ', đang đánh dấu ngoài Trường' : ''}).`
              : '';
          out.push(
            muc(
              b,
              'nham-hang',
              `${tenNguoi(n)}${a.claimStatus === 'PENDING' ? ' (chưa xác nhận)' : ''} đang nhận hàng ${a.authorIndex + 1} mang tên «${tenHang(h)}».${goiY}`,
              { userId: a.userId },
            ),
          );
        }
      }
      if (a.claimStatus === 'CONFIRMED' && a.authorIndex < 0 && raw.length) {
        const h = hangCuaNguoi(raw, n);
        const biGiu = h ? giuHang.has(h.authorIndex) : false;
        const ngoai = h ? raw[h.authorIndex]?.isNonSchool === true : false;
        const tuGan = Boolean(h?.chac && !biGiu && !ngoai);
        out.push(
          muc(
            b,
            'chua-chi-hang',
            `${tenNguoi(n)} đã xác nhận nhưng chưa chỉ hàng nào.` +
              (h
                ? ` Tên giống nhất: hàng ${h.authorIndex + 1} («${tenHang(raw[h.authorIndex])}»)` +
                  (biGiu ? ' — hàng này đã có người nhận.' : ngoai ? ' — hàng này đang đánh dấu ngoài Trường, cần người xem.' : h.chac ? '.' : ' — chưa chắc, cần người xem.')
                : ' Không thấy tên giống trên bài.'),
            { userId: a.userId, thaoTac: tuGan ? 'gan-hang' : null },
          ),
        );
      }
      if (a.claimStatus === 'PENDING' && raw.length && !raw.some((h) => danhGiaCap(h, n))) {
        const na = raw.map(tenHang).filter((t) => looselyMatches(t, n.displayName));
        const nguoiMoi = a.invitedBy ? nguoi.get(a.invitedBy) : undefined;
        const coTheThieu = b.totalAuthors > raw.length;
        out.push(
          muc(
            b,
            'moi-nham',
            `Lời mời ${tenNguoi(n)}${nguoiMoi ? ` (do ${tenNguoi(nguoiMoi)} mời)` : ''} đang chờ nhưng không hàng nào mang tên người này` +
              (na.length ? ` — tên na ná trên bài: ${na.slice(0, 2).join(', ')}.` : '.') +
              (coTheThieu ? ` Danh sách đang thiếu ${b.totalAuthors - raw.length} tác giả so với số ghi — có thể chính là người này.` : '') +
              ' Không huỷ hộ: người được mời tự bấm «Không phải tôi», hoặc người mời rút lời mời ở bài.',
            { userId: a.userId },
          ),
        );
      }
    }

    for (const [hang, ds] of giuHang) {
      if (ds.length < 2) continue;
      out.push(
        muc(b, 'trung-hang', `${ds.map((u) => tenNguoi(nguoi.get(u))).join(' và ')} cùng nhận hàng ${hang + 1}${raw[hang] ? ` («${tenHang(raw[hang])}»)` : ''}.`),
      );
    }

    if (raw.length && b.totalAuthors !== raw.length) {
      out.push(
        muc(
          b,
          'lech-so-tac-gia',
          `Số tác giả ghi ${b.totalAuthors} nhưng danh sách có ${raw.length} hàng` +
            (b.totalAuthors < raw.length ? ' — mỗi người đang được chia phần lớn hơn thật.' : '.'),
        ),
      );
    }

    if (laKhaiTay(b.source) && b.totalAuthors === 1) {
      out.push(
        muc(b, 'khai-tay-mot-tac-gia', `Khai tay MỘT tác giả${b.createdBy && nguoi.get(b.createdBy) ? ` (${tenNguoi(nguoi.get(b.createdBy))})` : ''} — hưởng trọn định mức; kiểm tra bài có thật chỉ một tác giả.`, { userId: b.createdBy }),
      );
    }

    raw.forEach((h, i) => {
      if (giuHang.has(i) || h?.isNonSchool !== true || !laDiaChiTruong(h.affiliation)) return;
      out.push(
        muc(b, 'ngoai-truong-dia-chi-truong', `Hàng ${i + 1} «${tenHang(h)}» đánh dấu NGOÀI Trường nhưng địa chỉ trên bài là «${String(h.affiliation).slice(0, 120)}».`),
      );
    });
  }

  // Trùng tên: so trên MỌI bài, báo nhóm có ít nhất một bài trong khoảng.
  const theoTen = new Map<string, BaiSoat[]>();
  for (const b of bais) {
    const k = khoaTieuDe(b.title);
    if (k.length < 15) continue;
    theoTen.set(k, [...(theoTen.get(k) ?? []), b]);
  }
  for (const ds of theoTen.values()) {
    if (ds.length < 2 || !ds.some(trongKy)) continue;
    const [dau, ...con] = ds;
    const mo = (b: BaiSoat) =>
      `${b.publishedYear ?? b.acceptedYear ?? '?'} · ${b.doi ? `DOI ${b.doi}` : laKhaiTay(b.source) ? 'khai tay' : b.source} · ${b.totalAuthors} tác giả`;
    out.push(
      muc(dau, 'trung-ten', `${ds.length} bản cùng tên: ${ds.map(mo).join(' | ')}. Cùng một bài thì gộp lại (mỗi bài tính một lần); bản hội nghị + bản tạp chí là hai công trình thì để nguyên.`, {
        lienQuan: con.map((b) => ({ id: b.id, moTa: mo(b) })),
      }),
    );
  }

  // Dạng tên đã lưu không hợp họ tên (bấm nhầm hàng rồi lưu luôn tên người khác).
  for (const n of nguoi.values()) {
    for (const v of n.bienThe) {
      if (hopVoiHoTen(v, n.displayName)) continue;
      out.push({
        loai: 'bien-the-la',
        publicationId: null,
        title: n.displayName,
        nam: null,
        thang: null,
        moTa: `${n.displayName} có dạng tên đã lưu «${v}» không giống họ tên — nếu là tên người khác (bấm nhầm hàng) thì xoá ở Lý lịch khoa học.`,
        userId: n.userId,
        thaoTac: null,
        lienQuan: [],
      });
    }
  }
  return out;
}
