"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function useNhom() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/ho-tro/api/nhom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) {
        setErr(d.message ?? "Không lưu được");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setErr("Không kết nối được máy chủ");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, err };
}

const Err = ({ err }: { err: string | null }) =>
  err ? <p role="alert" className="rounded-2xl bg-[#f3dcd6] px-4 py-2 text-sm text-[#8a2e1e]">{err}</p> : null;

const inDark =
  "press-d min-w-0 rounded-full border-0 px-4 py-2.5 text-sm text-[var(--on-dark)] outline-none placeholder:text-[var(--on-dark-muted)] focus-visible:ring-[3px] focus-visible:ring-[var(--amber)]";
const inLight = "field rounded-full py-2.5 text-sm";

type Person = { email: string; name: string; department: string | null };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ô CHỌN NGƯỜI: gõ tên hoặc email → gợi ý từ danh bạ của Khoa (CMS) và những
 * người đã từng vào Physupport. Chọn một người là điền sẵn email + họ tên.
 * Người ngoài danh bạ: gõ đủ email rồi bấm "Dùng email này".
 */
function PersonPicker({ dark, value, onPick }: { dark?: boolean; value: Person | null; onPick: (p: Person | null) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value || q.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      setOpen(true);
      const r = await fetch(`/ho-tro/api/nhom/tim?q=${encodeURIComponent(q.trim())}`).catch(() => null);
      const d = r?.ok ? ((await r.json()) as { items: Person[] }) : { items: [] };
      setItems(d.items);
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, value]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  if (value) {
    return (
      <div
        className={
          (dark ? "press-d text-[var(--on-dark)]" : "press") +
          " flex min-w-0 flex-[3_1_14rem] items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-sm"
        }
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{value.name || "(chưa có họ tên)"}</span>
          <span className={dark ? "text-[var(--on-dark-muted)]" : "muted"}>
            {" "}
            · {value.email}
            {value.department ? ` · ${value.department}` : ""}
          </span>
        </span>
        <button
          type="button"
          aria-label="Chọn người khác"
          onClick={() => onPick(null)}
          className={(dark ? "raise-d" : "raise") + " tap h-7 w-7 flex-none rounded-full text-xs"}
        >
          ×
        </button>
      </div>
    );
  }

  const typed = q.trim();
  return (
    <div ref={box} className="relative min-w-0 flex-[3_1_14rem]">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => typed.length >= 2 && setOpen(true)}
        placeholder="Gõ tên hoặc email để tìm trong Khoa…"
        aria-label="Tìm người"
        aria-autocomplete="list"
        className={(dark ? inDark : inLight) + " w-full"}
      />
      {open && typed.length >= 2 ? (
        <ul
          role="listbox"
          className="raise absolute left-0 right-0 top-[calc(100%+6px)] z-30 flex max-h-72 flex-col gap-0.5 overflow-auto rounded-[20px] p-1.5 text-[var(--text)]"
        >
          {busy ? <li className="muted px-4 py-2 text-sm">Đang tìm…</li> : null}
          {items.map((p) => (
            <li key={p.email}>
              <button
                type="button"
                onClick={() => {
                  onPick(p);
                  setQ("");
                  setOpen(false);
                }}
                className="tap flex w-full flex-col rounded-[16px] px-4 py-2 text-left text-sm hover:bg-black/[.05]"
              >
                <span className="font-medium">{p.name}</span>
                <span className="muted text-xs">
                  {p.email}
                  {p.department ? ` · ${p.department}` : ""}
                </span>
              </button>
            </li>
          ))}
          {!busy && !items.length ? (
            <li className="muted px-4 py-2 text-sm">
              Không thấy trong danh bạ Khoa.{" "}
              {EMAIL_RE.test(typed) ? (
                <button
                  type="button"
                  onClick={() => {
                    onPick({ email: typed.toLowerCase(), name: "", department: null });
                    setQ("");
                    setOpen(false);
                  }}
                  className="font-medium text-[var(--text)] underline"
                >
                  Dùng email {typed}
                </button>
              ) : (
                "Gõ đủ email để thêm người ngoài danh bạ."
              )}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

export function AddTeam() {
  const { send, busy, err } = useNhom();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="raise-d tap flex min-h-[12rem] w-full flex-col items-center justify-center gap-2 rounded-[30px] border-2 border-dashed border-white/20 p-5 text-[var(--on-dark)]"
      >
        <span className="text-3xl leading-none">+</span>
        <span className="font-medium">Lập nhóm mới</span>
        <span className="max-w-[16rem] text-center text-xs font-light text-[var(--on-dark-muted)]">
          Vd: Cơ sở vật chất &amp; PTN, Giáo vụ – Đào tạo… Lập xong, gán loại yêu cầu cho nhóm ở trang Mẫu biểu.
        </span>
      </button>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await send({ action: "addTeam", name, description: desc })) {
          setOpen(false);
          setName("");
          setDesc("");
        }
      }}
      className="raise-d flex w-full flex-col gap-2 rounded-[30px] p-5"
    >
      <span className="text-lg font-medium text-[var(--on-dark)]">Lập nhóm mới</span>
      <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên nhóm, vd: Cơ sở vật chất & PTN" aria-label="Tên nhóm" className={inDark} />
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Phụ trách việc gì (không bắt buộc)" aria-label="Mô tả nhóm" className={inDark} />
      <Err err={err} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="raise-d tap rounded-full px-4 py-2 text-sm text-[var(--on-dark)]">
          Thôi
        </button>
        <button type="submit" disabled={busy} className="raise tap rounded-full px-4 py-2 text-sm font-medium text-[var(--text)]">
          Lập nhóm
        </button>
      </div>
    </form>
  );
}

export function AddMember({ teamId }: { teamId: string }) {
  const { send, busy, err } = useNhom();
  const [who, setWho] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [lead, setLead] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!who) return;
        if (await send({ action: "addMember", teamId, email: who.email, name: who.name || name || undefined, lead })) {
          setWho(null);
          setName("");
          setLead(false);
        }
      }}
      className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-3"
    >
      <div className="flex flex-wrap gap-2">
        <PersonPicker dark value={who} onPick={setWho} />
        {who && !who.name ? (
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Họ tên" aria-label="Họ tên" className={inDark + " flex-[2_1_10rem]"} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-[var(--on-dark-muted)]">
          <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} className="h-4 w-4 accent-[#e9b949]" />
          Trưởng nhóm
        </label>
        <button type="submit" disabled={busy || !who} className="raise tap rounded-full px-4 py-2 text-sm font-medium text-[var(--text)] disabled:opacity-50">
          + Thêm thành viên
        </button>
      </div>
      <Err err={err} />
    </form>
  );
}

