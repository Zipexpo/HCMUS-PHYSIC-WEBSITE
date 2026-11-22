import { describe, expect, it, vi } from 'vitest';
import { ScholarService } from './scholar.service';
import {
  ClaimResponseBodySchema,
  CreatePublicationBodySchema,
  UpdatePublicationBodySchema,
} from './scholar.model';

/**
 * `me` KHI SỬA BÀI: TRƯỜNG KHÔNG GỬI THÌ GIỮ NGUYÊN.
 *
 * Báo thật 22/11/2026: một giảng viên lưu bài Q3 với vai trò tác giả đầu + liên
 * hệ ba lần, hôm sau lại thấy «Không có tác giả chính thuộc Trường». Thủ phạm là
 * nút «Hiện trên web» ở danh sách công bố: nó gửi `{ me: { showOnWeb } }`, và
 * `MyAuthorshipSchema.partial()` — dưới Zod 4 vẫn điền `.default()` bên trong
 * `.optional()` — biến nó thành `{ authorIndex: -1, isFirst: false,
 * isCorresponding: false, isLast: false }`. attachSelf ghi đúng thứ đó: mất hàng,
 * mất vai trò. Chiều ngược lại, form sửa không gửi `showOnWeb` nên mỗi lần lưu bài
 * lại hiện trên web. Bài không có Last Author (người đứng cuối bị bỏ đánh dấu) thì
 * lộ ra rõ nhất, vì người bấm là tác giả chính DUY NHẤT của bài.
 */

const YEN = {
  userId: 'yen',
  claimStatus: 'CONFIRMED' as const,
  authorIndex: 0,
  isFirst: true,
  isCorresponding: true,
  isLast: false,
  sharePercent: null,
};

function dung() {
  const prisma = {
    publicationAuthor: {
      findUnique: vi.fn().mockResolvedValue({
        claimStatus: 'CONFIRMED',
        sharePercent: null,
        isFirst: true,
        isCorresponding: true,
        isLast: false,
      }),
      findMany: vi.fn().mockResolvedValue([YEN]),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    publication: {
      findUnique: vi.fn().mockResolvedValue({
        publishedYear: 2026,
        acceptedYear: 2026,
        catalogCode: '1.1d',
        schoolAuthors: 1,
        totalAuthors: 3,
        externalMainAuthors: 0,
        authorsRaw: [
          { name: 'Hứa Thị Hoàng Yến', isNonSchool: false },
          { name: 'Nguyễn Hồng Giang', isNonSchool: true },
          {
            name: 'Đặng Văn Liệt',
            isNonSchool: true,
            notLastAuthor: true,
            notLastAuthorReason: 'Tác giả ngoài trường',
          },
        ],
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const svc = new ScholarService(
    prisma as never,
    {} as never,
    {} as never,
    { emit: vi.fn() } as never,
    {} as never,
  );
  const lo = svc as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(lo, 'findOne').mockResolvedValue({ id: 'p1' });
  vi.spyOn(lo, 'revalidateStaffPages').mockResolvedValue(undefined);
  vi.spyOn(lo, 'recount').mockResolvedValue(undefined);
  return { svc, prisma };
}

describe('Schema: `me` khi sửa bài không tự điền mặc định', () => {
  it('chỉ gửi showOnWeb → chỉ có showOnWeb, KHÔNG có hàng −1 hay cờ false', () => {
    const b = UpdatePublicationBodySchema.parse({ me: { showOnWeb: false } });
    expect(b.me).toEqual({ showOnWeb: false });
  });

  it('form sửa không gửi showOnWeb → không bật lại «hiện trên web»', () => {
    const b = UpdatePublicationBodySchema.parse({
      me: {
        authorIndex: 0,
        isFirst: true,
        isCorresponding: true,
        isLast: false,
      },
    });
    expect(b.me?.showOnWeb).toBeUndefined();
    expect(b.me?.authorIndex).toBe(0);
  });

  it('xác nhận lời mời chỉ gửi hàng → vai trò không bị điền false', () => {
    const b = ClaimResponseBodySchema.parse({
      accept: true,
      authorship: { authorIndex: 2 },
    });
    expect(b.authorship).toEqual({ authorIndex: 2 });
  });

  it('vẫn kiểm giá trị như bản đầy đủ (hàng < −1 bị từ chối)', () => {
    expect(() =>
      UpdatePublicationBodySchema.parse({ me: { authorIndex: -2 } }),
    ).toThrow();
  });

  it('KHAI MỚI giữ mặc định như cũ (chưa chỉ hàng = −1)', () => {
    const b = CreatePublicationBodySchema.parse({
      work: {
        doi: null,
        type: 'journal-article',
        title: 'X',
        publishedYear: 2026,
        publishedMonth: 3,
        authors: [],
        source: 'crossref',
      },
      me: {},
    });
    expect(b.me.authorIndex).toBe(-1);
    expect(b.me.showOnWeb).toBe(true);
  });
});

describe('Lưu bài: nút «Hiện trên web» không đụng hàng và vai trò', () => {
  it('ẩn bài khỏi web → dòng của mình chỉ đổi showOnWeb', async () => {
    const { svc, prisma } = dung();
    await svc.update(
      'yen',
      'p1',
      UpdatePublicationBodySchema.parse({ me: { showOnWeb: false } }),
    );
    const data = prisma.publicationAuthor.upsert.mock.calls[0][0].update;
    expect(data.showOnWeb).toBe(false);
    expect(data.authorIndex).toBeUndefined();
    expect(data.isFirst).toBeUndefined();
    expect(data.isCorresponding).toBeUndefined();
    expect(data.isLast).toBeUndefined();
    // Tỷ lệ Cách 1 cũng giữ nguyên.
    expect(data.sharePercent).toBeUndefined();
  });

  it('lưu form sửa (không gửi showOnWeb) → không bật lại hiện trên web', async () => {
    const { svc, prisma } = dung();
    await svc.update(
      'yen',
      'p1',
      UpdatePublicationBodySchema.parse({
        me: {
          authorIndex: 0,
          isFirst: true,
          isCorresponding: true,
          isLast: false,
        },
      }),
    );
    const data = prisma.publicationAuthor.upsert.mock.calls[0][0].update;
    expect(data.showOnWeb).toBeUndefined();
    expect(data.authorIndex).toBe(0);
    expect(data.isCorresponding).toBe(true);
  });
});
