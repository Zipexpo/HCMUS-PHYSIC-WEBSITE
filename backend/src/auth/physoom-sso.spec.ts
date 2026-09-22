import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SsoTokenError,
  laEmailSinhVien,
  splitVietnameseName,
  verifyPhysoomToken,
} from './physoom-sso';

const SECRET = 'bi-mat-dung-chung-voi-physoom';

/** Ký y hệt cách PHYsoom/ACADsoom ký (src/lib/ssoToken.js bên ACADsoom). */
function sign(
  payload: Record<string, unknown>,
  secret = SECRET,
  expSeconds = 120,
): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    ...payload,
    iat: now,
    exp: now + expSeconds,
  })}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const BASE = {
  aud: 'physprofile',
  email: 'GV@hcmus.edu.vn',
  name: 'Nguyễn Vương Thuỳ Ngân',
  teacher_id: '12345',
};

describe('verifyPhysoomToken — token hợp lệ', () => {
  it('đọc được payload, hạ email về chữ thường', () => {
    const p = verifyPhysoomToken(sign(BASE), SECRET, 'physprofile');
    expect(p.email).toBe('gv@hcmus.edu.vn');
    expect(p.teacher_id).toBe('12345');
  });

  it('tên tiếng Việt có dấu không bị hỏng', () => {
    const p = verifyPhysoomToken(sign(BASE), SECRET, 'physprofile');
    expect(p.name).toBe('Nguyễn Vương Thuỳ Ngân');
  });

  it('token đời cũ không có aud vẫn chấp nhận', () => {
    const { aud: _aud, ...noAud } = BASE;
    expect(verifyPhysoomToken(sign(noAud), SECRET, 'physprofile').email).toBe(
      'gv@hcmus.edu.vn',
    );
  });
});

describe('verifyPhysoomToken — token phải bị từ chối', () => {
  it('sai chữ ký', () => {
    expect(() =>
      verifyPhysoomToken(sign(BASE, 'bi-mat-khac'), SECRET, 'physprofile'),
    ).toThrow(SsoTokenError);
  });

  it('bị sửa nội dung sau khi ký', () => {
    const [h, , s] = sign(BASE).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...BASE, email: 'ke-gian@example.com', exp: 9e9 }),
    ).toString('base64url');
    expect(() =>
      verifyPhysoomToken(`${h}.${forged}.${s}`, SECRET, 'physprofile'),
    ).toThrow(SsoTokenError);
  });

  it('hết hạn', () => {
    expect(() =>
      verifyPhysoomToken(sign(BASE, SECRET, -10), SECRET, 'physprofile'),
    ).toThrow(SsoTokenError);
  });

  // Token đúc cho ACADsoom không được dùng lại ở đây.
  it('aud của app anh em', () => {
    expect(() =>
      verifyPhysoomToken(
        sign({ ...BASE, aud: 'acadsoom' }),
        SECRET,
        'physprofile',
      ),
    ).toThrow(SsoTokenError);
  });

  it('sai định dạng', () => {
    expect(() => verifyPhysoomToken('khong-phai-jwt', SECRET)).toThrow(
      SsoTokenError,
    );
  });

  it('thiếu email', () => {
    const { email: _e, ...noEmail } = BASE;
    expect(() => verifyPhysoomToken(sign(noEmail), SECRET)).toThrow(
      SsoTokenError,
    );
  });

  // Quên đặt biến môi trường thì phải hỏng ồn ào, không được cho qua.
  it('chưa cấu hình chuỗi bí mật', () => {
    expect(() => verifyPhysoomToken(sign(BASE), '')).toThrow(SsoTokenError);
  });
});

describe('splitVietnameseName', () => {
  it('từ cuối là tên gọi', () => {
    expect(splitVietnameseName('Nguyễn Vương Thuỳ Ngân')).toEqual({
      firstName: 'Ngân',
      lastName: 'Nguyễn Vương Thuỳ',
    });
  });
  it('tên hai chữ', () => {
    expect(splitVietnameseName('Trần Bình')).toEqual({
      firstName: 'Bình',
      lastName: 'Trần',
    });
  });
  it('một chữ, hoặc rỗng', () => {
    expect(splitVietnameseName('Ngân')).toEqual({
      firstName: 'Ngân',
      lastName: '',
    });
    expect(splitVietnameseName('')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('laEmailSinhVien', () => {
  it('email sinh viên — kể cả viết hoa, dính khoảng trắng', () => {
    expect(laEmailSinhVien('25c3101514@student.hcmus.edu.vn')).toBe(true);
    expect(laEmailSinhVien('  25C3101514@Student.HCMUS.edu.vn ')).toBe(true);
  });
  it('email cán bộ và tên miền con khác không bị bắt nhầm', () => {
    expect(laEmailSinhVien('htyhong@hcmus.edu.vn')).toBe(false);
    expect(laEmailSinhVien('a@phys.hcmus.edu.vn')).toBe(false);
    expect(laEmailSinhVien('')).toBe(false);
    expect(laEmailSinhVien(null)).toBe(false);
  });
});
