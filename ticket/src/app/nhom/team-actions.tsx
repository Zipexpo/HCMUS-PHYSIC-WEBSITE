"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

export function AddTeam() {
  const { send, busy, err } = useNhom();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="raise tap h-12 rounded-full px-5 font-medium">
        + Lập nhóm mới
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
      className="raise flex w-full max-w-xl flex-col gap-2 rounded-[26px] p-4"
    >
      <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên nhóm, vd: Cơ sở vật chất & PTN" className={inLight} />
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Phụ trách việc gì (không bắt buộc)" className={inLight} />
      <Err err={err} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost py-2">Thôi</button>
        <button type="submit" disabled={busy} className="btn btn-primary py-2">Lập nhóm</button>
      </div>
    </form>
  );
}

export function AddMember({ teamId }: { teamId: string }) {
  const { send, busy, err } = useNhom();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [lead, setLead] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await send({ action: "addMember", teamId, email, name: name || undefined, lead })) {
          setEmail("");
          setName("");
          setLead(false);
        }
      }}
      className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-3"
    >
      <div className="flex flex-wrap gap-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@hcmus.edu.vn" aria-label="Email thành viên" className={inDark + " flex-[2_1_10rem]"} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Họ tên (nếu chưa từng vào)" aria-label="Họ tên" className={inDark + " flex-[2_1_10rem]"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-[var(--on-dark-muted)]">
          <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} className="h-4 w-4 accent-[#e9b949]" />
          Trưởng nhóm
        </label>
        <button type="submit" disabled={busy} className="raise tap rounded-full px-4 py-2 text-sm font-medium text-[var(--text)]">
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
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "BOARD">("BOARD");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await send({ action: "addRole", email, name: name || undefined, role })) {
          setEmail("");
          setName("");
        }
      }}
      className="flex flex-col gap-2 border-t border-[var(--line)] pt-3"
    >
      <div className="flex flex-wrap gap-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@hcmus.edu.vn" aria-label="Email" className={inLight + " flex-[2_1_10rem]"} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Họ tên (nếu chưa từng vào)" aria-label="Họ tên" className={inLight + " flex-[2_1_10rem]"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "BOARD")} aria-label="Vai trò" className="field w-auto rounded-full py-2 text-sm">
          <option value="BOARD">Ban Chủ nhiệm Khoa</option>
          <option value="ADMIN">Quản trị hệ thống</option>
        </select>
        <button type="submit" disabled={busy} className="btn btn-primary py-2 text-sm">+ Gán vai trò</button>
      </div>
      <Err err={err} />
    </form>
  );
}
