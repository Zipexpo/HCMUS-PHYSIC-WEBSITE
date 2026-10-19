import { describe, expect, it } from 'vitest';
import { FacultyDetailResSchema, FacultyReportResSchema } from './scholar.model';

// phys-profile lọc đề tài "đang thực hiện trong khoảng" bằng mốc chốt thực tế
// (tháng nghiệm thu). Trường nào schema phản hồi không khai thì bộ lọc Zod xoá
// âm thầm — bên nhận lại tưởng đề tài chưa nghiệm thu.
const deTai = {
  status: 'COMPLETED',
  startYear: 2023,
  startMonth: 2,
  endYear: 2025,
  endMonth: 2,
  finishedYear: 2026,
  finishedMonth: 2,
};

describe('mốc chốt đề tài trong phản hồi thống kê', () => {
  it('báo cáo xuất Excel giữ finishedYear/finishedMonth', () => {
    const out = FacultyReportResSchema.parse({
      publications: [],
      projects: [
        {
          ...deTai,
          code: 'B2023-18-12',
          decisionNo: null,
          catalogCode: null,
          title: 'Đề tài thử',
          leadName: 'Nguyễn Văn A',
          memberNames: [],
          memberCount: 1,
        },
      ],
    });
    expect(out.projects[0]).toMatchObject({ finishedYear: 2026, finishedMonth: 2 });
  });

  it('dữ liệu trang thống kê giữ finishedYear/finishedMonth; chưa chốt thì null', () => {
    const out = FacultyDetailResSchema.parse({
      publications: [],
      projects: [
        { ...deTai, budget: null },
        { ...deTai, status: 'ONGOING', finishedYear: null, finishedMonth: null, budget: 1e8 },
      ],
    });
    expect(out.projects.map((p) => [p.finishedYear, p.finishedMonth])).toEqual([
      [2026, 2],
      [null, null],
    ]);
  });
});
