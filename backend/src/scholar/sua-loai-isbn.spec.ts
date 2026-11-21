import { describe, expect, it, vi } from 'vitest';
import { ScholarService } from './scholar.service';
import { UpdatePublicationBodySchema } from './scholar.model';

/**
 * Form "Sửa thông tin" (phys-profile publication-edit.tsx) gửi `type` và `isbn` từ
 * lâu, nhưng schema sửa không có hai trường này nên Zod lặng lẽ bỏ: đổi loại ấn phẩm
 * hay nhập ISBN sách xong, mở lại vẫn như cũ (báo thật 21/11/2026 — bài ISMIR 2024
 * nạp từ DOI arXiv mang loại "text", đổi sang báo cáo hội nghị không ăn).
 */

function dung() {
  const prisma = {
    publicationAuthor: {
      findUnique: vi.fn().mockResolvedValue({ claimStatus: 'CONFIRMED' }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    publication: {
      findUnique: vi.fn().mockResolvedValue({
        publishedYear: 2024,
        acceptedYear: null,
        catalogCode: '2.1e',
        schoolAuthors: 1,
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const svc = new ScholarService(prisma as never, {} as never, {} as never, { emit: vi.fn() } as never, {} as never);
  const lo = svc as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(lo, 'findOne').mockResolvedValue({ id: 'p1' });
  vi.spyOn(lo, 'revalidateStaffPages').mockResolvedValue(undefined);
  vi.spyOn(lo, 'recount').mockResolvedValue(undefined);
  return { svc, prisma };
}

const ghi = (prisma: ReturnType<typeof dung>['prisma']) =>
  (prisma.publication.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;

describe('UpdatePublicationBodySchema — loại ấn phẩm và ISBN không còn bị bỏ', () => {
  it('giữ type và isbn', () => {
    const b = UpdatePublicationBodySchema.parse({ type: 'proceedings-article', isbn: '978-1-7327299-4-0' });
    expect(b.type).toBe('proceedings-article');
    expect(b.isbn).toBe('978-1-7327299-4-0');
  });
  it('nhận cả loại lạ do Crossref/DataCite đặt — form gửi lại nguyên loại đang lưu', () =>
    expect(UpdatePublicationBodySchema.parse({ type: 'text' }).type).toBe('text'));
  it('loại rỗng bị chặn', () => expect(() => UpdatePublicationBodySchema.parse({ type: '  ' })).toThrow());
});

describe('ScholarService.update — ghi loại ấn phẩm, ISBN, xoá được ISSN', () => {
  it('ghi type + isbn, ô ISSN để trống thì xoá', async () => {
    const { svc, prisma } = dung();
    await svc.update(
      'ngan',
      'p1',
      UpdatePublicationBodySchema.parse({ type: 'proceedings-article', isbn: ' 978-1-7327299-4-0 ', issn: null }),
    );
    const d = ghi(prisma);
    expect(d.type).toBe('proceedings-article');
    expect(d.isbn).toBe('978-1-7327299-4-0');
    expect(d.issn).toBeNull();
  });
  it('không gửi thì giữ nguyên (lưu phân loại không đụng loại, ISSN, ISBN)', async () => {
    const { svc, prisma } = dung();
    await svc.update('ngan', 'p1', UpdatePublicationBodySchema.parse({ catalogCode: '2.1e' }));
    const d = ghi(prisma);
    expect(d.type).toBeUndefined();
    expect(d.isbn).toBeUndefined();
    expect(d.issn).toBeUndefined();
  });
});
