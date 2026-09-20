import { describe, expect, it, vi } from 'vitest';
import { StaffPageService } from './staff-page.service';

// Dịch vụ làm mới trang công khai không dùng tới trong departmentStaff(); thay
// bằng lớp rỗng để test không phụ thuộc cấu hình môi trường của nó.
vi.mock('../shared/services/public-revalidate.service', () => ({
  PublicRevalidateService: class {},
}));

/**
 * Trang /giang-vien-co-huu gom mục "Ban lãnh đạo Khoa" từ `facultyRole` của API
 * đội ngũ bộ môn.
 *
 * Lỗi thật 13/9/2026: `facultyRole` được tính và có trong schema, nhưng bước
 * dựng kết quả chép lại từng người bằng một DANH SÁCH CHO QUA và quên nó — API
 * không bao giờ trả trường này, mục lãnh đạo không bao giờ hiện, mà không test
 * nào đỏ. Test gọi thẳng departmentStaff() để khoá đúng con đường đó.
 */
const trang = (slug: string, ten: string, email: string) => ({
  slug,
  puckData: {
    content: [{ type: 'StaffProfileEditorial', props: { name: ten, email } }],
  },
  publishedPuckData: null,
});

function dung(chucVuTheoSlug: Record<string, string | null>) {
  const slugs = Object.keys(chucVuTheoSlug);
  const prisma = {
    department: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Bộ môn thử' }),
    },
    pageLayout: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          slugs.map((s, i) =>
            trang(s, `Người ${i + 1}`, `n${i + 1}@hcmus.edu.vn`),
          ),
        ),
    },
    scholarProfile: {
      findMany: vi.fn().mockResolvedValue(
        slugs.map((s, i) => ({
          staffPageSlug: s,
          showOnWeb: true,
          user: {
            email: `n${i + 1}@hcmus.edu.vn`,
            degree: null,
            rank: null,
            positionKey: chucVuTheoSlug[s],
            employmentType: null,
          },
        })),
      ),
    },
  };
  const cache = { get: vi.fn().mockResolvedValue(undefined), set: vi.fn() };
  return new StaffPageService(
    prisma as never,
    cache as never,
    {} as never,
    {} as never,
  );
}

describe('StaffPageService.departmentStaff — facultyRole đi tới tận API', () => {
  it('trưởng khoa, phó trưởng khoa mang facultyRole; người khác là null', async () => {
    const svc = dung({
      'bo-mon-thu/nhan-su/a': 'truong_khoa',
      'bo-mon-thu/nhan-su/b': 'pho_truong_khoa',
      'bo-mon-thu/nhan-su/c': 'truong_bo_mon',
      'bo-mon-thu/nhan-su/d': null,
    });
    const kq = await svc.departmentStaff('bo-mon-thu');
    const theoSlug = Object.fromEntries(
      kq.people.map((p) => [p.slug, p.facultyRole]),
    );
    expect(theoSlug['bo-mon-thu/nhan-su/a']).toEqual({
      vi: 'Trưởng khoa',
      en: 'Dean',
    });
    expect(theoSlug['bo-mon-thu/nhan-su/b']).toEqual({
      vi: 'Phó Trưởng khoa',
      en: 'Vice Dean',
    });
    expect(theoSlug['bo-mon-thu/nhan-su/c']).toBeNull();
    expect(theoSlug['bo-mon-thu/nhan-su/d']).toBeNull();
  });

  it('người nào trong kết quả cũng CÓ khoá facultyRole — không bị bước chép bỏ rơi', async () => {
    const svc = dung({ 'bo-mon-thu/nhan-su/a': null });
    const kq = await svc.departmentStaff('bo-mon-thu');
    expect(kq.people).toHaveLength(1);
    expect('facultyRole' in kq.people[0]).toBe(true);
  });
});
