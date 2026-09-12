import { describe, expect, it } from 'vitest';
import { soThang } from './project.service';

/**
 * Số tháng thực hiện là MẪU SỐ của phép chia giờ theo năm học (Phụ lục 2 tr.
 * 2.7). Lệch một tháng là lệch giờ của mọi thành viên, ở mọi năm — nên nó đáng
 * có test riêng dù chỉ là một phép trừ.
 *
 * Quy ước HIỆU SỐ (span): end − start, KHÔNG cộng 1. Đúng một năm (2/2025 →
 * 2/2026) ra 12; nửa cuối năm dương lịch (1 → 12) ra 11; cùng tháng ra 0.
 */
describe('soThang', () => {
  it('đúng một năm là 12 tháng', () => {
    // 2/2025 → 2/2026 = 12 (một năm chẵn), không phải 13.
    expect(soThang(2025, 2, 2026, 2)).toBe(12);
  });

  it('trong cùng một năm dương lịch là hiệu số tháng', () => {
    // 1/2025 → 12/2025 = 11 (span), không phải 12.
    expect(soThang(2025, 1, 2025, 12)).toBe(11);
  });

  it('cùng một tháng thì hiệu số bằng không', () => {
    expect(soThang(2025, 6, 2025, 6)).toBe(0);
  });

  it('bắc qua nhiều năm', () => {
    expect(soThang(2024, 7, 2027, 6)).toBe(35);
  });

  it('bắc qua ranh giới năm dương lịch', () => {
    expect(soThang(2025, 11, 2026, 2)).toBe(3);
  });

  it('thiếu bất kỳ mốc nào thì không suy được — trả null để dùng số nhập tay', () => {
    expect(soThang(null, 1, 2025, 12)).toBeNull();
    expect(soThang(2025, null, 2025, 12)).toBeNull();
    expect(soThang(2025, 1, null, 12)).toBeNull();
    expect(soThang(2025, 1, 2025, null)).toBeNull();
    expect(soThang(undefined, undefined, undefined, undefined)).toBeNull();
  });

  it('kết thúc trước khi bắt đầu là dữ liệu sai — trả null, KHÔNG trả số âm', () => {
    // Trả số âm thì nó chảy thẳng vào mẫu số và cho ra giờ âm mà không ai thấy.
    expect(soThang(2026, 5, 2025, 3)).toBeNull();
  });
});
