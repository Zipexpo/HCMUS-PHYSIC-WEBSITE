import { describe, expect, it } from 'vitest';
import { normalizeName } from './name-match';
import { lienHeDuyNhat, noiDiaChi } from './resolve/resolve.service';
import { khoaTieuDe, laBanThao } from './resolve/work';
import {
  laDiaChiTruong,
  soatTacGia,
  type BaiSoat,
  type NguoiSoat,
} from './soat-tac-gia';

/** Tên giả, cấu trúc lấy từ các ca thật soát 3–5/10/2026. */
const nguoi = (userId: string, displayName: string, bienThe: string[] = []): NguoiSoat => ({
  userId,
  orcid: null,
  displayName,
  bienThe,
  normalizedVariants: bienThe.map(normalizeName),
});
const NGUOI = new Map(
  [
    nguoi('u-an', 'Đặng Minh An'),
    nguoi('u-khang', 'Trần Văn Khang'),
    nguoi('u-hien', 'Lê Thị Hiên'),
    nguoi('u-hao', 'Lâm Văn Hảo'),
    nguoi('u-binh', 'Phạm Quốc Bình', ['Kieu T. Thi Huynh']),
  ].map((n) => [n.userId, n]),
);

const bai = (o: Partial<BaiSoat> = {}): BaiSoat => ({
  id: 'p1',
  title: 'Bài thử về thuỷ văn đồng bằng',
  doi: '10.1/x',
  source: 'crossref',
  totalAuthors: 4,
  publishedYear: 2026,
  publishedMonth: 3,
  acceptedYear: null,
  acceptedMonth: null,
  createdBy: 'u-an',
  authorsRaw: [
    { name: 'Thai Duong Phung', isNonSchool: true },
    { name: 'Kieu Tram Thi Huynh', isNonSchool: true },
    { name: 'Van Tuan Phan' },
    { name: 'Dang Minh An' },
  ],
  authors: [],
  ...o,
});
const xn = (userId: string, authorIndex: number) => ({
  userId,
  authorIndex,
  claimStatus: 'CONFIRMED' as const,
  invitedBy: null,
});

describe('soatTacGia — từng loại lỗi đã gặp', () => {
  it('NHẦM HÀNG: tài khoản trỏ vào tên người khác, chỉ luôn hàng đúng', () => {
    // Ca thật: form cũ xoá 1 hàng → hàng 4 thành 3, tài khoản trỏ vào tên khác, T 4→3.
    const kq = soatTacGia([bai({ totalAuthors: 3, authors: [xn('u-an', 2)] })], NGUOI);
    const nham = kq.find((x) => x.loai === 'nham-hang');
    expect(nham?.moTa).toContain('«Van Tuan Phan»');
    expect(nham?.moTa).toContain('hàng 4');
    expect(kq.find((x) => x.loai === 'lech-so-tac-gia')?.moTa).toContain('lớn hơn thật');
  });

  it('TRÙNG HÀNG: hai tài khoản cùng một hàng', () => {
    const kq = soatTacGia(
      [bai({ authorsRaw: [{ name: 'Hao Lam Van' }, { name: 'Khang Tran Van' }], totalAuthors: 2, authors: [xn('u-hao', 0), xn('u-khang', 0)] })],
      NGUOI,
    );
    expect(kq.filter((x) => x.loai === 'trung-hang')).toHaveLength(1);
    expect(kq.find((x) => x.loai === 'nham-hang')?.userId).toBe('u-khang');
  });

  it('CHƯA CHỈ HÀNG: tự gán được khi khớp chắc, hàng trống, không ngoài Trường', () => {
    const kq = soatTacGia([bai({ authors: [xn('u-an', -1)] })], NGUOI);
    const m = kq.find((x) => x.loai === 'chua-chi-hang');
    expect(m?.thaoTac).toBe('gan-hang');
    expect(m?.moTa).toContain('hàng 4');
    // Hàng khớp tên đang đánh dấu ngoài Trường → phải có người xem.
    const kq2 = soatTacGia(
      [bai({ authorsRaw: [{ name: 'X Y' }, { name: 'Dang Minh An', isNonSchool: true }], totalAuthors: 2, authors: [xn('u-an', -1)] })],
      NGUOI,
    );
    expect(kq2.find((x) => x.loai === 'chua-chi-hang')?.thaoTac).toBeNull();
  });

  it('LỜI MỜI NGHI NHẦM: liệt kê để người trong cuộc tự quyết — KHÔNG có thao tác huỷ', () => {
    const kq = soatTacGia(
      [
        bai({
          authorsRaw: [{ name: 'Thi Huong Le' }, { name: 'Dang Minh An' }],
          totalAuthors: 2,
          authors: [xn('u-an', 1), { userId: 'u-hien', authorIndex: -1, claimStatus: 'PENDING', invitedBy: 'u-an' }],
        }),
      ],
      NGUOI,
    );
    const m = kq.find((x) => x.loai === 'moi-nham');
    expect(m?.userId).toBe('u-hien');
    expect(m?.thaoTac).toBeNull();
    expect(m?.moTa).toContain('do Đặng Minh An mời');
    expect(m?.moTa).toContain('Không huỷ hộ');
  });

  it('CA THẬT: danh sách ngắn hơn số tác giả ghi → nói rõ người được mời có thể là tên bị thiếu', () => {
    const kq = soatTacGia(
      [
        bai({
          authorsRaw: [{ name: 'Dang Minh An' }, { name: 'Phan Long Ho' }],
          totalAuthors: 4,
          authors: [xn('u-an', 0), { userId: 'u-hien', authorIndex: -1, claimStatus: 'PENDING', invitedBy: 'u-an' }],
        }),
      ],
      NGUOI,
    );
    expect(kq.find((x) => x.loai === 'moi-nham')?.moTa).toContain('thiếu 2 tác giả');
  });

  it('TRÙNG TÊN: báo nhóm có bài trong khoảng, kèm bài liên quan', () => {
    const a = bai({ id: 'a', title: 'Monsoonal sediment transport: an analysis', doi: null, source: 'Khai tay', totalAuthors: 1 });
    const b2 = bai({ id: 'b', title: 'Monsoonal Sediment Transport — An Analysis', doi: null, source: 'Khai tay', totalAuthors: 3, publishedYear: 2022 });
    const kq = soatTacGia([a, b2], NGUOI, (x) => x.id === 'a');
    const m = kq.find((x) => x.loai === 'trung-ten');
    expect(m?.publicationId).toBe('a');
    expect(m?.lienQuan.map((x) => x.id)).toEqual(['b']);
    expect(kq.some((x) => x.loai === 'khai-tay-mot-tac-gia' && x.publicationId === 'a')).toBe(true);
    expect(kq.some((x) => x.loai === 'khai-tay-mot-tac-gia' && x.publicationId === 'b')).toBe(false);
  });

  it('NGOÀI TRƯỜNG mà địa chỉ là Trường; dạng tên lạ', () => {
    const kq = soatTacGia(
      [
        bai({
          authorsRaw: [
            { name: 'Hoang Anh Pham', isNonSchool: true, affiliation: 'Faculty of Physics, University of Science, VNU-HCM' },
            { name: 'Dang Minh An' },
          ],
          totalAuthors: 2,
          authors: [xn('u-an', 1)],
        }),
      ],
      NGUOI,
    );
    expect(kq.filter((x) => x.loai === 'ngoai-truong-dia-chi-truong')).toHaveLength(1);
    const la = kq.filter((x) => x.loai === 'bien-the-la');
    expect(la.map((x) => x.userId)).toEqual(['u-binh']);
  });
});

