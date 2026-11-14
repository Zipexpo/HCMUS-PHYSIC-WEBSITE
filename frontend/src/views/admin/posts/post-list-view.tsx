"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { AdminSelect } from "@/components/admin/admin-select";
import { useConfirm } from "@/components/use-confirm";
import {
  authApi,
  type ContentStatusValue,
  categoryApi,
  type PostLayoutRef,
  type PostRecord,
  postApi,
} from "@/lib/api";
import { localize } from "@/lib/localized";
import { buildCategoryOptions, categoryLabel } from "@/lib/post-categories";

type TabKey = "mine" | "review" | "published" | "trash";

// Tập rỗng dùng chung: tạo Set mới mỗi lần render sẽ làm mọi thứ so sánh
// tham chiếu tưởng là đã đổi.
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

const PAGE_SIZE = 12;

const STATUS_STYLES: Record<ContentStatusValue, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-amber-100 text-amber-700",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS: Record<ContentStatusValue, string> = {
  DRAFT: "Nháp",
  PENDING: "Chờ xuất bản",
  SCHEDULED: "Lên lịch",
  PUBLISHED: "Công khai",
};

const layoutBadgeStyle = (layout: PostLayoutRef): string => {
  if (layout.isPublished)
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (layout.scheduledAt)
    return "bg-amber-50 text-amber-700 border border-amber-200";
  return "bg-slate-50 text-slate-700 border border-slate-200";
};

const layoutStatusText = (layout: PostLayoutRef): string => {
  if (layout.isPublished) return "pub";
  if (layout.scheduledAt) return "sched";
  return "draft";
};

const earliestPublishedAt = (layouts: PostLayoutRef[]): string | null => {
  let min: number | null = null;
  for (const l of layouts) {
    if (!l.isPublished || !l.publishedAt) continue;
    const t = new Date(l.publishedAt).getTime();
    if (Number.isNaN(t)) continue;
    if (min === null || t < min) min = t;
  }
  return min === null ? null : new Date(min).toISOString();
};

const formatDDMMYYYY = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatPublicAt = (post: PostRecord): string => {
  if (post.publishedAt) return formatDDMMYYYY(post.publishedAt);
  const fromLayout = earliestPublishedAt(post.layouts);
  if (fromLayout) return formatDDMMYYYY(fromLayout);
  if (post.status === "PUBLISHED") return formatDDMMYYYY(post.updatedAt);
  return "—";
};

