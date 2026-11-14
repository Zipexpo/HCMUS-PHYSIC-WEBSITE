/**
 * Địa chỉ gửi thư.
 *
 * Sinh ra từ một lỗi thật: `.env` trên máy chủ lưu
 *     SES_FROM_ADDRESS='ctbt2004@gmail.com'
 * với dấu nháy NẰM TRONG giá trị. Nhà cung cấp từ chối vì đó không phải địa chỉ
 * hợp lệ, mà lời báo lỗi lại không hề nhắc tới dấu nháy — mất khá lâu mới lần ra.
 *
 * Cấu hình giờ tự cắt dấu nháy bao quanh. Mấy bài kiểm này giữ luật đó.
 */
import { describe, expect, it } from 'vitest';

/** Bản sao luật trong config.ts, để kiểm không cần nạp cả cấu hình. */
const catDauNhay = (v?: string): string | undefined =>
  v?.replace(/^['"]|['"]$/g, '').trim();

/** Bản sao luật chọn địa chỉ gửi trong EmailService. */
const diaChiGui = (mailFrom?: string, sesFrom?: string): string => {
  const v = catDauNhay(mailFrom) || catDauNhay(sesFrom);
  if (!v) throw new Error('Chưa khai MAIL_FROM');
  return v;
};

describe('địa chỉ gửi thư', () => {
  it('cắt dấu nháy đơn bao quanh', () => {
    expect(catDauNhay("'a@b.vn'")).toBe('a@b.vn');
  });

  it('cắt dấu nháy kép bao quanh', () => {
    expect(catDauNhay('"a@b.vn"')).toBe('a@b.vn');
  });

  it('cắt khoảng trắng thừa', () => {
    expect(catDauNhay('  a@b.vn  ')).toBe('a@b.vn');
  });

  it('địa chỉ sạch thì giữ nguyên', () => {
    expect(catDauNhay('a@b.vn')).toBe('a@b.vn');
  });

  it('KHÔNG phá dạng "Tên <email>" — dấu ngoặc nhọn phải còn', () => {
    expect(catDauNhay('Khoa Vật lý <no-reply@phys.hcmus.edu.vn>')).toBe(
      'Khoa Vật lý <no-reply@phys.hcmus.edu.vn>',
    );
  });

  it('MAIL_FROM được ưu tiên hơn SES_FROM_ADDRESS cũ', () => {
    expect(diaChiGui('moi@hcmus.edu.vn', "'cu@gmail.com'")).toBe(
      'moi@hcmus.edu.vn',
    );
  });

  it('chưa khai MAIL_FROM thì lùi về cấu hình cũ, vẫn cắt dấu nháy', () => {
    expect(diaChiGui(undefined, "'cu@gmail.com'")).toBe('cu@gmail.com');
  });

  it('không khai gì thì BÁO LỖI RÕ, không âm thầm gửi bằng địa chỉ rỗng', () => {
    expect(() => diaChiGui(undefined, undefined)).toThrow('MAIL_FROM');
  });

  it('chuỗi rỗng cũng coi như chưa khai', () => {
    expect(() => diaChiGui('', '')).toThrow('MAIL_FROM');
  });
});
