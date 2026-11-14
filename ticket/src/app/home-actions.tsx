"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Hai nút trên dải "đã xử lý xong" ở trang chủ: mở lại hoặc đóng phiếu. */
export function ResolvedButtons({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function set(status: "IN_PROGRESS" | "CLOSED") {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/ho-tro/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr("Không thực hiện được, thử lại sau.");
    router.refresh();
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2.5">
        <button type="button" disabled={busy} onClick={() => void set("IN_PROGRESS")} className="raise tap h-[50px] rounded-full px-5 font-medium disabled:opacity-50">
          Vẫn còn lỗi
        </button>
        <button type="button" disabled={busy} onClick={() => void set("CLOSED")} className="raise-d tap h-[50px] rounded-full px-5 font-medium text-[var(--on-dark)] disabled:opacity-50">
          Đã ổn, đóng phiếu
        </button>
      </div>
      {err ? <p role="alert" className="text-sm text-[#8a2e1e]">{err}</p> : null}
    </div>
  );
}
