import { describe, expect, it } from 'vitest';
import { tacGiaBaoCao, type TacGiaDaXacNhan } from './report-authors';
import { FacultyReportResSchema } from './scholar.model';

/**
 * Chi tiết tác giả cho file báo cáo NCKH — yêu cầu 3/10/2026: xuất được ai là
 * 1st / liên hệ / cuối, ai thuộc Trường / ĐHQG / trong nước / nước ngoài, ai là
 * sinh viên / học viên cao học / NCS, rồi đếm số lượng.
 */
const tk = (o: Partial<TacGiaDaXacNhan>): TacGiaDaXacNhan => ({
  authorIndex: -1,
  isFirst: false,
  isCorresponding: false,
  isLast: false,
  name: 'Huỳnh Văn Tuấn',
  rank: 'GVCC',
  ...o,
});

describe('tacGiaBaoCao', () => {
  it('mỗi hàng authorsRaw một tác giả, giữ thứ tự, cờ và địa chỉ nguyên văn', () => {
    const r = tacGiaBaoCao(
      [
        { given: 'Thai D.', family: 'Phung', affiliation: 'Dong Thap University, Vietnam', isNonSchool: true },
        { given: 'Kieu T. Thi', family: 'Huynh', studentType: 'cao_hoc' },
        { name: 'Truong A. Dang', isNonSchool: false, isVnu: false, isForeign: false },
      ],
      [],
    );
    expect(r.map((a) => [a.order, a.name])).toEqual([
      [1, 'Thai D. Phung'],
      [2, 'Kieu T. Thi Huynh'],
      [3, 'Truong A. Dang'],
    ]);
    expect(r[0]).toMatchObject({ affiliation: 'Dong Thap University, Vietnam', isNonSchool: true, isVnu: null });
    expect(r[1]).toMatchObject({ studentType: 'cao_hoc', isNonSchool: null, affiliation: null });
    expect(r[2]).toMatchObject({ isNonSchool: false, isVnu: false, isForeign: false });
  });

  it('tài khoản đã xác nhận gắn vào đúng hàng, mang vai trò và ngạch', () => {
    const r = tacGiaBaoCao(
      [{ name: 'Viet Quoc Huynh' }, { name: 'Tuan Van Huynh' }],
      [tk({ authorIndex: 1, isLast: true, isCorresponding: true })],
    );
    expect(r[0].account).toBeNull();
    expect(r[1].account).toEqual({
      name: 'Huỳnh Văn Tuấn',
      rank: 'GVCC',
      isFirst: false,
      isCorresponding: true,
      isLast: true,
    });
  });

  it('tài khoản chưa chỉ hàng vẫn lên báo cáo, thứ tự không rõ', () => {
    const r = tacGiaBaoCao([{ name: 'A' }, { name: 'B' }], [tk({ authorIndex: -1 })]);
    expect(r).toHaveLength(3);
    expect(r[2]).toMatchObject({ name: 'Huỳnh Văn Tuấn', order: null });
  });

  it('hai tài khoản cùng chỉ một hàng: người sau không bị đè mất', () => {
    const r = tacGiaBaoCao(
      [{ name: 'A' }],
      [tk({ authorIndex: 0, name: 'Người 1' }), tk({ authorIndex: 0, name: 'Người 2' })],
    );
    expect(r.map((a) => [a.order, a.account?.name])).toEqual([
      [1, 'Người 1'],
      [null, 'Người 2'],
    ]);
  });

  it('bài khai tay (không có danh sách): liệt kê tài khoản, lấy vị trí người khai chọn', () => {
    const r = tacGiaBaoCao([], [tk({ authorIndex: 1, name: 'Đặng Trường An', rank: 'GVCC' })]);
    expect(r).toEqual([
      expect.objectContaining({ name: 'Đặng Trường An', order: 2, account: expect.objectContaining({ rank: 'GVCC' }) }),
    ]);
  });

  it('diện học viên lạ, cờ không phải boolean, hàng rỗng → bỏ qua, không văng', () => {
    const r = tacGiaBaoCao(
      [null, { name: '  ', studentType: 'giao_su', isForeign: 'true' }],
      [],
    );
    expect(r[0]).toMatchObject({ name: 'Tác giả 1', studentType: null });
    expect(r[1]).toMatchObject({ name: 'Tác giả 2', studentType: null, isForeign: null });
    expect(tacGiaBaoCao(undefined, [])).toEqual([]);
  });

  it('schema phản hồi GIỮ authorDetails — thiếu khai báo thì bộ lọc Zod xoá sạch', () => {
    const bai = {
      type: 'journal-article', countYear: 2026, publishedYear: 2026, publishedMonth: 9,
      acceptedYear: null, acceptedMonth: null, status: 'PUBLISHED', quartile: 'Q3',
      catalogCode: '1.1d', title: 'X', containerTitle: null, volume: null, issue: null,
      pages: null, issn: null, doi: null, url: null, publisher: null, isbn: null,
      totalAuthors: 2, authorNames: ['A', 'B'], systemAuthors: [], firstAuthor: 'A',
      correspondingAuthor: '',
      authorDetails: tacGiaBaoCao([{ name: 'A', isForeign: true }], [tk({ authorIndex: 0 })]),
    };
    const out = FacultyReportResSchema.parse({ publications: [bai], projects: [] });
    expect(out.publications[0].authorDetails[0]).toMatchObject({
      name: 'A',
      isForeign: true,
      account: { name: 'Huỳnh Văn Tuấn', rank: 'GVCC' },
    });
  });
});
