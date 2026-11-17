import { describe, expect, it } from 'vitest';
import { MaScopusSchema, tachMaScopus } from './scopus';

describe('Scopus Author ID — nhiều mã', () => {
  it('tách mọi kiểu ngăn, bỏ trùng, giữ thứ tự', () => {
    expect(tachMaScopus('57189905105; 57982213300,58079181800 / 59344544400\n57189905105')).toEqual([
      '57189905105',
      '57982213300',
      '58079181800',
      '59344544400',
    ]);
    expect(tachMaScopus(null)).toEqual([]);
  });

  it('lưu dạng chuẩn "a; b"', () => {
    expect(MaScopusSchema.parse('58136525200 , 58775804700')).toBe('58136525200; 58775804700');
    expect(MaScopusSchema.parse('57209863330')).toBe('57209863330');
  });

  it('chặn chữ (vd gõ họ tên vào ô mã) và nêu đúng phần sai', () => {
    const r = MaScopusSchema.safeParse('Huỳnh Quốc Việt');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain('Huỳnh, Quốc, Việt');
    expect(MaScopusSchema.safeParse('57209863330; abc').success).toBe(false);
  });

  it('không gửi / gửi null / gửi rỗng giữ nguyên ý nghĩa cũ', () => {
    expect(MaScopusSchema.parse(undefined)).toBeUndefined();
    expect(MaScopusSchema.parse(null)).toBeNull();
    expect(MaScopusSchema.parse('  ')).toBeNull();
  });
});
