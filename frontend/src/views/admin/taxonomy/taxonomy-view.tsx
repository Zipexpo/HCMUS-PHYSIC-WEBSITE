"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { DynamicIcon } from "@/components/admin/icons";
import {
  authApi,
  type Category,
  categoryApi,
  type Department,
  departmentApi,
  resolveMediaUrl,
  type Tag,
  tagApi,
} from "@/lib/api";
import { isFacultyWide } from "@/lib/department";
import { MediaPickerModal } from "@/views/admin/widgets-layout/fields/media-picker-modal";

type TabKey = "categories" | "tags" | "departments";

function TagIconPreview({ icon }: { icon: string | null }) {
  if (!icon) return <span className="text-slate-300">—</span>;
  if (/^(https?:|\/uploads)/.test(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={resolveMediaUrl(icon)}
        alt=""
        className="w-6 h-6 object-contain rounded"
      />
    );
  }
  return <DynamicIcon name={icon} className="w-5 h-5 text-slate-600" />;
}

export function TaxonomyView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("categories");
  const [pickerFor, setPickerFor] = useState<null | "category" | "tag">(null);

  const { data: profile } = useQuery({
    queryKey: ["PROFILE"],
    queryFn: authApi.getProfile,
  });
  useEffect(() => {
    if (profile && !isFacultyWide(profile.role, profile.departmentId))
      router.replace("/admin");
  }, [profile, router]);

  // ---- Categories ----
  const categoriesQuery = useQuery({
    queryKey: ["CATEGORIES"],
    queryFn: categoryApi.list,
  });
  const [catForm, setCatForm] = useState<{
    id?: string;
    slug: string;
    nameVi: string;
    nameEn: string;
    image: string;
  }>({ slug: "", nameVi: "", nameEn: "", image: "" });
  const resetCat = () =>
    setCatForm({ slug: "", nameVi: "", nameEn: "", image: "" });
  const saveCat = useMutation({
    mutationFn: () => {
      const body = {
        slug: catForm.slug,
        name: { vi: catForm.nameVi, en: catForm.nameEn || undefined },
        image: catForm.image || null,
      };
      return catForm.id
        ? categoryApi.update(catForm.id, body)
        : categoryApi.create(body);
    },
    onSuccess: () => {
      toast.success("Đã lưu danh mục");
      queryClient.invalidateQueries({ queryKey: ["CATEGORIES"] });
      resetCat();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });
  const deleteCat = useMutation({
    mutationFn: (id: string) => categoryApi.remove(id),
    onSuccess: () => {
      toast.success("Đã xoá");
      queryClient.invalidateQueries({ queryKey: ["CATEGORIES"] });
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });

  // ---- Tags ----
  const tagsQuery = useQuery({ queryKey: ["TAGS"], queryFn: tagApi.list });
  const [tagForm, setTagForm] = useState<{
    id?: string;
    name: string;
    slug: string;
    icon: string;
  }>({ name: "", slug: "", icon: "" });
  const resetTag = () => setTagForm({ name: "", slug: "", icon: "" });
  const saveTag = useMutation({
    mutationFn: () => {
      const body = {
        name: tagForm.name,
        slug: tagForm.slug || undefined,
        icon: tagForm.icon || null,
      };
      return tagForm.id ? tagApi.update(tagForm.id, body) : tagApi.create(body);
    },
    onSuccess: () => {
      toast.success("Đã lưu tag");
      queryClient.invalidateQueries({ queryKey: ["TAGS"] });
      resetTag();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });
  const deleteTag = useMutation({
    mutationFn: (id: string) => tagApi.remove(id),
    onSuccess: () => {
      toast.success("Đã xoá tag");
      queryClient.invalidateQueries({ queryKey: ["TAGS"] });
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });

  // ---- Departments ----
  const deptsQuery = useQuery({
    queryKey: ["DEPARTMENTS"],
    queryFn: departmentApi.list,
  });
  const [deptEdit, setDeptEdit] = useState<Record<string, string>>({});
  const [deptNameEdit, setDeptNameEdit] = useState<Record<string, string>>({});
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptKind, setNewDeptKind] = useState<"department" | "unit">(
    "department",
  );
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const invalidateDepts = () => {
    queryClient.invalidateQueries({ queryKey: ["DEPARTMENTS"] });
    queryClient.invalidateQueries({ queryKey: ["PAGE_LAYOUTS"] });
  };
  const saveDept = useMutation({
    mutationFn: ({ id, slug }: { id: string; slug: string }) =>
      departmentApi.update(id, { slug }),
    onSuccess: () => {
      toast.success("Đã đổi slug bộ môn");
      invalidateDepts();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });
  const renameDept = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      departmentApi.update(id, { name }),
    onSuccess: () => {
      toast.success("Đã đổi tên bộ môn");
      invalidateDepts();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });
  const createDept = useMutation({
    mutationFn: (body: { name: string; kind: "department" | "unit" }) =>
      departmentApi.create(body),
    onSuccess: () => {
      toast.success("Đã thêm đơn vị");
      setNewDeptName("");
      invalidateDepts();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });
  const setKind = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "department" | "unit" }) =>
      departmentApi.update(id, { kind }),
    onSuccess: () => {
      toast.success("Đã đổi phân loại");
      invalidateDepts();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });
  const mergeDept = useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) =>
      departmentApi.merge(id, targetId),
    onSuccess: () => {
      toast.success("Đã gộp & xoá bộ môn");
      invalidateDepts();
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Lỗi"),
  });

  const tabBtn = (key: TabKey, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-4 py-2 text-sm font-semibold rounded-lg ${
        tab === key
          ? "bg-blue-600 text-white"
          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );

  const input =
    "w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 bg-white dark:bg-[#1a2436]";

  return (
    <div className="h-full overflow-y-auto max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
        Quản lý Danh mục &amp; Tag
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Chỉ Super Admin. Danh mục tin tức, tag (chữ hoặc hình), và slug bộ môn.
      </p>

      <div className="flex gap-2 mb-6">
        {tabBtn("categories", "Danh mục")}
        {tabBtn("tags", "Tag")}
        {tabBtn("departments", "Bộ môn / Slug")}
      </div>

      {tab === "categories" ? (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <input
              className={input}
              placeholder="Tên (VI)"
              value={catForm.nameVi}
              onChange={(e) =>
                setCatForm((f) => ({ ...f, nameVi: e.target.value }))
              }
            />
            <input
              className={input}
              placeholder="Name (EN)"
              value={catForm.nameEn}
              onChange={(e) =>
                setCatForm((f) => ({ ...f, nameEn: e.target.value }))
              }
            />
            <input
              className={input}
              placeholder="slug"
              value={catForm.slug}
              onChange={(e) =>
                setCatForm((f) => ({ ...f, slug: e.target.value }))
              }
            />
            <div className="flex gap-2">
              <input
                className={input}
                placeholder="Ảnh (URL)"
                value={catForm.image}
                onChange={(e) =>
                  setCatForm((f) => ({ ...f, image: e.target.value }))
                }
              />
              <button
                type="button"
                onClick={() => setPickerFor("category")}
                className="px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg whitespace-nowrap"
              >
                Chọn ảnh
              </button>
            </div>
            <div className="col-span-2 flex gap-2">
              <button
                type="button"
                onClick={() => saveCat.mutate()}
                disabled={!catForm.nameVi || !catForm.slug}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg disabled:opacity-50"
              >
                {catForm.id ? "Cập nhật" : "Thêm"} danh mục
              </button>
              {catForm.id ? (
                <button
                  type="button"
                  onClick={resetCat}
                  className="px-4 py-2 text-sm text-slate-500"
                >
                  Huỷ
                </button>
              ) : null}
            </div>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            {(categoriesQuery.data ?? []).map((c: Category) => (
              <li
                key={c.id}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <span className="flex-1 truncate text-slate-700 dark:text-slate-200">
                  {c.name.vi}{" "}
                  <span className="text-[11px] text-slate-400 font-mono">
                    /{c.slug}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCatForm({
                      id: c.id,
                      slug: c.slug,
                      nameVi: c.name.vi,
                      nameEn: c.name.en ?? "",
                      image: c.image ?? "",
                    })
                  }
                  className="text-xs text-blue-600"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Xoá danh mục "${c.name.vi}"?`))
                      deleteCat.mutate(c.id);
                  }}
                  className="text-xs text-red-500"
                >
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "tags" ? (
        <section className="space-y-4">
          <div className="grid grid-cols-3 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <input
              className={input}
              placeholder="Tên tag"
              value={tagForm.name}
              onChange={(e) =>
                setTagForm((f) => ({ ...f, name: e.target.value }))
              }
            />
            <input
              className={input}
              placeholder="slug (tự sinh nếu trống)"
              value={tagForm.slug}
              onChange={(e) =>
                setTagForm((f) => ({ ...f, slug: e.target.value }))
              }
            />
            <div className="flex gap-2">
              <input
                className={input}
                placeholder="Icon: tên Material Symbol / URL ảnh"
                value={tagForm.icon}
                onChange={(e) =>
                  setTagForm((f) => ({ ...f, icon: e.target.value }))
                }
              />
              <button
                type="button"
                onClick={() => setPickerFor("tag")}
                className="px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg whitespace-nowrap"
              >
                Ảnh
              </button>
            </div>
            <div className="col-span-3 flex items-center gap-3">
              <TagIconPreview icon={tagForm.icon || null} />
              <button
                type="button"
                onClick={() => saveTag.mutate()}
                disabled={!tagForm.name}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg disabled:opacity-50"
              >
                {tagForm.id ? "Cập nhật" : "Thêm"} tag
              </button>
              {tagForm.id ? (
                <button
                  type="button"
                  onClick={resetTag}
                  className="px-4 py-2 text-sm text-slate-500"
                >
                  Huỷ
                </button>
              ) : null}
            </div>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            {(tagsQuery.data ?? []).map((t: Tag) => (
              <li
                key={t.id}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <TagIconPreview icon={t.icon} />
                <span className="flex-1 truncate text-slate-700 dark:text-slate-200">
                  {t.name}{" "}
                  <span className="text-[11px] text-slate-400 font-mono">
                    /{t.slug} · {t.postCount ?? 0} bài
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setTagForm({
                      id: t.id,
                      name: t.name,
                      slug: t.slug,
                      icon: t.icon ?? "",
                    })
                  }
                  className="text-xs text-blue-600"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Xoá tag "${t.name}"?`)) deleteTag.mutate(t.id);
                  }}
                  className="text-xs text-red-500"
                >
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "departments" ? (
        <section className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Quản lý bộ môn / đơn vị (vd thêm "Đoàn – Hội và CLB"). Đổi slug sẽ
            tự cập nhật slug các layout dưới bộ môn. "Gộp &amp; xoá" chuyển toàn
            bộ bài/ảnh/layout sang bộ môn khác rồi xoá bộ môn này.
          </p>

          {/* Thêm bộ môn / đơn vị mới */}
          <div className="flex items-center gap-2">
            <input
              className={`${input} flex-1`}
              placeholder="Tên bộ môn / đơn vị mới…"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
            />
            <select
              className={`${input} w-40`}
              value={newDeptKind}
              onChange={(e) =>
                setNewDeptKind(e.target.value as "department" | "unit")
              }
            >
              <option value="department">Bộ môn</option>
              <option value="unit">Đơn vị (Đoàn–Hội, CLB)</option>
            </select>
            <button
              type="button"
              disabled={!newDeptName.trim() || createDept.isPending}
              onClick={() =>
                createDept.mutate({
                  name: newDeptName.trim(),
                  kind: newDeptKind,
                })
              }
              className="px-3 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg disabled:opacity-40"
            >
              + Thêm
            </button>
          </div>

          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            {(deptsQuery.data ?? []).map((d: Department) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
              >
                <input
                  className={`${input} w-52`}
                  value={deptNameEdit[d.id] ?? d.name}
                  onChange={(e) =>
                    setDeptNameEdit((s) => ({ ...s, [d.id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    renameDept.mutate({
                      id: d.id,
                      name: (deptNameEdit[d.id] ?? d.name).trim(),
                    })
                  }
                  className="text-xs text-blue-600"
                >
                  Đổi tên
                </button>
                <input
                  className={`${input} flex-1 min-w-[120px]`}
                  value={deptEdit[d.id] ?? d.slug}
                  onChange={(e) =>
                    setDeptEdit((s) => ({ ...s, [d.id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    saveDept.mutate({
                      id: d.id,
                      slug: (deptEdit[d.id] ?? d.slug).trim(),
                    })
                  }
                  className="text-xs text-blue-600"
                >
                  Lưu slug
                </button>
                <select
                  className={`${input} w-32`}
                  value={d.kind}
                  onChange={(e) =>
                    setKind.mutate({
                      id: d.id,
                      kind: e.target.value as "department" | "unit",
                    })
                  }
                  title="Phân loại"
                >
                  <option value="department">Bộ môn</option>
                  <option value="unit">Đơn vị</option>
                </select>
                <select
                  className={`${input} w-36`}
                  value={mergeTarget[d.id] ?? ""}
                  onChange={(e) =>
                    setMergeTarget((s) => ({ ...s, [d.id]: e.target.value }))
                  }
                >
                  <option value="">Gộp vào…</option>
                  {(deptsQuery.data ?? [])
                    .filter((o) => o.id !== d.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!mergeTarget[d.id]}
                  onClick={() => {
                    const t = mergeTarget[d.id];
                    if (
                      t &&
                      confirm(
                        `Gộp "${d.name}" vào bộ môn đã chọn rồi XOÁ "${d.name}"? Toàn bộ bài/ảnh/layout sẽ chuyển sang bộ môn kia.`,
                      )
                    )
                      mergeDept.mutate({ id: d.id, targetId: t });
                  }}
                  className="text-xs text-red-600 disabled:opacity-40"
                >
                  Gộp &amp; xoá
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pickerFor ? (
        <MediaPickerModal
          onSelect={(url) => {
            if (pickerFor === "category")
              setCatForm((f) => ({ ...f, image: url }));
            else setTagForm((f) => ({ ...f, icon: url }));
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      ) : null}
    </div>
  );
}
