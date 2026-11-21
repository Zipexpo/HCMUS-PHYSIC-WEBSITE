import { describe, expect, it } from 'vitest';
import { docBangSjr } from '../scholar/xep-hang';

// Ba dòng đầu tệp thật "scimagojr 2025.csv" (SCImago, tải 11/2026).
const mau = [
  "Rank;Sourceid;Title;Type;Issn;Publisher;Open Access;Open Access Diamond;SJR;SJR Best Quartile;H index;Total Docs. (2025);Total Docs. (3years);Total Refs.;Total Citations (3years);Citable Docs. (3years);Citations / Doc. (2years);Ref. / Doc.;%Female;Overton;Country;Region;Publisher;Coverage;Categories;Areas",
  "1;28773;\"Ca-A Cancer Journal for Clinicians\";journal;\"15424863, 00079235\";\"John Wiley and Sons Inc\";No;No;104,065;Q1;236;48;127;4331;29333;76;285,55;90,23;46,34;2;United States;Northern America;\"John Wiley and Sons Inc\";\"1950-2026\";\"Hematology (Q1); Oncology (Q1)\";\"Medicine\"",
  "2;20315;\"Nature Reviews Molecular Cell Biology\";journal;\"14710072, 14710080\";\"Nature Research\";No;No;35,568;Q1;553;122;350;12007;16938;176;45,22;98,42;34,87;0;United Kingdom;Western Europe;\"Nature Research\";\"2000-2026\";\"Cell Biology (Q1); Molecular Biology (Q1)\";\"Biochemistry, Genetics and Molecular Biology\"",
].join('\n');

describe('docBangSjr đọc thêm cột "H index" (cho bộ tính điểm HĐGS)', () => {
  it('lấy đúng H-index và giữ nguyên các cột cũ', () => {
    const { nam, ds } = docBangSjr(mau);
    expect(nam).toBe(2025);
    expect(ds.map((x) => [x.title, x.hIndex, x.bestQuartile])).toEqual([
      ['Ca-A Cancer Journal for Clinicians', 236, 'Q1'],
      ['Nature Reviews Molecular Cell Biology', 553, 'Q1'],
    ]);
  });

  it('tệp không có cột H index → null, không vỡ', () => {
    const boCot = mau.replace('H index;', 'X;');
    expect(docBangSjr(boCot).ds[0].hIndex).toBeNull();
  });
});
