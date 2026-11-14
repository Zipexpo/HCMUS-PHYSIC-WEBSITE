"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_TAG_LIGHT } from "@/lib/labels";
import type { TicketStatus } from "@/generated/prisma/enums";

type Priority = keyof typeof PRIORITY_LABEL;

export type QueueRow = {
  id: string;
  code: string;
  title: string;
  reporter: string;
  form: string;
  system: string;
  priority: Priority;
  status: TicketStatus;
  assignee: string | null;
  /** "3 giờ", "chờ người gửi", "—" */
  wait: string;
  late: boolean;
};

const PR_LEVEL: Record<Priority, number> = { LOW: 1, NORMAL: 2, HIGH: 3, URGENT: 4 };

function PrioDots({ p }: { p: Priority }) {
  const n = PR_LEVEL[p];
  const hot = p === "URGENT" ? "#d2553e" : p === "HIGH" ? "#e9b949" : "#4b5050";
  return (
    <span role="img" aria-label={`Mức độ ${PRIORITY_LABEL[p].toLowerCase()}`} className="flex gap-1">
      {[1, 2, 3, 4].map((k) => (
        <span
          key={k}
          className="h-2.5 w-2.5 rounded-full"
          style={{
            background: k <= n ? hot : "transparent",
            boxShadow: k <= n ? "inset 0 1px 0 rgba(255,255,255,.4), 0 1px 3px rgba(0,0,0,.35)" : "inset 0 1px 3px rgba(0,0,0,.25)",
          }}
        />
      ))}
    </span>
  );
}

/**
 * Danh sách hàng đợi: chọn nhiều phiếu rồi giao / đổi trạng thái / đổi mức độ
 * một lượt. Thao tác hàng loạt gọi lại đúng API từng phiếu, nên quyền và nhật
 * ký giống hệt khi sửa tay từng phiếu.
 */
