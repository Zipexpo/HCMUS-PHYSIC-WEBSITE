import { describe, expect, it } from 'vitest';
import {
  hangCuaNguoi,
  hopVoiHoTen,
  khopHoTen,
  looselyMatches,
  matchAuthors,
  normalizeName,
  suggestNameVariants,
  type CandidateProfile,
} from './name-match';

describe('normalizeName', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(normalizeName('Nguyễn Vương Thuỳ Ngân')).toBe(
      'nguyen vuong thuy ngan',
    );
    expect(normalizeName('Đặng Văn Liệt')).toBe('dang van liet');
  });
  it('bỏ dấu câu và gom khoảng trắng', () => {
    expect(normalizeName('  Ngan  V. T.  Nguyen ')).toBe('ngan v t nguyen');
    expect(normalizeName('Thuy-Ngan V. Nguyen')).toBe('thuy ngan v nguyen');
  });
  it('chịu được đầu vào rỗng', () => {
    expect(normalizeName('')).toBe('');
  });
});

describe('looselyMatches (luật cũ, chỉ để xếp hạng)', () => {
  it('khớp các dạng viết khác nhau của cùng một người', () => {
    expect(looselyMatches('Nguyen Vuong Thuy Ngan', 'Ngan V. T. Nguyen')).toBe(
      true,
    );
  });
  it('không khớp khi khác bộ chữ cái đầu', () => {
    expect(looselyMatches('Nguyen Vuong Thuy Ngan', 'Tran Binh')).toBe(false);
  });
});

describe('khopHoTen — so với họ tên thật', () => {
  it('đủ họ tên, mọi thứ tự, viết tắt tên đệm', () => {
    expect(khopHoTen('Nguyen Vuong Thuy Ngan', 'Nguyễn Vương Thuỳ Ngân')).toBe('du');
    expect(khopHoTen('Thuy-Ngan V. Nguyen', 'Nguyễn Vương Thuỳ Ngân')).toBe('du');
    expect(khopHoTen('Ngan V. T. Nguyen', 'Nguyễn Vương Thuỳ Ngân')).toBe('du');
    expect(khopHoTen('Khang Van Tran', 'Trần Văn Khang')).toBe('du');
  });
  it('thiếu tên đệm → một phần', () => {
    expect(khopHoTen('Khang Tran', 'Trần Văn Khang')).toBe('mot-phan');
    expect(khopHoTen('Tran Phuong Hoa', 'Trần Thị Phương Hoa')).toBe('mot-phan');
  });
  it('tên riêng chỉ có chữ cái đầu → viết tắt (mơ hồ)', () => {
    expect(khopHoTen('N. V. T. Nguyen', 'Nguyễn Vương Thuỳ Ngân')).toBe('viet-tat');
    expect(khopHoTen('K. Tran', 'Trần Văn Khang')).toBeNull();
  });
  it('CA THẬT: HỌ chỉ có chữ cái đầu cũng mơ hồ — "H. N. Long" là Hoàng Ngọc Long', () => {
    // OpenAlex viết tắt tác giả "Hoang Ngoc Long" (ORCID khác) thành "H. N. Long".
    expect(khopHoTen('H. N. Long', 'Nguyễn Hoàng Long')).toBe('viet-tat');
    expect(khopHoTen('Hoang Ngoc Long', 'Nguyễn Hoàng Long')).toBeNull();
    // Nhóm cộng tác lớn in "T. Loan" — có thể là Trương Thị Hồng Loan: "có thể", không phải "không".
    expect(khopHoTen('T. Loan', 'Trương Thị Hồng Loan')).toBe('viet-tat');
    expect(khopHoTen('T. Lan', 'Trương Thị Hồng Loan')).toBeNull();
    expect(
      matchAuthors([{ name: 'H. N. Long' }], [
        { userId: 'u-long', orcid: null, normalizedVariants: [], displayName: 'Nguyễn Hoàng Long' },
      ])[0].chac,
    ).toBe(false);
  });
  it('CA THẬT: có một từ đầy đủ khác là KHÔNG phải (luật cũ khớp nhầm)', () => {
    // Cùng bộ chữ cái đầu + chung "tran"/"van" — luật cũ gửi lời mời nhầm.
    expect(looselyMatches('Tran Van Khanh', 'Trần Văn Khang')).toBe(true);
    expect(khopHoTen('Tran Van Khanh', 'Trần Văn Khang')).toBeNull();
    expect(looselyMatches('Thi Huong Le', 'Lê Thị Hiên')).toBe(true);
    expect(khopHoTen('Thi Huong Le', 'Lê Thị Hiên')).toBeNull();
    expect(khopHoTen('Hoang Tung Le', 'Lê Thị Hiên')).toBeNull();
  });
  it('thiếu họ hoặc thiếu tên riêng → không', () => {
    expect(khopHoTen('Van Khang', 'Trần Văn Khang')).toBeNull();
    expect(khopHoTen('Tran Van', 'Trần Văn Khang')).toBeNull();
  });
});

describe('hopVoiHoTen — dạng tên sắp lưu có phải của người này', () => {
  it('nhận mọi dạng viết tắt của chính mình', () => {
    expect(hopVoiHoTen('H. T. Y. Pham', 'Phạm Thị Yến Hồng')).toBe(true);
    expect(hopVoiHoTen('Hong Pham', 'Phạm Thị Yến Hồng')).toBe(true);
  });
  it('CA THẬT: tên của người khác (bấm nhầm hàng) thì không', () => {
    expect(hopVoiHoTen('Kieu T. Thi Huynh', 'Đặng Trường An')).toBe(false);
  });
});

