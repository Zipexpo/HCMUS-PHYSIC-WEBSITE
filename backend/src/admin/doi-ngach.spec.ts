/**
 * Luật: đổi ngạch PHẢI có lý do + ngày hiệu lực.
 *
 * Ngạch quyết định mẫu phiếu và bộ tiêu chí chấm bên ACADsoom, nên đổi ngạch
 * sau khi người ta đã ký làm tờ in ra khác tờ đã ký. Bắt khai ngay lúc đổi, vì
 * sau đó không ai dựng lại được "đổi lúc nào, vì sao".
 *
 * Bản sao thuần của phần quyết định trong AdminService.updateProfile — kiểm
 * được luật mà không cần CSDL.
 */
import { describe, expect, it } from 'vitest';

const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : v) || null;

type Body = {
  rank?: string | null;
  rankReason?: string;
  rankEffectiveFrom?: Date;
};

/** Trả về: có phải ghi nhật ký không, và có bị chặn vì thiếu khai không. */
function xet(current: string | null, body: Body) {
  const nextRank = body.rank !== undefined ? norm(body.rank) : undefined;
  const changed =
    nextRank !== undefined &&
    String(nextRank ?? '').toLowerCase() !==
      String(norm(current) ?? '').toLowerCase();
  const thieuKhai =
    changed && (!body.rankReason || !body.rankEffectiveFrom);
  return { changed, thieuKhai };
}

const NGAY = new Date('2026-12-01');
const DU = { rankReason: 'Chuyển vị trí việc làm', rankEffectiveFrom: NGAY };

describe('đổi ngạch', () => {
  it('đổi CV -> KTV mà thiếu khai thì bị chặn', () => {
    expect(xet('CV', { rank: 'KTV' })).toEqual({ changed: true, thieuKhai: true });
  });

  it('đổi CV -> KTV có đủ lý do + ngày thì cho qua và ghi nhật ký', () => {
    expect(xet('CV', { rank: 'KTV', ...DU })).toEqual({
      changed: true,
      thieuKhai: false,
    });
  });

  it('thiếu riêng ngày hiệu lực vẫn bị chặn', () => {
    expect(xet('CV', { rank: 'KTV', rankReason: 'x' }).thieuKhai).toBe(true);
  });

  it('thiếu riêng lý do vẫn bị chặn', () => {
    expect(xet('CV', { rank: 'KTV', rankEffectiveFrom: NGAY }).thieuKhai).toBe(true);
  });

  it('KHÔNG gửi rank thì không phải khai gì — sửa học vị, đơn vị…', () => {
    expect(xet('CV', {})).toEqual({ changed: false, thieuKhai: false });
  });

  it('gửi đúng ngạch cũ thì không tính là đổi', () => {
    expect(xet('CV', { rank: 'CV' })).toEqual({ changed: false, thieuKhai: false });
  });

  // Bẫy: chỉ khác hoa thường mà bắt khai lý do thì người dùng bực, còn ghi vào
  // nhật ký thì thành rác.
  it('chỉ khác hoa thường thì không tính là đổi', () => {
    expect(xet('CV', { rank: 'cv' }).changed).toBe(false);
    expect(xet('KTV', { rank: ' ktv ' }).changed).toBe(false);
  });

  it('từ chưa có ngạch sang có ngạch LÀ đổi, phải khai', () => {
    expect(xet(null, { rank: 'KTV' })).toEqual({ changed: true, thieuKhai: true });
  });

  it('xoá trắng ngạch cũng là đổi, phải khai', () => {
    expect(xet('CV', { rank: null })).toEqual({ changed: true, thieuKhai: true });
  });

  it('khoảng trắng thừa không làm thành một lần đổi', () => {
    expect(xet('  CV  ', { rank: 'CV' }).changed).toBe(false);
  });
});