export function QueueList({
  groups,
  staff,
  meId,
}: {
  groups: { label: string; rows: QueueRow[] }[];
  staff: { userId: string; name: string }[];
  meId: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function bulk(payload: Record<string, unknown>, what: string) {
    if (!sel.size) return;
    setBusy(true);
    setMsg(null);
    let ok = 0;
    for (const id of sel) {
      const r = await fetch(`/ho-tro/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (r?.ok) ok++;
    }
    setBusy(false);
    setMsg(ok === sel.size ? `Đã ${what} ${ok} phiếu.` : `Đã ${what} ${ok}/${sel.size} phiếu — số còn lại không đổi được.`);
    setSel(new Set());
    router.refresh();
  }

  const selCls = "press-d rounded-full border-0 px-4 py-2.5 text-sm text-[var(--on-dark)] outline-none";

  return (
    <div className="flex flex-col gap-4">
      {sel.size ? (
        <div className="raise-d sticky top-3 z-10 flex flex-wrap items-center gap-2.5 rounded-[26px] px-5 py-3 text-[var(--on-dark)]">
          <span className="mr-2 font-medium">{sel.size} phiếu đã chọn</span>
          <select
            aria-label="Giao cho"
            disabled={busy}
            className={selCls}
            value=""
            onChange={(e) => void bulk({ assign: e.target.value === meId ? "me" : e.target.value }, "giao")}
          >
            <option value="" disabled>
              Giao cho ⌄
            </option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
                {s.userId === meId ? " (tôi)" : ""}
              </option>
            ))}
            <option value="">— Bỏ phân công —</option>
          </select>
          <select
            aria-label="Đổi trạng thái"
            disabled={busy}
            className={selCls}
            value=""
            onChange={(e) => void bulk({ status: e.target.value }, "đổi trạng thái")}
          >
            <option value="" disabled>
              Đổi trạng thái ⌄
            </option>
            {(["ACKNOWLEDGED", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED", "REJECTED"] as TicketStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Đổi mức độ"
            disabled={busy}
            className={selCls}
            value=""
            onChange={(e) => void bulk({ priority: e.target.value }, "đổi mức độ")}
          >
            <option value="" disabled>
              Đổi mức độ ⌄
            </option>
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setSel(new Set())} className="raise tap ml-auto rounded-full px-4 py-2.5 text-sm font-medium text-[var(--text)]">
            Bỏ chọn
          </button>
        </div>
      ) : null}
      {msg ? (
        <p role="status" className="press rounded-full px-5 py-2.5 text-sm">
          {msg}
        </p>
      ) : null}

      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="raise flex flex-col gap-1 rounded-[30px] p-3">
          <h2 className="flex items-center justify-between px-3 pb-1 pt-2 text-[15px] font-medium">
            <span>{g.label}</span>
            <span className="muted text-[13px] font-normal">{g.rows.length} phiếu</span>
          </h2>
          {g.rows.map((r) => {
            const on = sel.has(r.id);
            const tag = STATUS_TAG_LIGHT[r.status];
            return (
              <div
                key={r.id}
                className={
                  (on ? "press " : "hover:bg-black/[.03] ") +
                  "grid items-center gap-x-4 gap-y-1 rounded-[20px] px-3 py-3 [grid-template-columns:auto_auto_1fr] lg:[grid-template-columns:auto_5.2rem_minmax(0,1fr)_10rem_4rem_7.5rem_8rem_6rem]"
                }
              >
                <input
                  type="checkbox"
                  aria-label={`Chọn ${r.code}`}
                  checked={on}
                  onChange={() => toggle(r.id)}
                  className="h-[18px] w-[18px] accent-[#3b4040]"
                />
                <Link href={`/phieu/${r.id}`} className="font-mono text-[13px] font-semibold hover:underline">
                  {r.code}
                </Link>
                <Link href={`/phieu/${r.id}`} className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{r.title}</span>
                  <span className="muted truncate text-[13px] font-light">{r.reporter}</span>
                </Link>
                <span className="col-start-3 flex min-w-0 flex-col text-[13px] lg:col-auto">
                  <span className="truncate">{r.form}</span>
                  <span className="muted truncate text-xs">{r.system}</span>
                </span>
                <span className="col-start-3 lg:col-auto">
                  <PrioDots p={r.priority} />
                </span>
                <span className="col-start-3 lg:col-auto">
                  <span className="inline-flex rounded-full px-3 py-1 text-xs font-medium" style={{ background: tag.bg, color: tag.fg }}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </span>
                <span
                  className={"col-start-3 truncate text-[13px] lg:col-auto " + (r.assignee ? "" : "font-medium text-[#a1301f]")}
                >
                  {r.assignee ?? "Chưa ai nhận"}
                </span>
                <span className={"col-start-3 text-[13px] lg:col-auto lg:text-right " + (r.late ? "font-semibold text-[#a1301f]" : "muted")}>
                  {r.wait}
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

type Saved = { name: string; q: string };
const KEY = "ticket.savedFilters";

/** Bộ lọc đã lưu — riêng từng máy, trong localStorage. Bộ lọc là tham số URL nên lưu nguyên chuỗi truy vấn. */
export function SavedFilters({ current, label }: { current: string; label: string }) {
  const [list, setList] = useState<Saved[]>([]);
  useEffect(() => {
    try {
      setList(JSON.parse(localStorage.getItem(KEY) ?? "[]") as Saved[]);
    } catch {
      setList([]);
    }
  }, []);
  const save = (next: Saved[]) => {
    setList(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* chế độ riêng tư: chỉ giữ trong phiên */
    }
  };
  return (
    <div className="raise flex flex-col gap-2 rounded-[26px] p-4">
      <span className="muted px-1 text-[13px]">Bộ lọc đã lưu</span>
      {list.map((s) => (
        <span key={s.q} className="press flex items-center gap-1 rounded-full py-1 pl-4 pr-1 text-[13px]">
          <Link scroll={false} href={`/phieu${s.q ? `?${s.q}` : ""}`} className="min-w-0 flex-1 truncate py-1 hover:underline">
            {s.name}
          </Link>
          <button
            type="button"
            aria-label={`Xoá bộ lọc ${s.name}`}
            onClick={() => save(list.filter((x) => x.q !== s.q))}
            className="tap flex h-6 w-6 items-center justify-center rounded-full text-xs"
          >
            ×
          </button>
        </span>
      ))}
      {list.length ? null : <span className="muted px-1 text-xs font-light">Chưa có. Lọc xong bấm lưu để lần sau mở lại bằng một cú bấm.</span>}
      <button
        type="button"
        disabled={!current || list.some((x) => x.q === current)}
        onClick={() => {
          const name = window.prompt("Đặt tên cho bộ lọc này", label)?.trim();
          if (name) save([...list, { name: name.slice(0, 60), q: current }]);
        }}
        className="raise tap rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-50"
      >
        + Lưu bộ lọc hiện tại
      </button>
    </div>
  );
}

/**
 * Nút lọc thả xuống ("Loại ⌄"). Mỗi lựa chọn là một đường link — bộ lọc nằm
 * trên URL, nên dán link cho đồng nghiệp hay bấm Quay lại đều giữ nguyên.
 * Bấm ra ngoài hoặc Esc thì đóng.
 */
export function FilterMenu({
  label,
  options,
  plain,
}: {
  label: string;
  options: { label: string; href: string; on: boolean; n?: number }[];
  /** Nhãn đã nói lựa chọn hiện tại (sắp xếp, số dòng) — không ghép thêm, không tô đậm. */
  plain?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const picked = options.find((o) => o.on && o.href);
  const active = plain ? undefined : picked;
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary
        className={
          "tap flex cursor-pointer list-none items-center gap-1.5 rounded-full px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden " +
          (active && !active.label.startsWith("Mọi") ? "raise-d font-medium text-[var(--on-dark)]" : "raise")
        }
      >
        {active && !active.label.startsWith("Mọi") ? `${label}: ${active.label}` : label}
        <span aria-hidden className="text-xs opacity-70">⌄</span>
      </summary>
      <div className="raise absolute left-0 top-[calc(100%+6px)] z-20 flex max-h-80 min-w-[14rem] flex-col gap-0.5 overflow-auto rounded-[22px] p-1.5">
        {options.map((o) => (
          <Link scroll={false}
            key={o.label}
            href={o.href}
            onClick={() => {
              if (ref.current) ref.current.open = false;
            }}
            aria-current={o.on ? "true" : undefined}
            className={"tap flex items-center justify-between gap-3 rounded-full px-4 py-2 text-sm " + (o.on ? "press font-medium" : "hover:bg-black/[.04]")}
          >
            <span className="truncate">{o.label}</span>
            {o.n !== undefined ? <span className="muted font-mono text-xs">{o.n}</span> : null}
          </Link>
        ))}
      </div>
    </details>
  );
}
