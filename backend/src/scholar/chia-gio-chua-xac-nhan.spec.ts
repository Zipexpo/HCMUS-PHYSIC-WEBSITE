import { describe, expect, it, vi } from 'vitest';
import { ProjectService, chuNhiemThuocTruong } from './project.service';
import { ScholarService } from './scholar.service';

/**
 * Khoa chốt 4/10/2026: xác nhận hay chưa thì PHẦN của mỗi người vẫn phải giữ —
 * chỉ "không phải tôi" mới trả phần đó lại; người chưa bấm thì chính họ không
 * được tính giờ. Trước đó web Khoa chỉ đếm người đã xác nhận, nên một chủ nhiệm
 * hưởng trọn hai đề tài chỉ vì thành viên chưa vào bấm.
 */
type Dong = Record<string, unknown>;

describe('chuNhiemThuocTruong', () => {
  it('tài khoản Khoa: thuộc Trường, trừ khi chính dòng đó ghi cơ quan ngoài', () => {
    expect(chuNhiemThuocTruong({ userId: 'u1', affiliation: null })).toBe(true);
    expect(chuNhiemThuocTruong({ userId: 'u1', affiliation: 'double' })).toBe(true);
    expect(chuNhiemThuocTruong({ userId: 'u1', affiliation: 'non_school' })).toBe(false);
  });

  it('người ngoài hệ thống: chỉ khi ghi rõ Thuộc Trường / Đồng thời', () => {
    expect(chuNhiemThuocTruong({ userId: null, affiliation: null })).toBe(false);
    expect(chuNhiemThuocTruong({ userId: null, affiliation: 'school' })).toBe(true);
    expect(chuNhiemThuocTruong({ userId: null, affiliation: 'double' })).toBe(true);
    expect(chuNhiemThuocTruong({ userId: null, affiliation: 'vnu' })).toBe(false);
  });
});

function deTai(members: Dong[]) {
  const findMany = vi.fn().mockResolvedValue([
    {
      updatedAt: new Date(),
      role: 'MEMBER',
      sharePercent: null,
      claimStatus: 'CONFIRMED',
      user: { email: 'b@hcmus.edu.vn' },
      project: {
        id: 'p1',
        code: 'B2026-18-18',
        decisionNo: null,
        title: 'Đề tài thử',
        catalogCode: 'B2-1.4',
        funder: null,
        budget: BigInt(800000000),
        status: 'ONGOING',
        startYear: 2026,
        startMonth: 1,
        endYear: 2028,
        endMonth: 1,
        months: 24,
        finishedYear: null,
        finishedMonth: null,
        deletedAt: null,
        updatedAt: new Date(),
        members,
        evidences: [],
      },
    },
  ]);
  const svc = new ProjectService(
    { projectMember: { findMany } } as never,
    { emit: vi.fn() } as never,
    {} as never,
  );
  const dong = async () =>
    ((await svc.integrationList({} as never)) as { items: Dong[] }).items[0];
  return { findMany, dong };
}

describe('Đề tài — mẫu số chia giờ và chủ nhiệm thuộc Trường', () => {
  it('CSDL chỉ bỏ người đã từ chối — người chưa bấm vẫn được đếm', async () => {
    const { findMany, dong } = deTai([
      { id: 'm1', role: 'LEAD', userId: 'u1', affiliation: null },
      { id: 'm2', role: 'MEMBER', userId: 'u2', affiliation: 'school' },
    ]);
    const d = await dong();
    expect(
      findMany.mock.calls[0][0].include.project.include.members.where,
    ).toEqual({ claimStatus: { not: 'REJECTED' } });
    expect(d.memberCount).toBe(2);
    expect(d.leadAtSchool).toBe(true);
  });

  it('chủ nhiệm có tài khoản nhưng CHƯA bấm vẫn là chủ nhiệm thuộc Trường', async () => {
    // Dòng của chủ nhiệm chưa bấm không được gửi sang ACADsoom, nên chỉ có cờ
    // này nói cho bên kia biết đề tài có tác giả chính thuộc Trường.
    const { dong } = deTai([
      { id: 'm1', role: 'LEAD', userId: 'u1', affiliation: null },
      { id: 'm2', role: 'MEMBER', userId: 'u2', affiliation: null },
    ]);
    expect((await dong()).leadAtSchool).toBe(true);
  });

  it('chủ nhiệm ngoài hệ thống: ghi "Đồng thời…" → thuộc Trường; không ghi → không', async () => {
    const coGhi = deTai([
      { id: 'm1', role: 'LEAD', userId: null, affiliation: 'double' },
      { id: 'm2', role: 'MEMBER', userId: 'u2', affiliation: null },
    ]);
    expect((await coGhi.dong()).leadAtSchool).toBe(true);
    const khongGhi = deTai([
      { id: 'm1', role: 'LEAD', userId: null, affiliation: null },
      { id: 'm2', role: 'MEMBER', userId: 'u2', affiliation: null },
    ]);
    expect((await khongGhi.dong()).leadAtSchool).toBe(false);
  });
});