export function PostListView() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<TabKey>("mine");
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [statusInTab, setStatusInTab] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const profileQuery = useQuery({
    queryKey: ["AUTH", "PROFILE"],
    queryFn: authApi.getProfile,
  });
  const ownerId = profileQuery.data?.id;
  const isSuperAdmin = profileQuery.data?.role === "SUPER_ADMIN";

  const categoriesQuery = useQuery({
    queryKey: ["CATEGORIES"],
    queryFn: categoryApi.list,
  });
  const categoryOptions = useMemo(
    () => buildCategoryOptions(categoriesQuery.data, "vi"),
    [categoriesQuery.data],
  );
  // Status param sent to BE differs per tab.
  // - Published tab: always status=PUBLISHED.
  // - Mine tab: pass through whatever the picker chose; BE default returns
  //   own + everyone-else's published, FE narrows to ownerId.
  const serverStatus =
    tab === "published" ? "PUBLISHED" : statusInTab || undefined;

  // For Mine tab we must paginate client-side: BE doesn't expose a
  // createdBy filter, so the only way to keep author-scoped totals + paging
  // honest is to pull a wider window and slice on the client.
  const listQuery = useQuery({
    queryKey: ["POSTS", "PAGED", tab, page, category, serverStatus, search],
    queryFn: () =>
      postApi.listPaged({
        page: tab === "mine" ? 1 : page,
        pageSize: tab === "mine" ? 100 : PAGE_SIZE,
        category: category || undefined,
        status: tab === "trash" ? undefined : serverStatus,
        search: search || undefined,
        deleted: tab === "trash" ? true : undefined,
      }),
    placeholderData: (prev) => prev,
    enabled: profileQuery.data !== undefined,
  });

  // Dedicated count queries — independent of the active tab + filters, so both
  // tab labels stay accurate regardless of which tab is open.
  const allMineQuery = useQuery({
    queryKey: ["POSTS", "COUNT", "MINE", ownerId],
    queryFn: () => postApi.listPaged({ page: 1, pageSize: 100 }),
    enabled: !!ownerId,
  });
  const publishedCountQuery = useQuery({
    queryKey: ["POSTS", "COUNT", "PUBLISHED"],
    queryFn: () =>
      postApi.listPaged({ page: 1, pageSize: 1, status: "PUBLISHED" }),
    enabled: !!ownerId,
  });

  const mineCount = useMemo(() => {
    const items = allMineQuery.data?.items ?? [];
    return items.filter((p) => p.createdBy === ownerId).length;
  }, [allMineQuery.data, ownerId]);
  const publishedCount = publishedCountQuery.data?.total ?? 0;
  // Private/dept-scoped trash count (the BE scopes it to the caller's department).
  const trashCountQuery = useQuery({
    queryKey: ["POSTS", "COUNT", "TRASH"],
    queryFn: () => postApi.listPaged({ page: 1, pageSize: 1, deleted: true }),
    enabled: !!ownerId,
  });
  const trashCount = trashCountQuery.data?.total ?? 0;

  const deleteMutation = useMutation({
    mutationKey: ["POSTS", "DELETE"],
    mutationFn: (id: string) => postApi.remove(id),
    onSuccess: () => {
      toast.success("Đã chuyển vào thùng rác (khôi phục được trong 30 ngày)");
      queryClient.invalidateQueries({ queryKey: ["POSTS"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không thể xóa");
    },
  });

  const restoreMutation = useMutation({
    mutationKey: ["POSTS", "RESTORE"],
    mutationFn: (id: string) => postApi.restore(id),
    onSuccess: () => {
      toast.success("Đã khôi phục bài đăng");
      queryClient.invalidateQueries({ queryKey: ["POSTS"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không thể khôi phục");
    },
  });

  const purgeMutation = useMutation({
    mutationKey: ["POSTS", "PURGE"],
    mutationFn: (id: string) => postApi.purge(id),
    onSuccess: () => {
      toast.success("Đã xóa vĩnh viễn bài đăng");
      queryClient.invalidateQueries({ queryKey: ["POSTS"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không thể xóa vĩnh viễn");
    },
  });

  // ── Chọn nhiều ────────────────────────────────────────────────────────────
  // Bỏ chọn khi đổi tab/trang/bộ lọc: id ở danh sách cũ không còn nghĩa gì, giữ
  // lại thì dễ bấm nhầm "xóa tất cả" lên những bài đang không nhìn thấy.
  const viewKey = `${tab}|${page}|${category}|${statusInTab}|${search}`;
  const [selection, setSelection] = useState<{
    key: string;
    ids: ReadonlySet<string>;
  }>({ key: viewKey, ids: EMPTY_SELECTION });
  // Suy ra theo khóa khung nhìn thay vì dùng useEffect để reset: không có nhịp
  // render trung gian còn sót lựa chọn của khung nhìn cũ.
  const selected = selection.key === viewKey ? selection.ids : EMPTY_SELECTION;

  const setSelected = (
    update: Set<string> | ((prev: ReadonlySet<string>) => Set<string>),
  ) =>
    setSelection((prev) => ({
      key: viewKey,
      ids:
        typeof update === "function"
          ? update(prev.key === viewKey ? prev.ids : EMPTY_SELECTION)
          : update,
    }));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Chạy tuần tự chứ không Promise.all: mỗi thao tác đều kéo theo dựng lại
  // snapshot feed ở backend, bắn song song hàng chục cái sẽ dí chết server.
  const runBulk = async (
    ids: string[],
    fn: (id: string) => Promise<unknown>,
  ) => {
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await fn(id);
        ok += 1;
      } catch {
        failed.push(id);
      }
    }
    return { ok, failed };
  };

  const bulkMutation = useMutation({
    mutationKey: ["POSTS", "BULK"],
    mutationFn: async (input: {
      ids: string[];
      action: "delete" | "restore" | "purge";
    }) => {
      const fn =
        input.action === "delete"
          ? postApi.remove
          : input.action === "restore"
            ? postApi.restore
            : postApi.purge;
      return runBulk(input.ids, fn);
    },
    onSuccess: ({ ok, failed }) => {
      if (failed.length) {
        toast.warn(`Xong ${ok} bài, ${failed.length} bài lỗi`);
      } else {
        toast.success(`Đã xử lý ${ok} bài`);
      }
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["POSTS"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không thể thực hiện hàng loạt");
    },
  });

  const confirmBulk = async (
    action: "delete" | "restore" | "purge",
    label: string,
    description: string,
    destructive: boolean,
  ) => {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirm({
      title: `${label} ${ids.length} bài đã chọn?`,
      description,
      confirmLabel: label,
      destructive,
    });
    if (ok) bulkMutation.mutate({ ids, action });
  };

  const confirmDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: `Xóa bài "${title}"?`,
      description:
        "Bài sẽ được chuyển vào thùng rác và có thể khôi phục trong 30 ngày trước khi bị xoá vĩnh viễn.",
      confirmLabel: "Xóa",
      destructive: true,
    });
    if (ok) deleteMutation.mutate(id);
  };

  const confirmPurge = async (id: string, title: string) => {
    const ok = await confirm({
      title: `Xóa vĩnh viễn bài "${title}"?`,
      description:
        "Bài đăng và các layout gắn với nó sẽ bị xoá khỏi hệ thống. Thao tác này KHÔNG thể hoàn tác.",
      confirmLabel: "Xóa vĩnh viễn",
      destructive: true,
    });
    if (ok) purgeMutation.mutate(id);
  };

  const data = listQuery.data;
  const rawItems = data?.items ?? [];

  // Mine tab: narrow to ownerId. Then slice for pagination.
  const mineFiltered = useMemo(
    () =>
      tab === "mine"
        ? rawItems.filter((p) => p.createdBy === ownerId)
        : rawItems,
    [rawItems, tab, ownerId],
  );

  const mineTotal = mineFiltered.length;
  const mineTotalPages = Math.max(1, Math.ceil(mineTotal / PAGE_SIZE));
  const mineStart = (page - 1) * PAGE_SIZE;
  const mineSlice = mineFiltered.slice(mineStart, mineStart + PAGE_SIZE);

  const serverPaged = tab === "published" || tab === "trash";
  // ── Hàng đợi duyệt (chỉ admin cấp Khoa mới gọi được; đơn vị gọi sẽ lỗi nên
  //    chỉ bật khi tài khoản KHÔNG phải loại phải gửi duyệt) ─────────────────
  const canReview = profileQuery.data
    ? !profileQuery.data.mustSubmitForReview
    : false;
  const reviewQuery = useQuery({
    queryKey: ["POSTS", "PENDING_REVIEW"],
    queryFn: postApi.pendingReview,
    enabled: canReview,
  });
  const reviewCount = reviewQuery.data?.length ?? 0;

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["POSTS"] });
  };

  const approveMutation = useMutation({
    // Admin cấp Khoa không vướng cửa duyệt, nên "duyệt" chính là bấm đăng.
    mutationFn: (id: string) => postApi.publishLayouts(id, null),
    onSuccess: (res) => {
      if (!res.ok && res.reason === "no-layout") {
        toast.warn("Bài chưa có trang public — mở bài ra tạo layout trước");
        return;
      }
      toast.success("Đã duyệt và đăng bài");
      refreshAll();
    },
    onError: () => toast.error("Không duyệt được bài"),
  });

  const rejectMutation = useMutation({
    mutationFn: (v: { id: string; note: string }) =>
      postApi.reject(v.id, v.note),
    onSuccess: () => {
      toast.success("Đã trả bài về cho đơn vị");
      refreshAll();
    },
    onError: () => toast.error("Không trả được bài"),
  });

  const askReject = (id: string, title: string) => {
    const note = window.prompt(
      `Trả bài "${title}" về cho đơn vị. Ghi rõ cần sửa gì:`,
      "",
    );
    // null = bấm Huỷ. Chuỗi rỗng = không ghi lý do, vẫn cho trả.
    if (note === null) return;
    rejectMutation.mutate({ id, note });
  };

  const items =
    tab === "review"
      ? (reviewQuery.data ?? [])
      : tab === "mine"
        ? mineSlice
        : rawItems;

  // Ô chọn ở đầu bảng chỉ thao tác trên các bài ĐANG HIỂN THỊ, không đụng tới
  // những trang khác — người dùng chỉ thấy được từng này bài.
  const allOnPageSelected =
    items.length > 0 && items.every((p) => selected.has(p.id));
  const someOnPageSelected =
    !allOnPageSelected && items.some((p) => selected.has(p.id));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (items.every((p) => next.has(p.id))) {
        for (const p of items) next.delete(p.id);
      } else {
        for (const p of items) next.add(p.id);
      }
      return next;
    });
  const total = serverPaged ? (data?.total ?? 0) : mineTotal;
  const totalPages = serverPaged ? (data?.totalPages ?? 1) : mineTotalPages;
  const hasFilters = Boolean(category || statusInTab || search);

  const switchTab = (next: TabKey) => {
    setTab(next);
    setPage(1);
    setStatusInTab("");
  };

  const resetFilters = () => {
    setCategory("");
    setStatusInTab("");
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1a2436] flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-content-1000 dark:text-slate-100">
            Bài đăng
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Danh sách tất cả bài đăng. Mỗi bài có thể được gắn vào nhiều layout
            public.
          </p>
        </div>
        <Link
          href="/admin/posts"
          data-tour="post-new"
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Tạo bài đăng mới
        </Link>
      </header>

      <div className="flex-1 p-6 space-y-4">
        <div className="flex border-b border-slate-200 dark:border-slate-800">
          {(
            [
              { key: "mine", label: "Bài của tôi", count: mineCount },
              ...(canReview
                ? [
                    {
                      key: "review" as TabKey,
                      label: "Chờ duyệt",
                      count: reviewCount,
                    },
                  ]
                : []),
              {
                key: "published",
                label: "Đã xuất bản",
                count: publishedCount,
              },
              { key: "trash", label: "Đã xoá", count: trashCount },
            ] as { key: TabKey; label: string; count: number }[]
          ).map((t) => {
            const active = tab === t.key;
            const count = t.count;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => switchTab(t.key)}
                className={
                  "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-2 " +
                  (active
                    ? "border-blue-600 text-blue-700 dark:text-blue-300"
                    : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200")
                }
              >
                {t.label}
                <span
                  className={
                    "px-1.5 py-0.5 rounded-full text-[10px] font-semibold " +
                    (active
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300")
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="bg-white dark:bg-[#1a2436] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tiêu đề, slug, mô tả…"
            data-tour="post-search"
            className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="min-w-[200px]">
            <AdminSelect
              value={category}
              onChange={(next) => {
                setCategory(next);
                setPage(1);
              }}
              placeholder="Tất cả danh mục"
              clearLabel="Tất cả danh mục"
              options={categoryOptions}
            />
          </div>
          {tab === "mine" ? (
            <div className="min-w-[180px]">
              <AdminSelect
                value={statusInTab}
                onChange={(next) => {
                  setStatusInTab(next);
                  setPage(1);
                }}
                placeholder="Tất cả"
                clearLabel="Tất cả"
                options={(
                  ["DRAFT", "SCHEDULED", "PUBLISHED"] as ContentStatusValue[]
                ).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
              />
            </div>
          ) : null}
          {hasFilters ? (
            <button
              type="button"
              onClick={resetFilters}
              className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-[#202c44]"
            >
              Xóa lọc
            </button>
          ) : null}
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {listQuery.isLoading ? "Đang tải…" : `${total} kết quả`}
          </span>
        </div>

        {listQuery.isLoading && !data ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            Đang tải…
          </p>
        ) : items.length === 0 ? (
          <div className="bg-white dark:bg-[#1a2436] border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-10 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {hasFilters
                ? "Không có bài đăng nào khớp với bộ lọc."
                : tab === "mine"
                  ? 'Bạn chưa có bài đăng nào. Bấm "Tạo bài đăng mới" để bắt đầu.'
                  : "Chưa có bài đăng nào được xuất bản."}
            </p>
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-[#1a2436] rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-[#121a2b] border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="pl-4 pr-1 py-3 text-left font-semibold w-8">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả bài trên trang"
                        className="w-4 h-4 accent-blue-600 cursor-pointer align-middle"
                        checked={allOnPageSelected}
                        ref={(el) => {
                          // Trạng thái "gạch ngang" khi chọn một phần — chỉ đặt được
                          // bằng JS, không có thuộc tính HTML tương ứng.
                          if (el) el.indeterminate = someOnPageSelected;
                        }}
                        onChange={toggleAllOnPage}
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Bài đăng
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Danh mục
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Layouts
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      Public at
                    </th>
                    <th className="px-4 py-3 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((post) => (
                    <tr
                      key={post.id}
                      className={
                        "hover:bg-slate-50 dark:hover:bg-[#202c44] " +
                        (selected.has(post.id)
                          ? "bg-blue-50/60 dark:bg-[#1c2942]"
                          : "")
                      }
                    >
                      <td className="pl-4 pr-1 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${localize(post.title, "vi")}`}
                          className="w-4 h-4 accent-blue-600 cursor-pointer align-middle"
                          checked={selected.has(post.id)}
                          onChange={() => toggleOne(post.id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <Link
                            href={`/admin/posts?id=${post.id}`}
                            className="text-sm font-medium text-blue-700 dark:text-slate-100 hover:underline"
                          >
                            {localize(post.title, "vi")}
                          </Link>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
                            /{post.slug}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {categoryLabel(post.category, "vi")}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold " +
                            STATUS_STYLES[post.status]
                          }
                        >
                          {STATUS_LABELS[post.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {post.layouts.length === 0 ? (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                              Chưa gắn layout
                            </span>
                          ) : (
                            post.layouts.map((layout) => (
                              <Link
                                key={layout.id}
                                href={`/admin/widgets-layout?edit=${layout.id}`}
                                className={
                                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium " +
                                  layoutBadgeStyle(layout)
                                }
                                title={`Mở ${layout.name}`}
                              >
                                <span>{layout.name}</span>
                                <span className="text-[9px] uppercase opacity-70">
                                  {layoutStatusText(layout)}
                                </span>
                              </Link>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatPublicAt(post)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {tab === "trash" ? (
                          <div className="inline-flex items-center gap-2">
                            {typeof post.trashDaysLeft === "number" ? (
                              <span className="text-[11px] text-slate-400">
                                còn {post.trashDaysLeft} ngày
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => restoreMutation.mutate(post.id)}
                              disabled={restoreMutation.isPending}
                              className="px-2 py-1 text-xs text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-50 disabled:opacity-50"
                            >
                              Khôi phục
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                confirmPurge(
                                  post.id,
                                  localize(post.title, "vi"),
                                )
                              }
                              disabled={purgeMutation.isPending}
                              className="px-2 py-1 text-xs text-rose-700 border border-rose-200 rounded-md hover:bg-rose-50 disabled:opacity-50"
                            >
                              Xóa vĩnh viễn
                            </button>
                          </div>
                        ) : tab === "review" ? (
                          <div className="inline-flex gap-1">
                            <Link
                              href={`/admin/posts?id=${post.id}`}
                              className="px-2 py-1 text-xs text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-[#202c44]"
                            >
                              Xem
                            </Link>
                            <button
                              type="button"
                              onClick={() => approveMutation.mutate(post.id)}
                              disabled={approveMutation.isPending}
                              className="px-2 py-1 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Duyệt &amp; đăng
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                askReject(post.id, localize(post.title, "vi"))
                              }
                              disabled={rejectMutation.isPending}
                              className="px-2 py-1 text-xs text-amber-700 border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-50"
                            >
                              Trả lại
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex gap-1">
                            <Link
                              href={`/admin/posts?id=${post.id}`}
                              className="px-2 py-1 text-xs text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-[#202c44]"
                            >
                              Sửa
                            </Link>
                            <button
                              type="button"
                              onClick={() =>
                                confirmDelete(
                                  post.id,
                                  localize(post.title, "vi"),
                                )
                              }
                              className="px-2 py-1 text-xs text-rose-700 border border-rose-200 rounded-md hover:bg-rose-50"
                            >
                              Xóa
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
              />
            ) : null}
          </>
        )}
      </div>

      {/* Thanh hành động hàng loạt: chỉ hiện khi có bài được chọn. Đặt cố định
          đáy màn hình để cuộn tới đâu vẫn thao tác được, và luôn cho biết đang
          chọn bao nhiêu bài trước khi bấm một nút không hoàn tác được. */}
      {selected.size > 0 ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-[#1a2436] border border-slate-200 dark:border-slate-700 shadow-xl">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
            Đã chọn {selected.size} bài
          </span>
          <span className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
          {tab === "trash" ? (
            <>
              <button
                type="button"
                disabled={bulkMutation.isPending}
                onClick={() =>
                  confirmBulk(
                    "restore",
                    "Khôi phục tất cả",
                    "Các bài đã chọn sẽ được đưa khỏi thùng rác về trạng thái trước khi xoá.",
                    false,
                  )
                }
                className="px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-50 disabled:opacity-50"
              >
                Khôi phục tất cả
              </button>
              <button
                type="button"
                disabled={bulkMutation.isPending}
                onClick={() =>
                  confirmBulk(
                    "purge",
                    "Xóa vĩnh viễn tất cả",
                    "Các bài đã chọn và layout gắn với chúng sẽ bị xoá khỏi hệ thống. Thao tác này KHÔNG thể hoàn tác.",
                    true,
                  )
                }
                className="px-3 py-1.5 text-xs font-medium text-rose-700 border border-rose-200 rounded-md hover:bg-rose-50 disabled:opacity-50"
              >
                Xóa vĩnh viễn tất cả
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={bulkMutation.isPending}
              onClick={() =>
                confirmBulk(
                  "delete",
                  "Xóa tất cả",
                  "Các bài đã chọn sẽ được chuyển vào thùng rác và khôi phục được trong 30 ngày.",
                  true,
                )
              }
              className="px-3 py-1.5 text-xs font-medium text-rose-700 border border-rose-200 rounded-md hover:bg-rose-50 disabled:opacity-50"
            >
              Xóa tất cả
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline"
          >
            Bỏ chọn
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  const pages = buildPageList(page, totalPages);
  return (
    <div className="flex items-center justify-center gap-1 pt-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-[#202c44] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Trước
      </button>
      {pages.map((p, idx) =>
        p === "…" ? (
          <span
            key={`gap-${idx}`}
            className="px-2 text-xs text-slate-400 dark:text-slate-500 select-none"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={
              p === page
                ? "px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md"
                : "px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-[#202c44]"
            }
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-[#202c44] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Sau →
      </button>
    </div>
  );
}

function buildPageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
