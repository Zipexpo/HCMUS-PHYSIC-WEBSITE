import { describe, expect, it } from 'vitest';
import {
  countStaffNodes,
  degreeKey,
  scaffoldStaffTree,
  staffSlugFor,
} from './staff-scaffold';

const template = () => ({
  root: { props: { title: 'CN. Người Mẫu' } },
  zones: {},
  content: [
    { type: 'Header', props: { id: 'h1' } },
    {
      type: 'StaffProfileEditorial',
      props: {
        id: 'body-nguoi-mau',
        name: { vi: 'CN. Người Mẫu', en: '' },
        email: 'old@hcmus.edu.vn',
        intro: { vi: 'Tiểu sử cũ', en: 'old bio' },
        photo: '/old.jpg',
        publications: [{ year: '2020' }],
        research: [{ title: {} }],
        teaching: [{ title: {} }],
        extras: [{ section: {} }],
        projects: [{ title: {} }],
        nameLines: [{ text: { vi: 'x' } }],
        html: { vi: '<p>cũ</p>', en: '' },
        eyebrow: { vi: 'x', en: '' },
        pubsTitle: { vi: 'Xuất bản khoa học', en: 'Publications' },
        heroLayout: 'compact',
        photoFilter: true,
      },
    },
    { type: 'Footer', props: { id: 'f1' } },
  ],
});

const staffProps = (tree: unknown) =>
  (tree as { content: Array<{ type: string; props: Record<string, unknown> }> })
    .content[1].props;

describe('degreeKey', () => {
  it('chuẩn hoá học vị bẩn về khoá sạch', () => {
    expect(degreeKey('CN')).toBe('cn');
    expect(degreeKey('ThS.')).toBe('ths');
    expect(degreeKey(' PGS ')).toBe('pgs');
    expect(degreeKey(null)).toBe('');
    expect(degreeKey('Tiến sĩ')).toBe(''); // chỉ nhận khoá chuẩn, không đoán chữ
  });
});

describe('staffSlugFor', () => {
  it('ghép {bộ-môn}/nhan-su/{học-vị}-{tên}', () => {
    expect(staffSlugFor('van-phong-khoa', 'CN', 'Ngô Huỳnh Du')).toBe(
      'van-phong-khoa/nhan-su/cn-ngo-huynh-du',
    );
  });
  it('không có học vị thì bỏ tiền tố', () => {
    expect(staffSlugFor('vat-ly-tin-hoc', null, 'Trần Văn A')).toBe(
      'vat-ly-tin-hoc/nhan-su/tran-van-a',
    );
  });
  it('gọt dấu / thừa ở slug bộ môn', () => {
    expect(staffSlugFor('/van-phong-khoa/', 'ThS', 'Lê Thị B')).toBe(
      'van-phong-khoa/nhan-su/ths-le-thi-b',
    );
  });
});

describe('countStaffNodes', () => {
  it('đếm đúng số khối hồ sơ', () => {
    expect(countStaffNodes(template())).toBe(1);
    expect(countStaffNodes({ content: [] })).toBe(0);
    expect(
      countStaffNodes({
        content: [
          { type: 'StaffProfileEditorial', props: {} },
          { type: 'StaffProfile', props: {} },
        ],
      }),
    ).toBe(2);
  });
});

describe('scaffoldStaffTree', () => {
  const person = {
    fullName: 'Ngô Huỳnh Du',
    email: 'nghdu@hcmus.edu.vn',
    degree: 'CN',
  };

  it('ghi đè định danh, xoá sạch nội dung cá nhân, giữ nhãn mục', () => {
    const out = scaffoldStaffTree(template(), person)!;
    const p = staffProps(out);
    expect(p.name).toEqual({ vi: 'CN. Ngô Huỳnh Du', en: '' });
    expect(p.email).toBe('nghdu@hcmus.edu.vn');
    expect(p.id).toBe('body-ngo-huynh-du');
    expect(p.photo).toBe('');
    expect(p.intro).toEqual({ vi: '', en: '' });
    expect(p.html).toEqual({ vi: '', en: '' });
    expect(p.eyebrow).toEqual({ vi: '', en: '' });
    expect(p.nameLines).toEqual([]);
    expect(p.publications).toEqual([]);
    expect(p.research).toEqual([]);
    expect(p.teaching).toEqual([]);
    expect(p.extras).toEqual([]);
    expect(p.projects).toEqual([]);
    // Nhãn mục + bố cục giữ nguyên.
    expect(p.pubsTitle).toEqual({
      vi: 'Xuất bản khoa học',
      en: 'Publications',
    });
    expect(p.heroLayout).toBe('compact');
    expect(p.photoFilter).toBe(true);
  });

  it('giữ Header/Footer và đổi tiêu đề tab', () => {
    const out = scaffoldStaffTree(template(), person) as {
      root: { props: Record<string, unknown> };
      content: Array<{ type: string; props: Record<string, unknown> }>;
    };
    expect(out.content[0]).toEqual({ type: 'Header', props: { id: 'h1' } });
    expect(out.content[2]).toEqual({ type: 'Footer', props: { id: 'f1' } });
    expect(out.root.props.title).toBe('Ngô Huỳnh Du');
  });

  it('không đụng cây mẫu (clone sâu)', () => {
    const src = template();
    scaffoldStaffTree(src, person);
    expect(src.content[1].props.email).toBe('old@hcmus.edu.vn');
    expect(src.content[1].props.publications).toEqual([{ year: '2020' }]);
  });

  it('không có học vị → tên không tiền tố', () => {
    const out = scaffoldStaffTree(template(), {
      fullName: 'Trần Văn A',
      email: 'tva@hcmus.edu.vn',
      degree: null,
    })!;
    expect(staffProps(out).name).toEqual({ vi: 'Trần Văn A', en: '' });
  });

  it('trả null nếu cây mẫu không có đúng một khối hồ sơ', () => {
    expect(scaffoldStaffTree({ content: [] }, person)).toBeNull();
    expect(
      scaffoldStaffTree(
        {
          content: [
            { type: 'StaffProfileEditorial', props: {} },
            { type: 'StaffProfileEditorial', props: {} },
          ],
        },
        person,
      ),
    ).toBeNull();
    expect(scaffoldStaffTree(null, person)).toBeNull();
  });
});
