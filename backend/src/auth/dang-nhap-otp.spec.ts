/**
 * Đăng nhập bằng mã gửi qua email.
 *
 * Luật phải giữ:
 *  1. Mã loại FORGOT_PASSWORD KHÔNG đăng nhập được, và ngược lại — một mã lọt
 *     ra ngoài thì chỉ làm được đúng một việc.
 *  2. Mã hết hạn bị từ chối.
 *  3. Tài khoản đã vô hiệu không vào được, dù mã đúng.
 *  4. Mã dùng xong bị xoá — chỉ dùng được một lần.
 */
import { describe, expect, it } from 'vitest';
import { VerificationMethod } from '../shared/constants/auth.constants';

/** Bản sao thuần của luật trong AuthService.loginWithOtp, để kiểm không cần DB. */
type Code = {
  email: string;
  code: string;
  type: VerificationMethod;
  expiresAt: Date;
};
type User = { email: string; isActive: boolean };

type Ket = 'OK' | 'MA_SAI' | 'MA_HET_HAN' | 'TAI_KHOAN_KHOA' | 'KHONG_CO_USER';

function thuDangNhap(
  luu: Code[],
  users: User[],
  vao: { email: string; code: string },
  bayGio = new Date('2026-01-01T10:00:00Z'),
): Ket {
  const hit = luu.find(
    (c) =>
      c.email === vao.email &&
      c.code === vao.code &&
      // Loại mã PHẢI là Login. Đây là dòng giữ luật số 1.
      c.type === VerificationMethod.Login,
  );
  if (!hit) return 'MA_SAI';
  if (hit.expiresAt < bayGio) return 'MA_HET_HAN';
  const u = users.find((x) => x.email === vao.email);
  if (!u) return 'KHONG_CO_USER';
  if (!u.isActive) return 'TAI_KHOAN_KHOA';
  return 'OK';
}

const SAU = new Date('2026-01-01T10:05:00Z');
const TRUOC = new Date('2026-01-01T09:55:00Z');
const USERS: User[] = [
  { email: 'gv@hcmus.edu.vn', isActive: true },
  { email: 'nghi@hcmus.edu.vn', isActive: false },
];

describe('đăng nhập bằng OTP', () => {
  it('mã đúng, còn hạn, tài khoản hoạt động → vào được', () => {
    const luu: Code[] = [
      { email: 'gv@hcmus.edu.vn', code: '123456', type: VerificationMethod.Login, expiresAt: SAU },
    ];
    expect(thuDangNhap(luu, USERS, { email: 'gv@hcmus.edu.vn', code: '123456' })).toBe('OK');
  });

  it('mã XIN CHO QUÊN MẬT KHẨU không đăng nhập được', () => {
    const luu: Code[] = [
      {
        email: 'gv@hcmus.edu.vn',
        code: '123456',
        type: VerificationMethod.ForgotPassword,
        expiresAt: SAU,
      },
    ];
    expect(thuDangNhap(luu, USERS, { email: 'gv@hcmus.edu.vn', code: '123456' })).toBe('MA_SAI');
  });

  it('mã hết hạn bị từ chối', () => {
    const luu: Code[] = [
      { email: 'gv@hcmus.edu.vn', code: '123456', type: VerificationMethod.Login, expiresAt: TRUOC },
    ];
    expect(thuDangNhap(luu, USERS, { email: 'gv@hcmus.edu.vn', code: '123456' })).toBe('MA_HET_HAN');
  });

  it('tài khoản đã vô hiệu không vào được dù mã đúng', () => {
    const luu: Code[] = [
      { email: 'nghi@hcmus.edu.vn', code: '123456', type: VerificationMethod.Login, expiresAt: SAU },
    ];
    expect(thuDangNhap(luu, USERS, { email: 'nghi@hcmus.edu.vn', code: '123456' })).toBe(
      'TAI_KHOAN_KHOA',
    );
  });

  it('mã của người KHÁC không dùng cho email mình được', () => {
    const luu: Code[] = [
      { email: 'gv@hcmus.edu.vn', code: '123456', type: VerificationMethod.Login, expiresAt: SAU },
    ];
    expect(thuDangNhap(luu, USERS, { email: 'nghi@hcmus.edu.vn', code: '123456' })).toBe('MA_SAI');
  });

  it('mã đã bị xoá sau lần dùng đầu → lần hai thất bại', () => {
    const luu: Code[] = [
      { email: 'gv@hcmus.edu.vn', code: '123456', type: VerificationMethod.Login, expiresAt: SAU },
    ];
    expect(thuDangNhap(luu, USERS, { email: 'gv@hcmus.edu.vn', code: '123456' })).toBe('OK');
    // Service xoá mã ngay sau khi dùng; mô phỏng đúng việc đó.
    luu.length = 0;
    expect(thuDangNhap(luu, USERS, { email: 'gv@hcmus.edu.vn', code: '123456' })).toBe('MA_SAI');
  });

  it('hai loại mã là hai giá trị khác nhau', () => {
    expect(VerificationMethod.Login).not.toBe(VerificationMethod.ForgotPassword);
  });
});
