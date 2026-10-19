import { describe, expect, it } from 'vitest';
import { ResolvedAuthorSchema } from './scholar.model';

// Cờ của tác giả CHƯA có tài khoản sống trong authorsRaw (JSON). Trường nào
// schema không khai thì Zod xoá âm thầm ở mỗi lần sửa bài — số tác giả chính và
// "tác giả chính thuộc Trường" lại sai như cũ (soát 3/10/2026).
describe('ResolvedAuthorSchema — cờ của tác giả chưa có tài khoản', () => {
  it('giữ isCorresponding (tác giả liên hệ ngoài hệ thống)', () => {
    const out = ResolvedAuthorSchema.parse({
      given: 'Bin Ho',
      family: 'Le',
      isNonSchool: true,
      isForeign: true,
      isCorresponding: true,
    });
    expect(out.isCorresponding).toBe(true);
  });

  it('giữ isNonSchool = false (sinh viên thuộc Trường, chưa có tài khoản)', () => {
    const out = ResolvedAuthorSchema.parse({ name: 'Nguyen Thi Huyen', isNonSchool: false });
    expect(out.isNonSchool).toBe(false);
  });

  it('dòng cũ không có cờ vẫn hợp lệ', () => {
    const out = ResolvedAuthorSchema.parse({ given: 'Tuan Van', family: 'Huynh' });
    expect(out.isCorresponding).toBeUndefined();
  });
});