export function MemberRow({
  teamId,
  email,
  name,
  lead,
  seen,
  edit,
}: {
  teamId: string;
  email: string;
  name: string;
  lead: boolean;
  seen: boolean;
  edit: boolean;
}) {
  const { send, busy, err } = useNhom();
  return (
    <li className="press-d flex flex-col gap-1 rounded-[18px] px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {name}
            {lead ? <span className="ml-2 rounded-full bg-[var(--amber)] px-2 py-0.5 text-[11px] text-[#22252a]">Trưởng nhóm</span> : null}
          </span>
          <span className="block truncate text-xs text-[var(--on-dark-muted)]">
            {email}
            {seen ? "" : " · chưa đăng nhập lần nào (chưa giao phiếu được)"}
          </span>
        </span>
        {edit ? (
          <span className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ action: "setLead", teamId, email, lead: !lead })}
              className="raise-d tap rounded-full px-3 py-1.5 text-xs text-[var(--on-dark)]"
            >
              {lead ? "Bỏ trưởng nhóm" : "Làm trưởng nhóm"}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={`Bỏ ${name} khỏi nhóm`}
              onClick={() => {
                if (window.confirm(`Bỏ ${name} khỏi nhóm? Phiếu đang giao cho họ vẫn giữ nguyên.`))
                  void send({ action: "removeMember", teamId, email });
              }}
              className="raise-d tap h-8 w-8 rounded-full text-sm text-[#f3c9a8]"
            >
              ×
            </button>
          </span>
        ) : null}
      </div>
      <Err err={err} />
    </li>
  );
}

const ROLE_LABEL: Record<string, string> = { ADMIN: "Quản trị hệ thống", BOARD: "Ban Chủ nhiệm" };

export function RoleRow({ email, name, role, edit, self }: { email: string; name: string; role: string; edit: boolean; self: boolean }) {
  const { send, busy, err } = useNhom();
  return (
    <li className="press flex flex-col gap-1 rounded-[18px] px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="muted block truncate text-xs">{email}</span>
        </span>
        <span className={"rounded-full px-3 py-1 text-xs font-medium " + (role === "BOARD" ? "bg-[#dde8ee] text-[#2c4a58]" : "bg-[#3b4040] text-[#f1f0ec]")}>
          {ROLE_LABEL[role] ?? role}
        </span>
        {edit && !self ? (
          <button
            type="button"
            disabled={busy}
            aria-label={`Gỡ vai trò của ${name}`}
            onClick={() => {
              if (window.confirm(`Gỡ vai trò ${ROLE_LABEL[role]} của ${name}?`)) void send({ action: "removeRole", email });
            }}
            className="raise tap h-8 w-8 rounded-full text-sm"
          >
            ×
          </button>
        ) : null}
      </div>
      <Err err={err} />
    </li>
  );
}

export function AddRole() {
  const { send, busy, err } = useNhom();
  const [who, setWho] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "BOARD">("BOARD");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!who) return;
        if (await send({ action: "addRole", email: who.email, name: who.name || name || undefined, role })) {
          setWho(null);
          setName("");
        }
      }}
      className="flex flex-col gap-2 border-t border-[var(--line)] pt-3"
    >
      <div className="flex flex-wrap gap-2">
        <PersonPicker value={who} onPick={setWho} />
        {who && !who.name ? (
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Họ tên" aria-label="Họ tên" className={inLight + " flex-[2_1_10rem]"} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "BOARD")} aria-label="Vai trò" className="field w-auto rounded-full py-2 text-sm">
          <option value="BOARD">Ban Chủ nhiệm Khoa</option>
          <option value="ADMIN">Quản trị hệ thống</option>
        </select>
        <button type="submit" disabled={busy || !who} className="btn btn-primary py-2 text-sm">
          + Gán vai trò
        </button>
      </div>
      <Err err={err} />
    </form>
  );
}
