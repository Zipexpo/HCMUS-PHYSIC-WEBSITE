"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useState } from "react";
import { toast } from "react-toastify";
import { PlusIcon } from "@/components/admin/icons";
import { adminApi, resolveMediaUrl } from "@/lib/api";
import { MediaPickerModal } from "@/views/admin/widgets-layout/fields/media-picker-modal";

/**
 * Quản lý THƯ VIỆN ảnh nền hero — admin thêm/xoá ảnh, giảng viên chọn ở
 * phys-profile (cạnh các màu đơn sắc). Ảnh lấy từ kho media.
 */
export function HeroBackgroundsManager() {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: bgs = [], isLoading } = useQuery({
    queryKey: ["HERO_BG"],
    queryFn: adminApi.listHeroBackgrounds,
  });

  const addMut = useMutation({
    mutationFn: (url: string) => adminApi.addHeroBackground({ url }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["HERO_BG"] });
      toast.success("Đã thêm ảnh nền");
    },
    onError: (e: { message?: string }) =>
      toast.error(e.message || "Thêm ảnh thất bại"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => adminApi.removeHeroBackground(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["HERO_BG"] }),
    onError: (e: { message?: string }) =>
      toast.error(e.message || "Xoá thất bại"),
  });

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101622] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Ảnh nền hero
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-xl">
            Thư viện ảnh nền cho hero trang cá nhân. Giảng viên chọn từ đây (hoặc
            màu đơn sắc) trong phys-profile. Thêm bao nhiêu ảnh tuỳ ý.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-sm font-semibold"
        >
          <PlusIcon className="w-4 h-4" />
          Thêm ảnh
        </button>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Đang tải…</p>
      ) : bgs.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Chưa có ảnh nền nào. Bấm “Thêm ảnh” để chọn từ kho media.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {bgs.map((bg) => (
            <div
              key={bg.id}
              className="group relative aspect-video overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800"
            >
              <Image
                src={resolveMediaUrl(bg.url)}
                alt={bg.name ?? ""}
                fill
                sizes="200px"
                unoptimized
                className="object-cover"
              />
              <button
                type="button"
                aria-label="Xoá ảnh nền"
                onClick={() => delMut.mutate(bg.id)}
                disabled={delMut.isPending}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-sm leading-none opacity-0 group-hover:opacity-100 transition hover:bg-rose-600 flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {pickerOpen && (
        <MediaPickerModal
          onSelect={(url) => {
            addMut.mutate(url);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