const NGAN: CandidateProfile = {
  userId: 'u-ngan',
  orcid: '0000-0002-1825-0097',
  normalizedVariants: ['nguyen vuong thuy ngan', 'ngan v t nguyen'],
  displayName: 'Nguyễn Vương Thuỳ Ngân',
};
const NGAN2: CandidateProfile = {
  userId: 'u-ngan2',
  orcid: null,
  normalizedVariants: [],
  displayName: 'Nguyễn Nhật Kim Ngân',
};
const BINH: CandidateProfile = {
  userId: 'u-binh',
  orcid: null,
  normalizedVariants: ['tran binh'],
  displayName: 'Trần Bình',
};
const KHANG: CandidateProfile = {
  userId: 'u-khang',
  orcid: '0000-0001-0000-0001',
  normalizedVariants: [],
  displayName: 'Trần Văn Khang',
};

describe('matchAuthors', () => {
  it('ORCID trùng thì khớp chắc chắn, kể cả khi tên viết lạ', () => {
    const out = matchAuthors(
      [
        { family: 'Lee', given: 'Jun' },
        {
          family: 'X',
          given: 'Y',
          orcid: 'https://orcid.org/0000-0002-1825-0097',
        },
      ],
      [NGAN, BINH],
    );
    expect(out).toEqual([
      { authorIndex: 1, userId: 'u-ngan', reason: 'orcid', chac: true },
    ]);
  });

  it('khớp theo dạng tên đã đăng ký', () => {
    const out = matchAuthors(
      [
        { family: 'Nguyen', given: 'Ngan V. T.' },
        { family: 'Lee', given: 'Jun' },
      ],
      [NGAN],
    );
    expect(out).toEqual([
      { authorIndex: 0, userId: 'u-ngan', reason: 'variant', chac: true },
    ]);
  });

  it('chỉ có chữ cái đầu của tên riêng → GỢI Ý, không gắn sẵn', () => {
    const out = matchAuthors([{ family: 'Nguyen', given: 'N. V. T.' }], [NGAN]);
    expect(out).toEqual([
      { authorIndex: 0, userId: 'u-ngan', reason: 'loose', chac: false },
    ]);
  });

  it('một hàng khớp hai người ngang nhau → không ai chắc', () => {
    const out = matchAuthors([{ family: 'Nguyen', given: 'Ngan' }], [NGAN, NGAN2]);
    expect(out.map((m) => [m.userId, m.chac])).toEqual([
      ['u-ngan', false],
      ['u-ngan2', false],
    ]);
  });

  it('tên ngắn "Khang Tran" chỉ là gợi ý; "Khang V. Tran" thì chắc', () => {
    expect(matchAuthors([{ family: 'Tran', given: 'Khang' }], [KHANG])[0].chac).toBe(false);
    expect(matchAuthors([{ family: 'Tran', given: 'Khang V.' }], [KHANG])[0].chac).toBe(true);
  });

  it('CA THẬT: tên na ná của người khác không còn thành lời mời', () => {
    expect(matchAuthors([{ family: 'Tran', given: 'Van Khanh' }], [KHANG])).toEqual([]);
  });

  it('ORCID khác vẫn khớp theo tên (nhiều người có 2 ORCID) nhưng có ghi chú', () => {
    const out = matchAuthors(
      [{ family: 'Tran', given: 'Khang Van', orcid: '0000-0009-9999-9999' }],
      [KHANG],
    );
    expect(out).toEqual([
      { authorIndex: 0, userId: 'u-khang', reason: 'loose', chac: true, orcidKhac: true },
    ]);
  });

  it('mỗi người chỉ CHẮC ở một hàng; bằng chứng mạnh hơn thắng', () => {
    const out = matchAuthors(
      [
        { family: 'Nguyen', given: 'Ngan Vuong Thuy' },
        { family: 'Nguyen', given: 'Ngan', orcid: '0000-0002-1825-0097' },
      ],
      [NGAN],
    );
    expect(out.filter((m) => m.chac)).toEqual([
      { authorIndex: 1, userId: 'u-ngan', reason: 'orcid', chac: true },
    ]);
  });

  it('không khớp ai thì trả mảng rỗng, không đoán bừa', () => {
    expect(
      matchAuthors([{ family: 'Smith', given: 'John' }], [NGAN, BINH]),
    ).toEqual([]);
  });
});

describe('hangCuaNguoi', () => {
  it('chọn hàng chắc của người được hỏi', () => {
    expect(
      hangCuaNguoi(
        [{ name: 'Lee Jun' }, { name: 'Khang V. Tran' }, { name: 'Tran Khang' }],
        KHANG,
      ),
    ).toEqual({ authorIndex: 1, chac: true });
  });
  it('không hàng nào giống thì null', () => {
    expect(hangCuaNguoi([{ name: 'Lee Jun' }], KHANG)).toBeNull();
  });
});

describe('suggestNameVariants', () => {
  it('sinh các dạng hay dùng khi đăng báo', () => {
    const out = suggestNameVariants('Nguyễn Vương Thuỳ Ngân');
    expect(out).toContain('Nguyen Vuong Thuy Ngan');
    expect(out).toContain('Ngan V. T. Nguyen');
    expect(out).toContain('N. V. T. Nguyen');
    expect(new Set(out).size).toBe(out.length); // không trùng lặp
  });
  it('tên một chữ thì không gợi ý gì', () => {
    expect(suggestNameVariants('Ngan')).toEqual([]);
  });
});
