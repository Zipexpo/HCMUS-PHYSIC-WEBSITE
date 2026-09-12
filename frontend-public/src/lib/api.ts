const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Server-side rendering runs inside the container; on a NAT'd host with no hairpin it
// cannot reach its own public IP, so SSR fetches use INTERNAL_API_URL (a server-only
// runtime var, e.g. http://backend:3001) when set. The browser always uses the public
// URL — INTERNAL_API_URL is undefined client-side, so this collapses to PUBLIC_API_URL.
const API_URL =
  typeof window === "undefined"
    ? process.env.INTERNAL_API_URL || PUBLIC_API_URL
    : PUBLIC_API_URL;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw error;
  }
  return res.json();
}

export const resolveMediaUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  // Always the public URL: this string is emitted into HTML for the browser to load.
  if (url.startsWith("/uploads/")) return `${PUBLIC_API_URL}${url}`;
  return url;
};

export type {
  Category,
  CategoryRef,
  LocalizedText,
  MediaItem,
  PageLayout,
  PostPagedResponse,
  PostPublicCard,
  Subscription,
  VisitorProfile,
  VisitorSuggestions,
} from "@admin/lib/api";

import type {
  Category,
  MediaItem,
  PageLayout,
  PostPagedResponse,
  PostPublicCard,
  Subscription,
  VisitorProfile,
  VisitorSuggestions,
} from "@admin/lib/api";

export async function getLayoutBySlug(slug: string): Promise<PageLayout> {
  const res = await fetch(`${API_URL}/page-layouts/slug/${slug}`, {
    next: { revalidate: 3600, tags: ["sitemap", `page:${slug}`] },
  });
  if (!res.ok) throw new Error(`Layout not found: ${slug}`);
  return res.json();
}

// Standalone HTML pages (event microsites) served on the domain without the Puck
// designer. The catch-all falls back to this when no layout matches the slug.
export type PublicStaticPage = {
  id: string;
  slug: string;
  title: string;
  html: string;
  renderMode: string;
  // Set when a folder microsite was uploaded as a .zip; served entry (index.html)
  // under /uploads/... — takes precedence over html.
  bundlePath: string | null;
  isPublished: boolean;
};

export async function getStaticPageBySlug(
  slug: string,
): Promise<PublicStaticPage> {
  const res = await fetch(`${API_URL}/static-pages/slug/${slug}`, {
    next: { revalidate: 3600, tags: ["sitemap", `static-page:${slug}`] },
  });
  if (!res.ok) throw new Error(`Static page not found: ${slug}`);
  return res.json();
}

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

export const mediaApi = {
  list: (_query?: {
    page?: number;
    pageSize?: number;
    search?: string;
    tagSlug?: string;
    departmentId?: string;
  }) =>
    Promise.resolve({
      items: [] as MediaItem[],
      total: 0,
      page: 1,
      pageSize: 0,
    }),
  tagsInUse: () =>
    Promise.resolve([] as { id: string; slug: string; name: string }[]),
  // Admin-only in practice (Puck editor fields never run on the public render),
  // but the shared MediaPickerModal/UploadZone reference these, so the public
  // build needs them to type-check. Giữ CHỮ KÝ khớp frontend/src/lib/api.ts.
  upload: (
    _file: File,
    _opts?: { tagSlugs?: string[]; alt?: string; departmentId?: string },
  ): Promise<MediaItem> =>
    Promise.reject(new Error("media upload is admin-only")),
  createFromUrl: (_body: {
    url: string;
    name?: string;
    alt?: string;
    tagSlugs?: string[];
    departmentId?: string;
  }): Promise<MediaItem> =>
    Promise.reject(new Error("media createFromUrl is admin-only")),
};

export const categoryApi = {
  list: () => apiFetch<Category[]>(`/categories`),
  getById: (id: string) => apiFetch<Category>(`/categories/${id}`),
  create: () => Promise.reject(new Error("not available on public")),
  update: () => Promise.reject(new Error("not available on public")),
  remove: () => Promise.reject(new Error("not available on public")),
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
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("pageSize", String(params.pageSize));
    if (params.category) sp.set("category", params.category);
    if (params.department) sp.set("department", params.department);
    if (params.fromDate) sp.set("fromDate", params.fromDate);
    if (params.toDate) sp.set("toDate", params.toDate);
    if (params.search) sp.set("search", params.search);
    const query = sp.toString();
    return apiFetch<PostPagedResponse>(
      `/posts/public/list${query ? `?${query}` : ""}`,
    );
  },
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

// ---- Chatbot ----
export type ChatSource = { title: string | null; slug: string | null };
export type ChatAnswer = { answer: string; sources: ChatSource[] };

export const chatbotApi = {
  ask: (question: string, language: "VI" | "EN" = "VI") =>
    apiFetch<ChatAnswer>(`/chatbot/ask`, {
      method: "POST",
      body: JSON.stringify({ question, language }),
    }),
};
