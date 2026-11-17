"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Notice } from "@/lib/settings";

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`;
};

/**
 * Dải thông báo sự cố đầu trang. Người được quyền (quản trị, trưởng nhóm) sửa
 * ngay tại chỗ: bấm "Đặt thông báo" → gõ → Lưu. Không có trang cài đặt riêng
 * vì lúc có sự cố, càng ít bước càng tốt.
 */
export function NoticeBar({ notice, canEdit }: { notice: Notice | null; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(notice?.message ?? "");
  const [level, setLevel] = useState<"warn" | "info">(notice?.level ?? "warn");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(message: string | null) {
    setBusy(true);
    setErr(null);
    const r = await fetch("/ho-tro/api/thong-bao", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, level }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr("Không lưu được");
    setEditing(false);
    if (!message) setMsg("");
    router.refresh();
  }

  if (!notice && !canEdit) return null;

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(msg.trim() || null);
        }}
        className="raise mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-[26px] p-2 sm:mx-[26px]"
      >
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as "warn" | "info")}
          aria-label="Loại thông báo"
          className="field w-auto rounded-full py-2 text-sm"
        >
          <option value="warn">Đang có sự cố</option>
          <option value="info">Thông tin</option>
        </select>
        <input
          autoFocus
          value={msg}
          maxLength={300}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Vd: Web Khoa đang chậm, nhóm Kỹ thuật đã biết và đang xử lý — dự kiến xong trước 15:00."
          aria-label="Nội dung thông báo"
          className="field min-w-[16rem] flex-1 rounded-full py-2 text-sm"
        />
        <button type="submit" disabled={busy} className="btn btn-primary py-2 text-sm">
          Lưu
        </button>
        <button type="button" onClick={() => setEditing(false)} className="btn btn-ghost py-2 text-sm">
          Thôi
        </button>
        {err ? <span className="text-sm text-[#8a2e1e]">{err}</span> : null}
      </form>
    );
  }

  if (!notice) {
    return (
      <div className="mx-4 mb-1 flex justify-end sm:mx-[26px]">
        <button type="button" onClick={() => setEditing(true)} className="muted tap rounded-full px-3 py-1 text-xs hover:underline">
          + Đặt thông báo sự cố chung
        </button>
      </div>
    );
  }

  const warn = notice.level === "warn";
  return (
    <div
      role="status"
      className={
        "mx-4 mb-2 flex flex-wrap items-center gap-3 rounded-[22px] px-5 py-3 text-sm sm:mx-[26px] " +
        (warn ? "bg-[#f6e3b0] text-[#5e4300]" : "bg-[#dde8ee] text-[#2c4a58]")
      }
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 flex-none rounded-full"
        style={{ background: warn ? "#e9b949" : "#9cc3d5", boxShadow: warn ? "0 0 10px #e9b949" : "none" }}
      />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{warn ? "Đang có sự cố: " : "Thông báo: "}</span>
        {notice.message}
        <span className="opacity-70">
          {" "}
          · {notice.byName}, {ago(notice.at)}
        </span>
        {warn ? <span className="block text-xs opacity-80">Không cần gửi thêm phiếu cho việc này — xong sẽ có thông báo tại đây.</span> : null}
      </span>
      {canEdit ? (
        <span className="flex gap-1.5">
          <button type="button" onClick={() => setEditing(true)} className="tap rounded-full bg-white/50 px-3 py-1 text-xs">
            Sửa
          </button>
          <button type="button" disabled={busy} onClick={() => void save(null)} className="tap rounded-full bg-white/50 px-3 py-1 text-xs">
            Gỡ
          </button>
        </span>
      ) : null}
    </div>
  );
}
