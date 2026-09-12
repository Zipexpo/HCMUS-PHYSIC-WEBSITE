const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      window.location.href = "/login";
      throw new Error("Session expired");
    }
    if (res.status === 429) {
      // Rate limited (e.g. too many login attempts) — friendly message.
      const retry = Number(res.headers.get("Retry-After"));
      throw new Error(
        retry > 0
          ? `Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ${retry} giây.`
          : "Bạn thao tác quá nhiều lần. Vui lòng đợi một lát rồi thử lại.",
      );
    }
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw error;
  }
  return res.json();
}

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>(path, {
    ...options,
    headers: { ...authHeaders(), ...options?.headers },
  });
}

export type UserProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  phone: string | null;
  position: string | null;
  bio: string | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  tourCompletedAt: string | null;
  starredLayoutIds: string[];
  starredWidgetIds: string[];
  createdAt: string;
  updatedAt: string;
};

export const authApi = {
  getProfile() {
    return authFetch<UserProfile>("/auth/profile");
  },
  completeTour() {
    return authFetch<UserProfile>("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify({ tourCompletedAt: new Date().toISOString() }),
    });
  },
  setStarred(body: { layoutIds?: string[]; widgetIds?: string[] }) {
    return authFetch<{
      starredLayoutIds: string[];
      starredWidgetIds: string[];
    }>("/auth/starred", { method: "PUT", body: JSON.stringify(body) });
  },
  login(body: { email: string; password: string }) {
    return apiFetch<{ accessToken: string; refreshToken: string }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  sendOTP(body: { email: string; type: "FORGOT_PASSWORD" }) {
    return apiFetch<{ message: string }>("/auth/otp", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  verifyOTP(body: { email: string; code: string; type: "FORGOT_PASSWORD" }) {
    return apiFetch<{ message: string }>("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  forgotPassword(body: {
    email: string;
    code: string;
    newPassword: string;
    confirmNewPassword: string;
  }) {
    return apiFetch<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  googleLink() {
    return apiFetch<{ url: string }>("/auth/google-link");
  },
  updateProfile(body: {
    firstName?: string;
    lastName?: string;
    avatarUrl?: string | null;
    position?: string | null;
    departmentName?: string | null;
    phone?: string | null;
  }) {
    return authFetch<UserProfile>("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  changePassword(body: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }) {
    return authFetch<{ message: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  createAdmin(body: {
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
    phone?: string;
    position?: string;
    bio?: string;
    departmentId?: string;
    newDepartmentName?: string;
    avatarUrl?: string;
  }) {
    return authFetch<UserProfile>("/auth/create-admin", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};

export type AdminListItem = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  position: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "LECTURER";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  department: { id: string; name: string } | null;
  // Hồ sơ tài khoản (Mục 10) — web Khoa làm chủ.
  physoomId: string | null;
  teacherId: string | null;
  degree: string | null;
  rank: string | null;
  positionKey: string | null;
  positionFrom: string | null;
  positionTo: string | null;
  employmentType: string | null;
};

export type StaffUnit = { id: string; name: string };

export type StaffProfileUpdate = {
  rank?: string | null;
  positionKey?: string | null;
  positionFrom?: string | null;
  positionTo?: string | null;
  degree?: string | null;
  teacherId?: string | null;
  employmentType?: string | null;
  departmentId?: string | null;
};

// Tạo cán bộ (giảng viên, role LECTURER) — KHÔNG có mật khẩu. `name` là họ tên
// tiếng Việt đầy đủ, backend tự tách họ/tên.
export type StaffCreate = {
  name: string;
  email: string;
  teacherId?: string | null;
  rank?: string | null;
  positionKey?: string | null;
  degree?: string | null;
  employmentType?: string | null;
  departmentId?: string | null;
  positionFrom?: string | null;
  positionTo?: string | null;
};

export type HeroBackground = {
  id: string;
  url: string;
  name: string | null;
  sortOrder: number;
};

export const adminApi = {
  list(params: { page?: number; pageSize?: number } = {}) {
    return authFetch<{
      items: AdminListItem[];
      total: number;
      activeNow: number;
      page: number;
      pageSize: number;
      units: StaffUnit[];
    }>(`/admins${buildQuery(params)}`);
  },
  listStaff(params: { page?: number; pageSize?: number; search?: string } = {}) {
    return authFetch<{
      items: AdminListItem[];
      total: number;
      activeNow: number;
      page: number;
      pageSize: number;
      units: StaffUnit[];
    }>(`/admins/staff${buildQuery(params)}`);
  },
  createStaff(body: StaffCreate) {
    return authFetch<AdminListItem>(`/admins/staff`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  // ── Thư viện ảnh nền hero ────────────────────────────────────────────────
  listHeroBackgrounds() {
    return authFetch<HeroBackground[]>(`/admins/hero-backgrounds`);
  },
  addHeroBackground(body: { url: string; name?: string }) {
    return authFetch<HeroBackground>(`/admins/hero-backgrounds`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  removeHeroBackground(id: string) {
    return authFetch<{ message: string }>(`/admins/hero-backgrounds/${id}`, {
      method: "DELETE",
    });
  },
  suspend(id: string) {
    return authFetch<{ message: string }>(`/admins/${id}/suspend`, {
      method: "PATCH",
    });
  },
  restore(id: string) {
    return authFetch<{ message: string }>(`/admins/${id}/restore`, {
      method: "PATCH",
    });
  },
  resetPassword(id: string, password: string) {
    return authFetch<{ message: string }>(`/admins/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },
  updateProfile(id: string, body: StaffProfileUpdate) {
    return authFetch<AdminListItem>(`/admins/${id}/profile`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
};

export type DepartmentKind = "department" | "unit";
export type Department = {
  id: string;
  name: string;
  slug: string;
  kind: DepartmentKind;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export const departmentApi = {
  list() {
    return authFetch<Department[]>("/departments");
  },
  create(body: { name: string; description?: string; kind?: DepartmentKind }) {
    return authFetch<Department>("/departments", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  update(
    id: string,
    body: {
      name?: string;
      slug?: string;
      description?: string;
      kind?: DepartmentKind;
    },
  ) {
    return authFetch<Department>(`/departments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  merge(id: string, targetId: string) {
    return authFetch<Department>(`/departments/${id}/merge`, {
      method: "POST",
      body: JSON.stringify({ targetId }),
    });
  },
};

export type WidgetType = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  usage: string | null;
  category: string;
  icon: string | null;
  configSchema: Record<string, any>;
  defaultConfig: Record<string, any>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WidgetInstance = {
  id: string;
  widgetId: string;
  pageLayoutId: string;
  config: Record<string, any>;
  order: number;
  row: number;
  colSpan: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  widget?: Pick<
    WidgetType,
    "id" | "type" | "name" | "icon" | "configSchema" | "defaultConfig"
  >;
};

export type PageLayout = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  puckData: any | null;
  publishedPuckData: any | null;
  isPublished: boolean;
  publishedAt: string | null;
  scheduledAt: string | null;
  createdBy: string;
  departmentId: string | null;
  categoryId?: string | null;
  // Được đánh dấu làm mẫu tạo bài mới (thay cho luật suy đoán cũ).
  isPostTemplate?: boolean;
  // Chỉ người tạo (và super admin) thấy/dùng được layout này.
  isPrivate?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  widgets?: WidgetInstance[];
  // Ảnh bìa của bài viết nguồn (nếu layout gắn với một bài) — dùng cho og:image.
  sourcePost?: { coverUrl: string | null; coverAlt: string | null } | null;
};

export const widgetApi = {
  list(params?: { category?: string; isActive?: string }) {
    return apiFetch<WidgetType[]>(`/widgets${buildQuery(params ?? {})}`);
  },
  getById(id: string) {
    return apiFetch<WidgetType>(`/widgets/${id}`);
  },
  create(body: Partial<WidgetType>) {
    return authFetch<WidgetType>("/widgets", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  update(id: string, body: Partial<WidgetType>) {
    return authFetch<WidgetType>(`/widgets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  remove(id: string) {
    return authFetch<WidgetType>(`/widgets/${id}`, { method: "DELETE" });
  },
};

export type PostTemplateLayout = PageLayout & {
  categoryId: string | null;
  category?: { slug: string; name: { vi: string; en?: string } } | null;
  /** Các khối holder có trong bố cục (PostGallery, PostVideo…). Trình soạn bài
   *  dựa vào đây để hiện đúng ô nhập — bố cục không có holder thì không hỏi. */
  holders?: string[];
};

export const pageLayoutApi = {
  list(deleted?: boolean) {
    return authFetch<PageLayout[]>(
      `/page-layouts${deleted ? "?deleted=true" : ""}`,
    );
  },
  // Category-tagged "post template" layouts only — scopes the composer picker
  // instead of loading all ~1600 layouts. Optionally narrowed to one category.
  postTemplates(categorySlug?: string) {
    const qs = categorySlug
      ? `?category=${encodeURIComponent(categorySlug)}`
      : "";
    return authFetch<PostTemplateLayout[]>(`/page-layouts/post-templates${qs}`);
  },
  getById(id: string) {
    return authFetch<PageLayout>(`/page-layouts/${id}`);
  },
  getBySlug(slug: string) {
    return apiFetch<PageLayout>(`/page-layouts/slug/${slug}`);
  },
  create(body: { name: string; slug: string; description?: string }) {
    return authFetch<PageLayout>("/page-layouts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  update(id: string, body: Partial<PageLayout>) {
    return authFetch<PageLayout>(`/page-layouts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  remove(id: string) {
    return authFetch<{ message: string }>(`/page-layouts/${id}`, {
      method: "DELETE",
    });
  },
  restore(id: string) {
    return authFetch<{ message: string }>(`/page-layouts/${id}/restore`, {
      method: "POST",
    });
  },
  publish(id: string) {
    return authFetch<PageLayout>(`/page-layouts/${id}/publish`, {
      method: "POST",
    });
  },
  schedulePublish(id: string, scheduledAt: string, alsoScheduleIds?: string[]) {
    return authFetch<PageLayout>(`/page-layouts/${id}/schedule-publish`, {
      method: "POST",
      body: JSON.stringify({ scheduledAt, alsoScheduleIds }),
    });
  },
  unpublish(id: string) {
    return authFetch<PageLayout>(`/page-layouts/${id}/unpublish`, {
      method: "POST",
    });
  },
  duplicate(id: string, name?: string) {
    return authFetch<PageLayout>(`/page-layouts/${id}/duplicate`, {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    });
  },
  addWidget(
    layoutId: string,
    body: {
      widgetId: string;
      config?: Record<string, any>;
      order: number;
      row?: number;
      colSpan?: number;
    },
  ) {
    return authFetch<WidgetInstance>(`/page-layouts/${layoutId}/widgets`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  updateWidget(
    layoutId: string,
    instanceId: string,
    body: {
      config?: Record<string, any>;
      order?: number;
      row?: number;
      colSpan?: number;
      isVisible?: boolean;
    },
  ) {
    return authFetch<WidgetInstance>(
      `/page-layouts/${layoutId}/widgets/${instanceId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },
  removeWidget(layoutId: string, instanceId: string) {
    return authFetch<{ message: string }>(
      `/page-layouts/${layoutId}/widgets/${instanceId}`,
      { method: "DELETE" },
    );
  },
  reorderWidgets(layoutId: string, orderedInstanceIds: string[]) {
    return authFetch<PageLayout>(`/page-layouts/${layoutId}/widgets/reorder`, {
      method: "PUT",
      body: JSON.stringify({ orderedInstanceIds }),
    });
  },
  savePuckData(layoutId: string, puckData: any) {
    return authFetch<PageLayout>(`/page-layouts/${layoutId}/puck-data`, {
      method: "PUT",
      body: JSON.stringify({ puckData }),
    });
  },
  listVersions(layoutId: string) {
    return authFetch<{ versions: PageLayoutVersion[] }>(
      `/page-layouts/${layoutId}/versions`,
    );
  },
  getVersion(layoutId: string, versionId: string) {
    return authFetch<PageLayoutVersion>(
      `/page-layouts/${layoutId}/versions/${versionId}`,
    );
  },
  rollbackVersion(
    layoutId: string,
    versionId: string,
    mode: "draft" | "republish",
  ) {
    return authFetch<PageLayout>(
      `/page-layouts/${layoutId}/versions/${versionId}/rollback`,
      { method: "POST", body: JSON.stringify({ mode }) },
    );
  },
};

export type PageLayoutVersion = {
  id: string;
  pageLayoutId: string;
  versionNumber: number;
  name: string;
  slug: string;
  description: string | null;
  puckData: any | null;
  status: "CURRENT" | "ARCHIVED";
  publishedAt: string;
  publishedBy: string;
  createdAt: string;
  publishedByUser?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    avatarUrl: string | null;
    position: string | null;
  };
};

export type Subscription = {
  id: string;
  email: string;
  visitorId: string | null;
  tagSlugs: string[];
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const subscriptionApi = {
  create(body: { email: string; tagSlugs: string[]; visitorId?: string }) {
    return apiFetch<Subscription>(`/subscription`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  findByEmail(email: string) {
    return apiFetch<{ tagSlugs: string[] }>(
      `/subscription/by-email?email=${encodeURIComponent(email)}`,
    );
  },
  list() {
    return authFetch<Subscription[]>(`/subscription`);
  },
  remove(email: string) {
    return apiFetch<{ ok: boolean }>(
      `/subscription?email=${encodeURIComponent(email)}`,
      { method: "DELETE" },
    );
  },
};

export type VisitorProfile = {
  tagWeights: Record<string, number>;
  slugWeights: Record<string, number>;
  subscribedTagSlugs: string[];
};

export type VisitorSuggestions = {
  suggestedLinks: { label: string; url: string }[];
  hotTags: { slug: string; label: string }[];
};

export const visitorApi = {
  trackSlug(visitorId: string, slug: string) {
    return apiFetch<{ ok: boolean }>(`/visitor/track-slug`, {
      method: "POST",
      body: JSON.stringify({ visitorId, slug }),
    });
  },
  trackPost(visitorId: string, postId: string) {
    return apiFetch<{ ok: boolean }>(`/visitor/track-post`, {
      method: "POST",
      body: JSON.stringify({ visitorId, postId }),
    });
  },
  getProfile(visitorId: string) {
    return apiFetch<VisitorProfile>(`/visitor/${visitorId}/profile`);
  },
  getSuggestions(visitorId: string, limit = 6) {
    return apiFetch<VisitorSuggestions>(
      `/visitor/${visitorId}/suggestions?limit=${limit}`,
    );
  },
};

export type MediaItem = {
  id: string;
  name: string;
  type: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  alt: string | null;
  createdBy: string;
  departmentId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: { id: string; slug: string; name: string }[];
};

export type MediaListRes = {
  items: MediaItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type MediaTagRef = { id: string; slug: string; name: string };

export const resolveMediaUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  if (url.startsWith("/uploads/")) return `${API_URL}${url}`;
  return url;
};

const buildQuery = (
  params: Record<string, string | number | undefined>,
): string => {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  if (!entries.length) return "";
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")}`;
};

export const mediaApi = {
  upload: async (
    file: File,
    opts?: { alt?: string; tagSlugs?: string[]; departmentId?: string },
  ): Promise<MediaItem> => {
    const fd = new FormData();
    fd.append("file", file);
    if (opts?.alt) fd.append("alt", opts.alt);
    if (opts?.departmentId) fd.append("departmentId", opts.departmentId);
    if (opts?.tagSlugs?.length)
      fd.append("tagSlugs", JSON.stringify(opts.tagSlugs));
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("accessToken")
        : null;
    const res = await fetch(`${API_URL}/media/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw err;
    }
    return res.json() as Promise<MediaItem>;
  },
  createFromUrl: (body: {
    url: string;
    name?: string;
    alt?: string;
    tagSlugs?: string[];
    departmentId?: string;
  }) =>
    authFetch<MediaItem>(`/media/from-url`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  list: (query: {
    page?: number;
    pageSize?: number;
    search?: string;
    tagSlug?: string;
    departmentId?: string;
  }) => authFetch<MediaListRes>(`/media${buildQuery(query)}`),
  get: (id: string) => authFetch<MediaItem>(`/media/${id}`),
  update: (
    id: string,
    body: { name?: string; alt?: string | null; tagSlugs?: string[] },
  ) =>
    authFetch<MediaItem>(`/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    authFetch<{ ok: boolean }>(`/media/${id}`, { method: "DELETE" }),
  tagsInUse: () => authFetch<MediaTagRef[]>(`/media/tags-in-use`),
};

export type LocalizedText = {
  vi: string;
  en?: string;
};

export type CategoryRef = {
  id: string;
  slug: string;
  name: LocalizedText;
};

export type Category = {
  id: string;
  slug: string;
  name: LocalizedText;
  excerpt: LocalizedText | null;
  image: string | null;
  legacyId: number | null;
  status: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ContentStatusValue =
  | "DRAFT"
  | "PENDING"
  | "SCHEDULED"
  | "PUBLISHED";

export type PostLayoutRef = {
  id: string;
  name: string;
  slug: string;
  isPublished: boolean;
  scheduledAt: string | null;
  publishedAt: string | null;
  categoryLinks?: { categoryId: string }[];
};

export type PostRecord = {
  id: string;
  title: LocalizedText;
  slug: string;
  body: LocalizedText | null;
  excerpt: LocalizedText | null;
  departmentId: string | null;
  category?: CategoryRef;
  status: ContentStatusValue;
  coverMediaId: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  tags: { slug: string; name: string }[];
  eventStartAt: string | null;
  eventEndAt: string | null;
  eventLocation: string | null;
  gallery?: { src: string; alt: string }[];
  videoUrl?: string | null;
  videoCaption?: LocalizedText | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  trashDaysLeft?: number | null;
  layouts: PostLayoutRef[];
};

export type UpsertPostBody = {
  title: LocalizedText;
  slug: string;
  body?: LocalizedText | null;
  excerpt?: LocalizedText | null;
  status?: ContentStatusValue;
  scheduledAt?: string | null;
  // Lùi ngày đăng (chỉ Super Admin — backend bỏ qua nếu role khác).
  publishedAt?: string | null;
  coverMediaId?: string | null;
  coverUrl?: string | null;
  coverAlt?: string | null;
  tagSlugs?: string[];
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventLocation?: string | null;
  gallery?: { src: string; alt: string }[];
  videoUrl?: string | null;
  videoCaption?: LocalizedText | null;
};

export type PostPublicCard = {
  id: string;
  title: LocalizedText | string;
  slug: string;
  excerpt: LocalizedText | string | null;
  category?: CategoryRef;
  coverUrl: string | null;
  coverAlt: string | null;
  eventStartAt: string | null;
  eventEndAt: string | null;
  eventLocation: LocalizedText | string | null;
  publishedAt: string;
  layoutSlug: string | null;
  tags?: { slug: string; name: string; icon: string | null }[];
};

export type PostPagedResponse = {
  items: PostPublicCard[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export const postPublicApi = {
  latest: (limit = 4) =>
    apiFetch<PostPublicCard[]>(`/posts/public/latest?limit=${limit}`),
  upcomingEvents: (limit = 4) =>
    apiFetch<PostPublicCard[]>(`/posts/public/upcoming-events?limit=${limit}`),
  list: (params: {
    page?: number;
    pageSize?: number;
    category?: string;
    // Lọc theo bộ môn (trang tin của từng bộ môn). Thiếu tham số này thì API
    // trả feed của Khoa.
    department?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
  }) => {
    return apiFetch<PostPagedResponse>(
      `/posts/public/list${buildQuery(params)}`,
    );
  },
};

export type PostListPage = {
  items: PostRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// ── Đội ngũ bộ môn (khối DepartmentStaffAuto trên trang danh sách nhân sự) ──
export type DeptStaffLoc = { vi: string; en: string };
export type DeptStaffPerson = {
  /** Slug trang cá nhân — link hồ sơ. */
  slug: string;
  photo: string;
  name: DeptStaffLoc;
  eyebrow: DeptStaffLoc;
  role: DeptStaffLoc;
  email: string;
  visiting: boolean;
  /** Nhóm lọc: lanh-dao · giang-vien · giao-vu · thinh-giang. */
  category: string;
  /** Chức vụ cấp Khoa (Trưởng/Phó khoa) nếu có — trang cấp Khoa gom "Ban lãnh đạo". */
  facultyRole?: DeptStaffLoc | null;
};
export type DeptStaffRes = {
  department: string;
  departmentName: string;
  people: DeptStaffPerson[];
};

export const departmentStaffApi = {
  /** Đội ngũ một bộ môn theo slug (vd "vat-ly-tin-hoc"). Công khai, không auth. */
  get: (slug: string) =>
    apiFetch<DeptStaffRes>(
      `/scholar/public/department-staff/${encodeURIComponent(slug)}`,
    ),
};

export const postApi = {
  list: () => authFetch<PostRecord[]>(`/posts`),
  listPaged: (params: {
    page?: number;
    pageSize?: number;
    category?: string;
    status?: string;
    search?: string;
    deleted?: boolean;
  }) => {
    const { deleted, ...rest } = params;
    return authFetch<PostListPage>(
      `/posts${buildQuery({ ...rest, deleted: deleted ? "true" : undefined })}`,
    );
  },
  getById: (id: string) => authFetch<PostRecord>(`/posts/${id}`),
  create: (body: UpsertPostBody) =>
    authFetch<PostRecord>(`/posts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: UpsertPostBody) =>
    authFetch<PostRecord>(`/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    authFetch<{ ok: boolean }>(`/posts/${id}`, { method: "DELETE" }),
  restore: (id: string) =>
    authFetch<{ ok: boolean }>(`/posts/${id}/restore`, { method: "POST" }),
  purge: (id: string) =>
    authFetch<{ ok: boolean }>(`/posts/${id}/purge`, { method: "DELETE" }),
  // Xuất bản / lên lịch các layout của bài ngay từ trình soạn bài (khỏi phải sang
  // trình sửa layout chỉ để bấm publish). scheduledAt null = xuất bản ngay.
  publishLayouts: (id: string, scheduledAt?: string | null) =>
    authFetch<{
      ok: boolean;
      published?: number;
      scheduled?: number;
      skipped?: string[];
      reason?: string;
    }>(`/posts/${id}/publish-layouts`, {
      method: "POST",
      body: JSON.stringify({ scheduledAt: scheduledAt ?? null }),
    }),
  cloneIntoLayout: (
    id: string,
    body: {
      templateLayoutId: string;
      categoryIds?: string[];
      layoutName?: string;
      layoutSlug?: string;
    },
  ) =>
    authFetch<{ id: string; slug: string }>(`/posts/${id}/clone-into-layout`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export type UpsertCategoryBody = {
  slug: string;
  name: LocalizedText;
  excerpt?: LocalizedText | null;
  image?: string | null;
  status?: boolean;
};

export const categoryApi = {
  list: () => apiFetch<Category[]>(`/categories`),
  getById: (id: string) => apiFetch<Category>(`/categories/${id}`),
  create: (body: UpsertCategoryBody) =>
    authFetch<Category>(`/categories`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<UpsertCategoryBody>) =>
    authFetch<Category>(`/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    authFetch<{ ok: boolean }>(`/categories/${id}`, { method: "DELETE" }),
};

export type Tag = {
  id: string;
  name: string;
  slug: string;
  // Material Symbol name, image URL (/uploads or http), or null (text tag).
  icon: string | null;
  postCount?: number;
  createdAt: string;
  updatedAt: string;
};

export const tagApi = {
  list: () => apiFetch<Tag[]>(`/tags`),
  create: (body: { name: string; slug?: string; icon?: string | null }) =>
    authFetch<Tag>(`/tags`, { method: "POST", body: JSON.stringify(body) }),
  update: (
    id: string,
    body: { name?: string; slug?: string; icon?: string | null },
  ) =>
    authFetch<Tag>(`/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  merge: (id: string, targetId: string) =>
    authFetch<Tag>(`/tags/${id}/merge`, {
      method: "PATCH",
      body: JSON.stringify({ targetId }),
    }),
  remove: (id: string) =>
    authFetch<{ ok: boolean }>(`/tags/${id}`, { method: "DELETE" }),
};

// Standalone HTML pages (event microsites) — separate from Puck page layouts.
export type StaticPageListItem = {
  id: string;
  slug: string;
  title: string;
  renderMode: string;
  bundlePath: string | null;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaticPage = StaticPageListItem & { html: string };

export type UpsertStaticPageBody = {
  slug?: string;
  title?: string;
  html?: string;
  renderMode?: string;
  isPublished?: boolean;
};

export const staticPageApi = {
  list: () => authFetch<StaticPageListItem[]>(`/static-pages`),
  getById: (id: string) => authFetch<StaticPage>(`/static-pages/${id}`),
  create: (body: UpsertStaticPageBody) =>
    authFetch<StaticPage>(`/static-pages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: UpsertStaticPageBody) =>
    authFetch<StaticPage>(`/static-pages/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    authFetch<{ ok: boolean }>(`/static-pages/${id}`, { method: "DELETE" }),
  // Multipart upload of a folder microsite .zip. Uses fetch directly so the
  // browser sets the multipart boundary (authFetch forces application/json).
  uploadBundle: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("accessToken")
        : null;
    return fetch(`${API_URL}/static-pages/${id}/bundle`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw err;
      }
      return res.json() as Promise<StaticPage>;
    });
  },
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export const notificationApi = {
  list: (limit = 30) =>
    authFetch<{ items: NotificationItem[]; unread: number }>(
      `/notifications?limit=${limit}`,
    ),
  unreadCount: () =>
    authFetch<{ unread: number }>(`/notifications/unread-count`),
  markRead: (id: string) =>
    authFetch<{ ok: boolean }>(`/notifications/${id}/read`, {
      method: "PATCH",
    }),
  markAllRead: () =>
    authFetch<{ ok: boolean }>(`/notifications/read-all`, { method: "PATCH" }),
};
