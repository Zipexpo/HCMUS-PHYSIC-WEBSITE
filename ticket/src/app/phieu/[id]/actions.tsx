"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/labels";
import { ArrowUpRight } from "@/components/ui";

type Status = keyof typeof STATUS_LABEL;
type Priority = keyof typeof PRIORITY_LABEL;

const base = (id: string) => `/ho-tro/api/tickets/${id}`;

/** Gọi API rồi làm mới trang ở máy chủ; giữ trạng thái bận/lỗi dùng chung. */
function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string, init: RequestInit): Promise<Response | null> {
    try {
      const res = await fetch(path, init);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setErr(d.message ?? "Không thực hiện được");
        return null;
      }
      return res;
    } catch {
      setErr("Không kết nối được máy chủ");
      return null;
    }
  }

  async function send(path: string, payload: unknown, method = "PATCH", refresh = true) {
    setBusy(true);
    setErr(null);
    try {
      const r = await call(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r && refresh) router.refresh();
      return !!r;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Trả lời kèm tệp: tải từng tệp lên trước, rồi gửi lời trả lời mang theo id
   * của chúng — để tệp gắn đúng vào tin nhắn trong dòng trao đổi.
   */
  async function reply(ticketId: string, body: string, isInternal: boolean, files: File[]) {
    setBusy(true);
    setErr(null);
    try {
      const ids: string[] = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await call(`${base(ticketId)}/attachments`, { method: "POST", body: fd });
        if (!r) return false;
        ids.push(((await r.json()) as { id: string }).id);
      }
      const r = await call(`${base(ticketId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, isInternal, attachmentIds: ids }),
      });
      return !!r;
    } finally {
      setBusy(false);
    }
  }

  return { send, reply, busy, err, setErr, refresh: () => router.refresh() };
}

function ErrorLine({ err }: { err: string | null }) {
  return err ? (
    <p role="alert" className="rounded-2xl bg-[#f3dcd6] px-4 py-2.5 text-sm text-[#8a2e1e]">
      {err}
    </p>
  ) : null;
}

const OK_TYPES = ["image/png", "image/jpeg", "application/pdf"];
const MAX = 10 * 1024 * 1024;

/** Chọn tệp đính kèm: nút + danh sách đã chọn. Kiểm sơ bộ ở trình duyệt; máy chủ kiểm lại thật. */
function useFiles(setErr: (e: string | null) => void) {
  const [files, setFiles] = useState<File[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (!OK_TYPES.includes(f.type)) setErr(`"${f.name}": chỉ nhận PNG, JPG hoặc PDF`);
      else if (f.size > MAX) setErr(`"${f.name}" lớn hơn 10 MB`);
      else ok.push(f);
    }
    setFiles((cur) => [...cur, ...ok].slice(0, 10));
  };
  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,application/pdf"
      multiple
      hidden
      onChange={(e) => {
        add(e.target.files);
        e.target.value = "";
      }}
    />
  );
  const list = files.length ? (
    <ul className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <li key={`${f.name}${i}`} className="press inline-flex items-center gap-2 rounded-full py-1 pl-3.5 pr-1 text-xs text-[var(--text)]">
          {f.name}
          <button
            type="button"
            aria-label={`Bỏ ${f.name}`}
            onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
            className="raise tap flex h-6 w-6 items-center justify-center rounded-full"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  ) : null;
  return { files, clear: () => setFiles([]), open: () => input.current?.click(), add, picker, list };
}

/** Nút chính kiểu viên thuốc + núm hổ phách. */
function KnobButton({
  children,
  dark,
  disabled,
  type = "button",
  onClick,
}: {
  children: React.ReactNode;
  dark?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={
        (dark ? "raise-d text-[var(--on-dark)]" : "raise text-[var(--text)]") +
        " tap inline-flex h-[52px] items-center gap-3.5 rounded-full pl-6 pr-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {children}
      <span className="knob flex h-[38px] w-[38px] items-center justify-center rounded-full text-[#22252a]">
        <ArrowUpRight size={16} />
      </span>
    </button>
  );
}

// ═════════════════════════════ PHÍA NGƯỜI GỬI ══════════════════════════════

export function CloseTicket({ ticketId }: { ticketId: string }) {
  const { send, busy, err } = useSend();
  const [ask, setAsk] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      {ask ? (
        <span className="raise flex items-center gap-2 rounded-full p-1.5 pl-4 text-sm">
          Đóng phiếu này?
          <button type="button" disabled={busy} onClick={() => void send(base(ticketId), { status: "CLOSED" })} className="btn btn-primary py-2">
            Đóng
          </button>
          <button type="button" onClick={() => setAsk(false)} className="btn btn-ghost py-2">
            Thôi
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setAsk(true)} className="raise tap h-[54px] rounded-full px-5 font-medium">
          Đóng phiếu
        </button>
      )}
      <ErrorLine err={err} />
    </div>
  );
}

/** Phiếu đang chờ người gửi: ô trả lời nằm ngay trên dải tối, không bắt cuộn tìm. */
export function WaitingReply({ ticketId, assigneeName }: { ticketId: string; assigneeName: string | null }) {
  const { reply, busy, err, setErr, refresh } = useSend();
  const [body, setBody] = useState("");
  const f = useFiles(setErr);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setErr("Chưa nhập nội dung bổ sung");
    if (await reply(ticketId, body, false, f.files)) {
      setBody("");
      f.clear();
      refresh();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" aria-labelledby="need-h">
      <h2 id="need-h" className="flex items-center gap-3 text-[21px] font-medium">
        <span className="knob h-3.5 w-3.5 rounded-full" />
        Cần thầy/cô bổ sung để tiếp tục
      </h2>
      <p className="font-light text-[var(--on-dark-muted)]">
        Phiếu tạm dừng tới khi thầy/cô trả lời. Gửi xong, phiếu tự quay về{" "}
        <span className="font-medium text-[var(--on-dark)]">Đang xử lý</span>.
      </p>
      <label htmlFor="reply" className="sr-only">
        Nội dung bổ sung
      </label>
      <textarea
        id="reply"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(e) => {
          const imgs = Array.from(e.clipboardData.files);
          if (imgs.length) f.add(imgs);
        }}
        placeholder={`Trả lời ${assigneeName ?? "người xử lý"}…`}
        className="press-d resize-y rounded-3xl border-0 px-5 py-4 text-[var(--on-dark)] outline-none placeholder:text-[var(--on-dark-muted)] focus-visible:ring-[3px] focus-visible:ring-[var(--amber)]"
      />
      {f.list}
      <div className="flex flex-wrap justify-between gap-3">
        {f.picker}
        <button type="button" onClick={f.open} className="raise-d tap h-[52px] rounded-full px-5 font-medium text-[var(--on-dark)]">
          + Đính kèm ảnh
        </button>
        <KnobButton type="submit" disabled={busy}>
          {busy ? "Đang gửi…" : "Gửi bổ sung"}
        </KnobButton>
      </div>
      <ErrorLine err={err} />
    </form>
  );
}

/** Phiếu đã xong: người gửi xác nhận, hoặc mở lại khi vẫn còn lỗi. */
export function ResolvedChoice({ ticketId, days, resolvedAt }: { ticketId: string; days: number; resolvedAt: string | null }) {
  const { send, busy, err } = useSend();
  const left = resolvedAt
    ? Math.max(0, days - Math.floor((Date.now() - new Date(resolvedAt).getTime()) / 86_400_000))
    : days;
  return (
    <div className="flex flex-col gap-3.5">
      <h2 className="flex items-center gap-3 text-[21px] font-medium">
        <span className="h-3.5 w-3.5 rounded-full bg-[#8fe3b8] shadow-[0_0_12px_#8fe3b8]" />
        Đã xử lý xong — thầy/cô kiểm tra lại giúp
      </h2>
      <p className="font-light text-[var(--on-dark-muted)]">
        Còn lỗi thì bấm <span className="font-medium text-[var(--on-dark)]">Vẫn còn lỗi</span>, phiếu quay lại người xử lý. Không phản hồi thì sau{" "}
        {left} ngày phiếu tự đóng.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(base(ticketId), { status: "IN_PROGRESS" })}
          className="raise-d tap h-[52px] rounded-full px-5 font-medium text-[var(--on-dark)]"
        >
          Vẫn còn lỗi
        </button>
        <KnobButton disabled={busy} onClick={() => void send(base(ticketId), { status: "CLOSED" })}>
          Đã ổn, đóng phiếu
        </KnobButton>
      </div>
      <ErrorLine err={err} />
    </div>
  );
}

export function NotifyToggle({ ticketId, on }: { ticketId: string; on: boolean }) {
  const { send, busy, err } = useSend();
  const [v, setV] = useState(on);
  return (
    <div className="flex flex-col gap-2">
      <label className="raise flex cursor-pointer items-center gap-3 rounded-[26px] px-5 py-4 text-sm">
        <input
          type="checkbox"
          checked={v}
          disabled={busy}
          onChange={async (e) => {
            const next = e.target.checked;
            setV(next);
            if (!(await send(base(ticketId), { notifyEmail: next }, "PATCH", false))) setV(!next);
          }}
          className="m-0 h-5 w-5 accent-[#3b4040]"
        />
        Email cho tôi khi có trả lời mới
      </label>
      <ErrorLine err={err} />
    </div>
  );
}

// ═════════════════════════════ PHÍA NGƯỜI XỬ LÝ ════════════════════════════

const STATUSES: { s: Status; label: string; note?: string; led: string }[] = [
  { s: "ACKNOWLEDGED", label: "Đã tiếp nhận", led: "#f1ede4" },
  { s: "IN_PROGRESS", label: "Đang xử lý", led: "#7fcbb4" },
  { s: "WAITING", label: "Chờ bổ sung", note: "phiếu tạm dừng", led: "#e9b949" },
  { s: "RESOLVED", label: "Đã xong", note: "chờ xác nhận", led: "#8fe3b8" },
  { s: "CLOSED", label: "Đóng", led: "#b9bcb9" },
  { s: "REJECTED", label: "Không xử lý", note: "cần lý do", led: "#f08c76" },
];

export function StaffStatus({ ticketId, status, locked }: { ticketId: string; status: Status; locked?: boolean }) {
  const { send, busy, err } = useSend();
  return (
    <div className="raise-d flex min-w-0 flex-[999_1_560px] flex-col gap-4 rounded-[34px] p-6">
      <h2 className="text-lg font-medium">Trạng thái</h2>
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {STATUSES.map((x) => {
          const on = x.s === status;
          return (
            <button
              key={x.s}
              type="button"
              aria-pressed={on}
              // Chờ duyệt: chỉ còn Đóng / Không xử lý — chưa được bắt tay làm.
              disabled={busy || on || (locked && x.s !== "CLOSED" && x.s !== "REJECTED")}
              onClick={() => void send(base(ticketId), { status: x.s })}
              className={
                (on ? "press-d font-semibold" : "raise-d hover:-translate-y-0.5") +
                " tap flex items-center gap-3 rounded-[22px] px-4 py-3.5 text-left text-[var(--on-dark)] transition-transform disabled:cursor-default"
              }
            >
              <span
                className="h-3 w-3 flex-none rounded-full"
                style={{
                  background: on ? x.led : "#2f3333",
                  boxShadow: on ? `0 0 12px ${x.led}, 0 0 2px ${x.led}` : "inset 0 1px 2px rgba(0,0,0,.6)",
                }}
              />
              <span className="flex flex-col leading-tight">
                <span>{x.label}</span>
                {x.note ? <span className="text-xs font-light text-[var(--on-dark-muted)]">{x.note}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {status === "NEW" ? (
        <p className="text-sm font-light text-[var(--on-dark-muted)]">Phiếu mới gửi, chưa ai tiếp nhận.</p>
      ) : null}
      <ErrorLine err={err} />
    </div>
  );
}

export function StaffMeta({
  ticketId,
  priority,
  assigneeUserId,
  assigneeName,
  me,
  staff,
  team,
  teams,
  canAssign,
  locked,
}: {
  ticketId: string;
  priority: Priority;
  assigneeUserId: string | null;
  assigneeName: string | null;
  me: { id: string; name: string };
  staff: { userId: string; name: string }[];
  team: string | null;
  teams: string[];
  /** Trưởng nhóm / quản trị: giao cho người khác, chuyển nhóm. */
  canAssign: boolean;
  /** Đang chờ duyệt: chưa được nhận phiếu. */
  locked?: boolean;
}) {
  const { send, busy, err } = useSend();
  const url = base(ticketId);
  // Người đang nhận có thể chưa có trong sổ (phiếu cũ) — vẫn phải hiện tên.
  const people = [...staff];
  if (!people.some((p) => p.userId === me.id)) people.unshift({ userId: me.id, name: me.name });
  if (assigneeUserId && assigneeName && !people.some((p) => p.userId === assigneeUserId)) {
    people.push({ userId: assigneeUserId, name: assigneeName });
  }
  const sel = "press-d w-full rounded-full border-0 px-4 py-3 text-[var(--on-dark)] outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--amber)]";

  return (
    <div className="raise-d flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-[34px] p-6 text-[var(--on-dark)]">
      <div className="flex flex-col gap-2">
        <span className="text-sm text-[var(--on-dark-muted)]">Mức độ</span>
        <div role="group" aria-label="Mức độ" className="press-d flex gap-1 rounded-full p-1">
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => {
            const on = p === priority;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                disabled={busy || on}
                onClick={() => void send(url, { priority: p })}
                className={
                  "tap flex-1 rounded-full px-3 py-2 text-[13px] disabled:cursor-default " +
                  (on ? (p === "URGENT" ? "knob font-semibold text-[#22252a]" : "raise font-semibold text-[#22252a]") : "")
                }
              >
                {p === "NORMAL" ? "Thường" : PRIORITY_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>
      <label className="flex flex-col gap-2 text-sm text-[var(--on-dark-muted)]">
        {canAssign ? "Người xử lý" : "Người xử lý (thành viên chỉ tự nhận / bỏ nhận)"}
        <select
          className={sel}
          disabled={busy || locked}
          value={assigneeUserId ?? ""}
          onChange={(e) => void send(url, { assign: e.target.value === me.id ? "me" : e.target.value })}
        >
          {people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
              {p.userId === me.id ? " (tôi)" : ""}
            </option>
          ))}
          <option value="">— Chưa phân công —</option>
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm text-[var(--on-dark-muted)]">
        Nhóm
        <select className={sel} disabled={busy || !canAssign} value={team ?? ""} onChange={(e) => void send(url, { team: e.target.value })}>
          {team ? null : <option value="">— Chưa có —</option>}
          {teams.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <ErrorLine err={err} />
    </div>
  );
}

const CANNED = [
  { label: "Xin ảnh chụp màn hình", body: (n: string) => `Chào ${n}, ${n} gửi giúp em ảnh chụp màn hình lúc báo lỗi ạ.`, then: "WAITING" as Status },
  { label: "Đã sửa, nhờ kiểm tra lại", body: (n: string) => `Em đã xử lý xong, ${n} kiểm tra lại giúp em nhé.`, then: "RESOLVED" as Status },
  { label: "Ngoài phạm vi hỗ trợ", body: () => "Yêu cầu này nằm ngoài phạm vi hệ thống hỗ trợ kỹ thuật, nên em xin phép đóng phiếu. Lý do: ", then: "REJECTED" as Status },
];

/**
 * Ô soạn tin.
 *  - Người xử lý: hai thẻ "Trả lời người gửi" / "Ghi chú nội bộ", câu trả lời
 *    mẫu, và "gửi rồi chuyển sang" để một lần bấm là xong.
 *  - Người gửi (khi phiếu không chờ họ): ô bổ sung đơn giản.
 */
export function Composer(
  props:
    | { ticketId: string; status: Status; reporter: true }
    | {
        ticketId: string;
        status: Status;
        reporter?: false;
        reporterName: string;
        firstName: string;
        notify: boolean;
        /** Đồng nghiệp để nhắc bằng @ trong ghi chú nội bộ. */
        staff: { userId: string; name: string }[];
        meId: string;
      },
) {
  const { ticketId, status } = props;
  const staff = !props.reporter;
  const { reply, send, busy, err, setErr, refresh } = useSend();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [then, setThen] = useState<"" | Status>("");
  const [caret, setCaret] = useState(0);
  const f = useFiles(setErr);

  const call = staff ? "thầy/cô" : "";
  const pub = !internal;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setErr("Chưa nhập nội dung");
    const ok = await reply(ticketId, body, staff && internal, f.files);
    if (!ok) return;
    if (staff && pub && then && then !== status) await send(base(ticketId), { status: then }, "PATCH", false);
    setBody("");
    setThen("");
    f.clear();
    refresh();
  }

  if (!staff) {
    return (
      <form onSubmit={submit} className="press flex flex-col gap-3 rounded-[28px] p-4">
        <label htmlFor="compose" className="text-sm font-medium">
          Bổ sung thông tin
        </label>
        <textarea
          id="compose"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files);
            if (imgs.length) f.add(imgs);
          }}
          placeholder="Viết thêm cho người xử lý…"
          className="field"
        />
        {f.list}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {f.picker}
          <button type="button" onClick={f.open} className="raise tap h-11 rounded-full px-4 text-sm font-medium">
            + Đính kèm
          </button>
          <KnobButton type="submit" dark disabled={busy}>
            {busy ? "Đang gửi…" : "Gửi"}
          </KnobButton>
        </div>
        <ErrorLine err={err} />
      </form>
    );
  }

  const p = props as {
    reporterName: string;
    firstName: string;
    notify: boolean;
    staff: { userId: string; name: string }[];
    meId: string;
  };
  // "@" đang gõ dở ngay trước con trỏ → hiện gợi ý tên đồng nghiệp.
  const beforeCaret = body.slice(0, caret);
  const m = !pub ? /(^|\s)@([^\s@]*)$/.exec(beforeCaret) : null;
  const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
  const suggest = m
    ? p.staff.filter((x) => x.userId !== p.meId && fold(x.name).includes(fold(m[2]))).slice(0, 6)
    : [];
  const pick = (name: string) => {
    if (!m) return;
    const start = caret - m[2].length - 1;
    const next = `${body.slice(0, start)}@${name} ${body.slice(caret)}`;
    setBody(next);
    const pos = start + name.length + 2;
    setCaret(pos);
    requestAnimationFrame(() => {
      const el = document.getElementById("compose") as HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };
  return (
    <form onSubmit={submit} className={(pub ? "press" : "note") + " mt-2 flex flex-col gap-3 rounded-[28px] p-4"}>
      <div role="tablist" aria-label="Kiểu tin" className="press flex self-start rounded-full p-1">
        <button
          type="button"
          role="tab"
          aria-selected={pub}
          onClick={() => setInternal(false)}
          className={"tap rounded-full px-4 py-2 text-[13px] font-medium " + (pub ? "raise-d text-[var(--on-dark)]" : "")}
        >
          Trả lời người gửi
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!pub}
          onClick={() => setInternal(true)}
          className={"tap rounded-full px-4 py-2 text-[13px] font-medium " + (!pub ? "knob" : "")}
        >
          Ghi chú nội bộ
        </button>
      </div>
      <span className="text-[13px] text-[#4a4d4b]">
        {pub
          ? p.notify
            ? `${p.reporterName} sẽ thấy tin này và nhận email.`
            : `${p.reporterName} sẽ thấy tin này (người gửi đã tắt email).`
          : "Chỉ quản trị viên thấy — lọc ở máy chủ, người gửi không đọc được. Gõ @ để nhắc đồng nghiệp: họ nhận email."}
      </span>
      <label htmlFor="compose" className="sr-only">
        Nội dung
      </label>
      <div className="relative">
        <textarea
          id="compose"
          rows={4}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            // Enter / Tab chọn gợi ý đầu tiên khi danh sách đang mở.
            if (suggest.length && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pick(suggest[0].name);
            }
          }}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files);
            if (imgs.length) f.add(imgs);
          }}
          placeholder={pub ? `Trả lời ${p.firstName ? `${call} ${p.firstName}` : "người gửi"}…` : "Ghi chú cho đồng nghiệp… gõ @ để nhắc tên"}
          className="field bg-[rgba(255,255,255,.55)]"
          aria-autocomplete={!pub ? "list" : undefined}
        />
        {suggest.length ? (
          <ul role="listbox" aria-label="Nhắc đồng nghiệp" className="raise absolute left-3 top-full z-20 mt-1 flex min-w-[14rem] flex-col gap-0.5 rounded-[20px] p-1.5">
            {suggest.map((x, i) => (
              <li key={x.userId} role="option" aria-selected={i === 0}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(x.name);
                  }}
                  className={"tap w-full rounded-full px-4 py-2 text-left text-sm " + (i === 0 ? "press font-medium" : "hover:bg-black/[.04]")}
                >
                  @{x.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {f.list}
      {pub ? (
        <div className="flex flex-wrap gap-2">
          {CANNED.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                setBody(c.body("thầy/cô"));
                setThen(c.then);
              }}
              className="raise tap rounded-full px-3.5 py-2 text-[13px]"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {f.picker}
          <button type="button" onClick={f.open} className="raise tap h-11 rounded-full px-4 text-sm font-medium">
            + Đính kèm
          </button>
          {pub ? (
            <label className="flex items-center gap-2 text-[13px]">
              Gửi rồi chuyển sang
              <select
                value={then}
                onChange={(e) => setThen(e.target.value as "" | Status)}
                className="raise rounded-full border-0 px-3 py-2 text-[13px] outline-none"
              >
                <option value="">Giữ nguyên</option>
                {(["WAITING", "IN_PROGRESS", "RESOLVED", "REJECTED"] as Status[])
                  .filter((s) => s !== status)
                  .map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </div>
        <KnobButton type="submit" dark disabled={busy}>
          {busy ? "Đang gửi…" : pub ? "Gửi trả lời" : "Lưu ghi chú"}
        </KnobButton>
      </div>
      <ErrorLine err={err} />
    </form>
  );
}

/**
 * Khối DUYỆT CẤP QUYỀN — đầu mối đơn vị (hoặc quản trị) duyệt / từ chối; người
 * khác thấy phiếu đang chờ ai.
 */
export function ApprovalBox({
  ticketId,
  unit,
  canDecide,
  reporterView,
}: {
  ticketId: string;
  unit: string | null;
  canDecide: boolean;
  reporterView: boolean;
}) {
  const { send, busy, err, setErr } = useSend();
  const [note, setNote] = useState("");
  const who = unit ? `đầu mối ${unit}` : "quản trị hệ thống";
  return (
    <div className="raise-d flex w-full flex-col gap-3 rounded-[34px] p-6">
      <h2 className="flex items-center gap-3 text-[21px] font-medium">
        <span className="knob h-3.5 w-3.5 rounded-full" />
        {canDecide ? "Cần thầy/cô duyệt yêu cầu cấp quyền" : `Đang chờ ${who} duyệt`}
      </h2>
      <p className="font-light text-[var(--on-dark-muted)]">
        {canDecide
          ? "Đây là yêu cầu cấp tài khoản / thêm quyền. Duyệt thì nhóm Tài khoản & Quyền thực hiện; từ chối thì phiếu đóng và người gửi nhận lý do qua email."
          : reporterView
            ? "Yêu cầu cấp tài khoản / thêm quyền cần đơn vị xác nhận trước. Duyệt xong, phiếu tự chuyển sang nhóm phụ trách — thầy/cô sẽ nhận email."
            : "Phiếu chưa được xử lý cho tới khi đơn vị duyệt. Bên xử lý chỉ có thể đóng hoặc đánh dấu không xử lý."}
      </p>
      {canDecide ? (
        <>
          <label htmlFor="ap-note" className="sr-only">
            Ghi chú duyệt
          </label>
          <textarea
            id="ap-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú (bắt buộc khi từ chối) — vd: chỉ cấp quyền đăng bài, không cấp quyền quản trị"
            className="press-d resize-y rounded-3xl border-0 px-5 py-3 text-[var(--on-dark)] outline-none placeholder:text-[var(--on-dark-muted)]"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!note.trim()) return setErr("Từ chối thì cần ghi lý do cho người gửi");
                void send(base(ticketId), { approval: "REJECT", approvalNote: note });
              }}
              className="raise-d tap h-[52px] rounded-full px-5 font-medium text-[var(--on-dark)]"
            >
              Từ chối
            </button>
            <KnobButton disabled={busy} onClick={() => void send(base(ticketId), { approval: "APPROVE", approvalNote: note || undefined })}>
              Duyệt
            </KnobButton>
          </div>
          <ErrorLine err={err} />
        </>
      ) : null}
    </div>
  );
}
