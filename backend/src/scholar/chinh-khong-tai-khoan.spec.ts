import { describe, expect, it, vi } from 'vitest';
import { coChinhKhongTaiKhoanThuocTruong } from './chinh-khong-tai-khoan';
import { ScholarService } from './scholar.service';

/**
 * Tác giả chính THUỘC TRƯỜNG KHÔNG CÓ TÀI KHOẢN (22/11/2026): recount() từng suy
 * `mainAuthorAtSchool` chỉ từ tài khoản đã xác nhận → bài có sinh viên thuộc
 * Trường đứng đầu bị hạ cờ mỗi lần ai đó lưu phân loại / xác nhận lời mời / gỡ tên.
 */

const TRONG = { isNonSchool: false };
const NGOAI = { isNonSchool: true };
const khong = new Set<number>();

describe('coChinhKhongTaiKhoanThuocTruong', () => {
  it('sinh viên thuộc Trường đứng đầu, không tài khoản → có', () => {
    expect(
      coChinhKhongTaiKhoanThuocTruong([TRONG, NGOAI, NGOAI], new Set([1])),
    ).toBe(true);
  });

  it('người thuộc Trường đứng cuối → có; đã ghi rõ không tính Last → không', () => {
    expect(coChinhKhongTaiKhoanThuocTruong([NGOAI, NGOAI, TRONG], khong)).toBe(
      true,
    );
    expect(
      coChinhKhongTaiKhoanThuocTruong(
        [NGOAI, NGOAI, { ...TRONG, notLastAuthor: true }],
        khong,
      ),
    ).toBe(false);
  });

  it('đứng giữa: chỉ tính khi được đánh dấu liên hệ', () => {
    expect(coChinhKhongTaiKhoanThuocTruong([NGOAI, TRONG, NGOAI], khong)).toBe(
      false,
    );
    expect(
      coChinhKhongTaiKhoanThuocTruong(
        [NGOAI, { ...TRONG, isCorresponding: true }, NGOAI],
        khong,
      ),
    ).toBe(true);
  });

  it('hàng đã gắn tài khoản thì không xét ở đây (vai trò nằm trên dòng của người đó)', () => {
    expect(coChinhKhongTaiKhoanThuocTruong([TRONG, NGOAI], new Set([0]))).toBe(
      false,
    );
  });

  it('chưa rõ địa chỉ / ngoài Trường / nước ngoài / ĐHQG → không tính', () => {
    expect(coChinhKhongTaiKhoanThuocTruong([{ name: 'X' }, NGOAI], khong)).toBe(
      false,
    );
    expect(coChinhKhongTaiKhoanThuocTruong([NGOAI, NGOAI], khong)).toBe(false);
    expect(
      coChinhKhongTaiKhoanThuocTruong(
        [{ isNonSchool: false, isForeign: true }],
        khong,
      ),
    ).toBe(false);
    expect(
      coChinhKhongTaiKhoanThuocTruong(
        [{ isNonSchool: false, isVnu: true }],
        khong,
      ),
    ).toBe(false);
  });

  it('danh sách rỗng / không phải mảng → không', () => {
    expect(coChinhKhongTaiKhoanThuocTruong([], khong)).toBe(false);
    expect(coChinhKhongTaiKhoanThuocTruong(null, khong)).toBe(false);
  });
});

function dung(authorsRaw: unknown, rows: unknown[]) {
  const prisma = {
    publication: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ schoolAuthors: 2, totalAuthors: 3, authorsRaw }),
      update: vi.fn().mockResolvedValue({}),
    },
    publicationAuthor: { findMany: vi.fn().mockResolvedValue(rows) },
  };
  const svc = new ScholarService(
    prisma as never,
    {} as never,
    {} as never,
    { emit: vi.fn() } as never,
    {} as never,
  );
  const recount = (
    svc as unknown as { recount: (id: string) => Promise<void> }
  ).recount.bind(svc);
  return { prisma, recount };
}

const dong = (o: Record<string, unknown>) => ({
  claimStatus: 'CONFIRMED',
  isFirst: false,
  isCorresponding: false,
  isLast: false,
  ...o,
});

describe('recount(): mainAuthorAtSchool', () => {
  it('đồng nghiệp (đồng tác giả) xác nhận → KHÔNG hạ cờ của bài có sinh viên thuộc Trường đứng đầu', async () => {
    const { prisma, recount } = dung(
      [TRONG, TRONG, NGOAI],
      [dong({ authorIndex: 1 })],
    );
    await recount('p1');
    expect(
      prisma.publication.update.mock.calls[0][0].data.mainAuthorAtSchool,
    ).toBe(true);
  });

  it('không ai là tác giả chính thuộc Trường → false như cũ', async () => {
    const { prisma, recount } = dung(
      [NGOAI, TRONG, NGOAI],
      [dong({ authorIndex: 1 })],
    );
    await recount('p1');
    expect(
      prisma.publication.update.mock.calls[0][0].data.mainAuthorAtSchool,
    ).toBe(false);
  });

  it('hàng đầu là tài khoản CHƯA xác nhận → không tính thay họ (đếm sống ở kênh tích hợp)', async () => {
    const { prisma, recount } = dung(
      [TRONG, TRONG, NGOAI],
      [
        dong({ authorIndex: 1 }),
        dong({ authorIndex: 0, claimStatus: 'PENDING', isFirst: true }),
      ],
    );
    await recount('p1');
    expect(
      prisma.publication.update.mock.calls[0][0].data.mainAuthorAtSchool,
    ).toBe(false);
  });

  it('tài khoản đã xác nhận là tác giả chính → true như cũ', async () => {
    const { prisma, recount } = dung(
      [NGOAI, TRONG, NGOAI],
      [dong({ authorIndex: 1, isCorresponding: true })],
    );
    await recount('p1');
    expect(
      prisma.publication.update.mock.calls[0][0].data.mainAuthorAtSchool,
    ).toBe(true);
  });
});
