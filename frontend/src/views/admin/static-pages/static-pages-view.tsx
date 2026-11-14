"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { authApi, type StaticPageListItem, staticPageApi } from "@/lib/api";
import { isFacultyWide } from "@/lib/department";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";

type FormState = {
  id?: string;
  slug: string;
  title: string;
  html: string;
  renderMode: string;
  isPublished: boolean;
};

const emptyForm: FormState = {
  slug: "",
  title: "",
  html: "",
  renderMode: "iframe",
  isPublished: false,
};

export function StaticPagesView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [bundleFile, setBundleFile] = useState<File | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["PROFILE"],
    queryFn: authApi.getProfile,
  });
  useEffect(() => {
    if (profile && !isFacultyWide(profile.role, profile.departmentId))
      router.replace("/admin");
  }, [profile, router]);

  const listQuery = useQuery({
    queryKey: ["STATIC_PAGES"],
    queryFn: staticPageApi.list,
  });

  const reset = () => {
    setForm(emptyForm);
    setBundleFile(null);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        slug: form.slug || undefined,
        title: form.title,
        html: form.html,
        renderMode: form.renderMode,
        isPublished: form.isPublished,
      };
      return form.id
        ? staticPageApi.update(form.id, body)
        : staticPageApi.create(body);
    },
    onSuccess: () => {
      toast.success("Đã lưu trang");
      queryClient.invalidateQueries({ queryKey: ["STATIC_PAGES"] });
      reset();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => staticPageApi.remove(id),
    onSuccess: () => {
      toast.success("Đã xoá trang");
      queryClient.invalidateQueries({ queryKey: ["STATIC_PAGES"] });
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });

  const uploadBundle = useMutation({
    mutationFn: () => {
      if (!form.id || !bundleFile)
        return Promise.reject({ message: "Chọn file .zip" });
      return staticPageApi.uploadBundle(form.id, bundleFile);
    },
    onSuccess: () => {
      toast.success("Đã tải microsite (.zip)");
      queryClient.invalidateQueries({ queryKey: ["STATIC_PAGES"] });
      setBundleFile(null);
    },
    onError: (e: { message?: string }) =>
      toast.error(e.message || "Lỗi tải .zip"),
  });

  // The list omits the (large) html blob; fetch the full record when editing.
  const startEdit = async (id: string) => {
    try {
      const page = await staticPageApi.getById(id);
      setForm({
        id: page.id,
        slug: page.slug,
        title: page.title,
        html: page.html,
        renderMode: page.renderMode,
        isPublished: page.isPublished,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(
        (e as { message?: string }).message || "Không tải được trang",
      );
    }
  };

  const input =
    "w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 bg-white dark:bg-[#1a2436]";

  const publicUrl = (slug: string) => `${SITE_URL.replace(/\/$/, "")}/${slug}`;

  return (
    <div className="h-full overflow-y-auto max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
        Trang HTML tĩnh
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Trang HTML độc lập (vd microsite sự kiện) hiển thị trên domain mà không
        qua trình thiết kế layout. Dán HTML sẵn, đặt đường dẫn, publish.
      </p>

      {/* Form */}
      <div className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <input
            className={input}
            placeholder="Tiêu đề (vd Hội thảo ICEBA 2023)"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <input
            className={input}
            placeholder="Đường dẫn / slug (vd iceba2023 — trống thì tự sinh)"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Chế độ hiển thị:
            <select
              className={input + " w-auto"}
              value={form.renderMode}
              onChange={(e) =>
                setForm((f) => ({ ...f, renderMode: e.target.value }))
              }
            >
              <option value="iframe">
                iframe — trang HTML đầy đủ (khuyên dùng)
              </option>
              <option value="embed">
                embed — đoạn nội dung trong khung site
              </option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(e) =>
                setForm((f) => ({ ...f, isPublished: e.target.checked }))
              }
            />
            Công khai (published)
          </label>
        </div>

        <textarea
          className={input + " font-mono text-xs min-h-[280px]"}
          placeholder="Dán toàn bộ HTML tại đây…"
          value={form.html}
          onChange={(e) => setForm((f) => ({ ...f, html: e.target.value }))}
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!form.title || save.isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg disabled:opacity-50"
          >
            {form.id ? "Cập nhật" : "Thêm"} trang
          </button>
          {form.id ? (
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 text-sm text-slate-500"
            >
              Huỷ
            </button>
          ) : null}
        </div>

        {/* Folder microsite: upload a .zip (needs the page saved first for an id) */}
        {form.id ? (
          <div className="mt-1 p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Microsite dạng <b>thư mục</b>? Nén cả thư mục thành <b>.zip</b>{" "}
              (có <code>index.html</code> bên trong) rồi tải lên — CSS/JS/ảnh
              giữ nguyên. Tải lại sẽ ghi đè. Khi có .zip, phần HTML ở trên bị bỏ
              qua.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setBundleFile(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
              <button
                type="button"
                onClick={() => uploadBundle.mutate()}
                disabled={!bundleFile || uploadBundle.isPending}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg disabled:opacity-50 whitespace-nowrap"
              >
                {uploadBundle.isPending ? "Đang tải…" : "Tải .zip"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Trang microsite dạng thư mục (.zip): bấm <b>Thêm trang</b> trước,
            rồi bấm <b>Sửa</b> để hiện ô tải .zip.
          </p>
        )}
      </div>

      {/* List */}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        {(listQuery.data ?? []).length === 0 ? (
          <li className="px-4 py-6 text-sm text-slate-400 text-center">
            Chưa có trang nào.
          </li>
        ) : null}
        {(listQuery.data ?? []).map((p: StaticPageListItem) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">
              {p.title}{" "}
              <span className="text-[11px] text-slate-400 font-mono">
                /{p.slug} · {p.bundlePath ? "bundle (.zip)" : p.renderMode}
              </span>
            </span>
            {p.isPublished ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                Công khai
              </span>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">
                Nháp
              </span>
            )}
            {p.isPublished && SITE_URL ? (
              <a
                href={publicUrl(p.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-500 hover:text-blue-600"
              >
                Xem
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => startEdit(p.id)}
              className="text-xs text-blue-600"
            >
              Sửa
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Xoá trang "${p.title}"?`)) remove.mutate(p.id);
              }}
              className="text-xs text-red-500"
            >
              Xoá
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
