import { toSlug } from '../shared/helpers';

/**
 * Dựng SẴN một trang nhân sự cá nhân cho người mới — phần THUẦN (không đụng DB).
 *
 * Trang nhân sự công khai (khối `DepartmentStaffAuto`) chỉ gom người TỪ các trang
 * cá nhân `{bộ-môn}/nhan-su/…` đã xuất bản; có tài khoản thôi thì KHÔNG lên danh
 * sách. Nút "Tạo cán bộ" chỉ tạo tài khoản, nên người mới biến mất khỏi trang cho
 * tới khi có ai dựng trang tay. Ở đây ta dựng trang đó tự động bằng cách NHÂN BẢN
 * cây Puck của một đồng nghiệp (giữ Header/Footer/nhãn mục đúng của bộ môn) rồi
 * ghi đè đúng các ô ĐỊNH DANH, xoá sạch nội dung cá nhân của người mẫu.
 *
 * Tách riêng phần thuần này để test được và để backfill dùng chung.
 */

/** Học vị hiển thị (khớp bảng trong staff-page.service, giữ đồng nhất VI/EN). */
const DEGREE_PREFIX_VI: Record<string, string> = {
  gs: 'GS.TS.',
  pgs: 'PGS.TS.',
  ts: 'TS.',
  ths: 'ThS.',
  cn: 'CN.',
  ks: 'KS.',
};

/** Khoá học vị từ `User.degree` (GS·PGS·TS·ThS·CN·KS) → gs/pgs/ts/ths/cn/ks. */
export const degreeKey = (d?: string | null): string => {
  const k = (d ?? '').toLowerCase().replace(/[.\s]/g, '');
  return k in DEGREE_PREFIX_VI ? k : '';
};

/**
 * Slug trang cá nhân: `{bộ-môn}/nhan-su/{học-vị}-{tên}`. Ví dụ CN. Ngô Huỳnh Du ở
 * Văn phòng Khoa → `van-phong-khoa/nhan-su/cn-ngo-huynh-du`. Không có học vị thì
 * bỏ tiền tố. Đây là slug GỐC; nơi gọi lo chuyện trùng (thêm hậu tố).
 */
export function staffSlugFor(
  deptSlug: string,
  degree: string | null | undefined,
  fullName: string,
): string {
  const dept = String(deptSlug || '').replace(/^\/+|\/+$/g, '');
  const dk = degreeKey(degree);
  const nameSlug = toSlug(fullName);
  const prefix = dk ? `${dk}-` : '';
  return `${dept}/nhan-su/${prefix}${nameSlug}`;
}

type PuckNode = { type?: string; props?: Record<string, unknown> };
const STAFF_TYPES = ['StaffProfileEditorial', 'StaffProfile'];

/** Đếm số khối hồ sơ trong một cây Puck (đệ quy qua mọi mảng/props). */
export function countStaffNodes(root: unknown): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const node = x as PuckNode;
    if (node.type && STAFF_TYPES.includes(node.type)) {
      n += 1;
      return; // khối hồ sơ không lồng trong khối hồ sơ
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v);
  };
  walk(root);
  return n;
}

export type ScaffoldPerson = {
  fullName: string;
  email: string;
  degree?: string | null;
};

/**
 * Từ cây MẪU của một đồng nghiệp, dựng cây MỚI cho `person`:
 *  · nhân bản sâu (không đụng cây mẫu),
 *  · tìm ĐÚNG một khối hồ sơ rồi ghi đè các ô định danh (tên, email…) và XOÁ hết
 *    nội dung cá nhân của người mẫu (bài báo, nghiên cứu, giảng dạy, tiểu sử…),
 *  · giữ nguyên Header/Footer + các nhãn mục ("Xuất bản khoa học"…).
 *
 * Trả `null` nếu cây mẫu không có đúng MỘT khối hồ sơ — không an toàn để nhân bản.
 */
export function scaffoldStaffTree(
  template: unknown,
  person: ScaffoldPerson,
): unknown | null {
  if (!template || typeof template !== 'object') return null;
  if (countStaffNodes(template) !== 1) return null;

  const tree = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
  const dk = degreeKey(person.degree);
  const prefixVi = DEGREE_PREFIX_VI[dk] ?? '';
  const displayName =
    `${prefixVi ? `${prefixVi} ` : ''}${person.fullName}`.trim();
  const nameSlug = toSlug(person.fullName);

  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const node = x as PuckNode;
    if (node.type && STAFF_TYPES.includes(node.type)) {
      const p = (node.props ??= {});
      // Định danh — tên gộp học vị theo đúng cách các trang khác đang dùng (ô
      // `name` mang cả "CN. …", `eyebrow` để trống); trang danh sách vẫn tự tách
      // học vị ra `eyebrow` khi hiển thị.
      p.id = `body-${nameSlug}`;
      p.name = { vi: displayName, en: '' };
      p.nameLines = [];
      p.eyebrow = { vi: '', en: '' };
      p.email = person.email;
      p.photo = '';
      // Nội dung cá nhân — xoá sạch để không rớt dữ liệu của người mẫu.
      p.intro = { vi: '', en: '' };
      p.html = { vi: '', en: '' };
      p.extras = [];
      p.projects = [];
      p.research = [];
      p.teaching = [];
      p.publications = [];
      return;
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v);
  };
  walk(tree.content ?? tree);

  // Tiêu đề thẻ trình duyệt (SEO) — khỏi mang tên người mẫu.
  const root = tree.root;
  if (root && typeof root === 'object') {
    const r = root as { props?: Record<string, unknown> };
    r.props = { ...(r.props ?? {}), title: person.fullName };
  }
  return tree;
}