function congBo(authors: Dong[], authorsRaw: Dong[], mainAuthorAtSchool = false) {
  const findMany = vi.fn().mockResolvedValue([
    {
      updatedAt: new Date(),
      authorIndex: 2,
      isFirst: false,
      isCorresponding: false,
      isLast: false,
      sharePercent: null,
      claimStatus: 'CONFIRMED',
      user: { email: 'b@hcmus.edu.vn' },
      publication: {
        id: 'p1',
        updatedAt: new Date(),
        deletedAt: null,
        status: 'PUBLISHED',
        catalogCode: '1.1c',
        totalAuthors: 4,
        schoolAuthors: 2,
        mainAuthorAtSchool,
        externalMainAuthors: 1,
        authors,
        authorsRaw,
      },
    },
  ]);
  const svc = new ScholarService(
    { publicationAuthor: { findMany } } as never,
    {} as never,
    {} as never,
    { emit: vi.fn() } as never,
    {} as never,
  );
  const dong = async () =>
    ((await svc.integrationList({} as never)) as { items: Dong[] }).items[0];
  return { findMany, dong };
}

const raw4 = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
const toi = { claimStatus: 'CONFIRMED', authorIndex: 2, isFirst: false, isCorresponding: false, isLast: false };

describe('Công bố — tác giả chính có tài khoản chưa bấm xác nhận', () => {
  it('CSDL chỉ bỏ người đã từ chối', async () => {
    const { findMany, dong } = congBo([toi], raw4);
    await dong();
    expect(
      findMany.mock.calls[0][0].include.publication.include.authors.where,
    ).toEqual({ claimStatus: { not: 'REJECTED' } });
  });

  it('đã được chỉ hàng → giữ phần: vào mẫu số 1/3 và là tác giả chính thuộc Trường', async () => {
    const { dong } = congBo(
      [{ claimStatus: 'PENDING', authorIndex: 0, isFirst: true, isCorresponding: false, isLast: false }, toi],
      raw4,
    );
    const d = await dong();
    expect(d.mainAuthorsAtSchool).toBe(1);
    expect(d.mainAuthors).toBe(2); // + 1 tác giả chính ngoài hệ thống đã khai
    expect(d.mainAuthorAtSchool).toBe(true);
  });

  it('chưa chỉ hàng → KHÔNG đếm thêm (form đã tính hàng đó vào externalMainAuthors)', async () => {
    const { dong } = congBo(
      [{ claimStatus: 'PENDING', authorIndex: -1, isFirst: true, isCorresponding: false, isLast: false }, toi],
      raw4,
    );
    const d = await dong();
    expect(d.mainAuthors).toBe(1);
    expect(d.mainAuthorsAtSchool).toBe(0);
    expect(d.mainAuthorAtSchool).toBe(false);
  });

  it('hàng của người chưa bấm ghi địa chỉ ngoài Trường → vẫn là tác giả chính, nhưng không thuộc Trường', async () => {
    const { dong } = congBo(
      [{ claimStatus: 'PENDING', authorIndex: 3, isFirst: false, isCorresponding: false, isLast: true }, toi],
      [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D', isNonSchool: true }],
    );
    const d = await dong();
    expect(d.mainAuthors).toBe(2);
    expect(d.mainAuthorsAtSchool).toBe(0);
    expect(d.mainAuthorAtSchool).toBe(false);
  });
});