describe('laDiaChiTruong', () => {
  it('nhận các cách ghi tên Trường ở TP.HCM', () => {
    expect(laDiaChiTruong('Ho Chi Minh City University of Science')).toBe(true);
    expect(laDiaChiTruong('VNUHCM-University of Science, Ho Chi Minh City, Vietnam')).toBe(true);
    expect(laDiaChiTruong('Trường Đại học Khoa học Tự nhiên, ĐHQG-HCM')).toBe(true);
  });
  it('không nhầm với Hà Nội hay trường khác', () => {
    expect(laDiaChiTruong('VNU University of Science, Hanoi, Vietnam')).toBe(false);
    expect(laDiaChiTruong('Ho Chi Minh City University of Technology')).toBe(false);
    expect(laDiaChiTruong('University of Science and Technology, Ho Chi Minh City')).toBe(false);
    expect(laDiaChiTruong(null)).toBe(false);
  });
});

describe('tra cứu: địa chỉ, tác giả liên hệ, bản thảo', () => {
  it('nối MỌI địa chỉ, bỏ trùng/rỗng', () => {
    expect(noiDiaChi(['A', null, 'B', 'A', ' '])).toBe('A; B');
    expect(noiDiaChi([null])).toBeNull();
  });
  it('chỉ tin tác giả liên hệ của OpenAlex khi ĐÚNG MỘT người', () => {
    expect(lienHeDuyNhat([{ isCorresponding: true }, { isCorresponding: null }]).map((a) => a.isCorresponding)).toEqual([true, null]);
    expect(lienHeDuyNhat([{ isCorresponding: true }, { isCorresponding: true }]).map((a) => a.isCorresponding)).toEqual([null, null]);
  });
  it('nhận ra bản thảo; khoá tên bỏ dấu/ký tự', () => {
    expect(laBanThao({ doi: '10.48550/arXiv.2601.00001', type: 'article' })).toBe(true);
    expect(laBanThao({ type: 'posted-content' })).toBe(true);
    expect(laBanThao({ containerTitle: 'Research Square' })).toBe(true);
    expect(laBanThao({ doi: '10.3847/1538-4365/ae3951', type: 'journal-article', containerTitle: 'The Astrophysical Journal Supplement Series' })).toBe(false);
    expect(khoaTieuDe('Room-Temperature <i>Ferro</i>magnetism')).toBe(khoaTieuDe('room temperature ferromagnetism'));
  });
});
