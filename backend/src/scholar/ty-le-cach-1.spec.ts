import { describe, expect, it } from 'vitest';
import { hangThieuTyLeCach1 } from './ty-le-cach-1';

// 4 tác giả: hàng 1 đại diện, hàng 2 đồng nghiệp trong Khoa, hàng 3 ghi địa chỉ
// ngoài Trường, hàng 4 người nước ngoài.
const raw = [
  { name: 'A' },
  { name: 'B' },
  { name: 'C', isNonSchool: true },
  { name: 'D', isForeign: true },
];

describe('hangThieuTyLeCach1 — Cách 1 cấm 0% cho tác giả thuộc Trường', () => {
  it('Cách 2 (không ai có %) → không kiểm', () => {
    expect(
      hangThieuTyLeCach1({
        me: { sharePercent: null, authorIndex: 0 },
        dongTacGia: [{ sharePercent: null, authorIndex: 1 }],
        raw,
      }),
    ).toEqual([]);
  });

  it('đại diện 100%, đồng nghiệp trống → chặn hàng 2 (ca thật đề tài đèn LED UV)', () => {
    expect(
      hangThieuTyLeCach1({
        me: { sharePercent: 100, authorIndex: 0 },
        dongTacGia: [{ sharePercent: null, authorIndex: 1 }],
        raw,
      }),
    ).toEqual([2]);
  });

  it('đủ % cho mọi người thuộc Trường → hợp lệ', () => {
    expect(
      hangThieuTyLeCach1({
        me: { sharePercent: 60, authorIndex: 0 },
        dongTacGia: [{ sharePercent: 40, authorIndex: 1 }],
        raw,
      }),
    ).toEqual([]);
  });

  it('người có tài khoản nhưng ghi địa chỉ NGOÀI Trường trên bài này → không bắt %', () => {
    expect(
      hangThieuTyLeCach1({
        me: { sharePercent: 100, authorIndex: 0 },
        dongTacGia: [
          { sharePercent: 1, authorIndex: 1 },
          { sharePercent: null, authorIndex: 2 },
          { sharePercent: null, authorIndex: 3 },
        ],
        raw,
      }),
    ).toEqual([]);
  });

  it('đồng nghiệp không gửi sharePercent (undefined = giữ nguyên) → không phán xét', () => {
    expect(
      hangThieuTyLeCach1({
        me: { sharePercent: 100, authorIndex: 0 },
        dongTacGia: [{ authorIndex: 1 }],
        raw,
      }),
    ).toEqual([]);
  });

  it('Cách 1 bật chỉ bởi tác giả không tài khoản → đại diện trống cũng bị chặn', () => {
    expect(
      hangThieuTyLeCach1({
        me: { sharePercent: null, authorIndex: 0 },
        ngoai: [{ sharePercent: 50 }],
        raw,
      }),
    ).toEqual([1]);
  });

  it('không biết vị trí → coi là thuộc Trường, báo hàng 0 (thông báo không nêu số hàng)', () => {
    expect(
      hangThieuTyLeCach1({
        me: { sharePercent: 100, authorIndex: 0 },
        dongTacGia: [{ sharePercent: null }],
        raw,
      }),
    ).toEqual([0]);
  });

  it('lượt sửa không gửi me (giữ % của đại diện) vẫn kiểm đồng nghiệp', () => {
    expect(
      hangThieuTyLeCach1({
        dongTacGia: [
          { sharePercent: 50, authorIndex: 0 },
          { sharePercent: null, authorIndex: 1 },
        ],
        raw,
      }),
    ).toEqual([2]);
  });
});
