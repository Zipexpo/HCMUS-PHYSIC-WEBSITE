import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OPEN_STATUSES, PRIORITY_LABEL, STATUS_LABEL, parseFields } from "@/lib/ticket";
import { AUTO_CLOSE_DAYS } from "@/lib/lifecycle";
import { assignableStaff } from "@/lib/staff";
import { canAct, canApprove, canAssignOthers, canSee, canSeeInternal, isHandler, queueScope } from "@/lib/access";
import { deadlines } from "@/lib/sla";
import type { TicketStatus } from "@/generated/prisma/client";
import { CurveDown, CurveUp, StatusTag } from "@/components/ui";
import {
  ApprovalBox,
  CloseTicket,
  RatingCard,
  Composer,
  NotifyToggle,
  ResolvedChoice,
  StaffMeta,
  StaffStatus,
  WaitingReply,
} from "./actions";

export const dynamic = "force-dynamic";

/** "13.11 09:35" — giờ Việt Nam, máy chủ chạy UTC. */
const hm = (d: Date) => {
  const p = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}.${g("month")} ${g("hour")}:${g("minute")}`;
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Nhật ký lưu NHÃN trạng thái; đổi ngược ra mã để biết mỗi chặng xảy ra lúc nào. */
const STATUS_BY_LABEL = Object.fromEntries(
  Object.entries(STATUS_LABEL).map(([k, v]) => [v, k as TicketStatus]),
);
const statusOfLabel = (l: string | null): TicketStatus | undefined =>
  l ? (STATUS_BY_LABEL[l] ?? STATUS_BY_LABEL[l.replace(/\s*\(.*\)$/, "")]) : undefined;

const STEP: Record<TicketStatus, number> = {
  NEW: 0,
  ACKNOWLEDGED: 1,
  IN_PROGRESS: 2,
  WAITING: 2,
  RESOLVED: 3,
  CLOSED: 4,
  REJECTED: 4,
};


function eventText(e: { kind: string; actorName: string | null; fromValue: string | null; toValue: string | null }) {
  const who = e.actorName ?? "Hệ thống";
  switch (e.kind) {
    case "created":
      return "Phiếu được tạo";
    case "status":
      return `${e.fromValue} → ${e.toValue}`;
    case "assign":
      return e.toValue === "(chưa ai)" ? `${who} bỏ nhận phiếu` : e.toValue === who ? `${who} nhận phiếu` : `${who} giao cho ${e.toValue}`;
    case "priority":
      return `Mức độ: ${PRIORITY_LABEL[e.fromValue as keyof typeof PRIORITY_LABEL] ?? e.fromValue} → ${PRIORITY_LABEL[e.toValue as keyof typeof PRIORITY_LABEL] ?? e.toValue}`;
    case "team":
      return `Chuyển nhóm: ${e.fromValue} → ${e.toValue}`;
    case "approval":
      return `${who}: ${e.toValue}`;
    case "escalate":
      return `Cảnh báo: ${e.toValue}`;
    case "rating":
      return `Người gửi chấm ${e.toValue}`;
    default:
      return e.kind;
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/dang-nhap?next=/phieu/${id}`);

  const t = await prisma.ticket.findUnique({
    where: { id },
    include: {
      form: true,
      comments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" }, include: { comment: { select: { isInternal: true } } } },
    },
  });
  if (!t) notFound();

  const isOwner = t.reporterUserId === user.id;
  // Ai được đọc / làm gì: lib/access.ts. Không có quyền thì như phiếu không tồn tại.
  if (!canSee(user, t)) notFound();
  const acting = canAct(user, t);
  const internalOk = canSeeInternal(user, t);
  const approver = canApprove(user, t);
  const pending = t.approvalStatus === "PENDING";
  // Nhìn từ phía "bên xử lý" (kể cả đầu mối chỉ-xem, Ban Chủ nhiệm) — không phải người gửi.
  const staffView = !isOwner;
  const backHref = !staffView ? (user.isStaff ? "/phieu?cua=toi" : "/phieu") : isHandler(user.access) ? "/phieu" : "/don-vi";
  const due = deadlines(t.approvedAt ?? t.createdAt, t.priority);

  // Ghi chú nội bộ và tệp đính kèm của nó lọc Ở MÁY CHỦ, không phải ẩn bằng CSS.
  const comments = t.comments.filter((c) => internalOk || !c.isInternal);
  const files = t.attachments.filter((a) => internalOk || !a.comment?.isInternal);
  const filesOf = (commentId: string | null) => files.filter((a) => a.commentId === commentId);

  // ── Thông tin đã điền ────────────────────────────────────────────────────
  const fields = parseFields(t.form.fields);
  const answers = (t.answers ?? {}) as Record<string, unknown>;
  const asText = (v: unknown) => (typeof v === "boolean" ? (v ? "Có" : "Không") : String(v ?? ""));
  const info: { label: string; text: string; link?: boolean }[] = [];
  const answerTexts = new Set(Object.values(answers).map((v) => asText(v).trim()));
  if (t.systemName && !answerTexts.has(t.systemName)) info.push({ label: "Hệ thống", text: t.systemName });
  for (const f of fields) {
    const text = asText(answers[f.key]).trim();
    if (text) info.push({ label: f.label, text, link: /^(https?:\/\/|phys\.hcmus)/.test(text) });
  }
  // Ô đã bị bỏ khỏi mẫu sau khi phiếu được gửi: vẫn hiện câu trả lời cũ.
  const known = new Set(fields.map((f) => f.key));
  for (const [k, v] of Object.entries(answers)) {
    const text = asText(v).trim();
    if (!known.has(k) && text) info.push({ label: k, text });
  }

  // ── Chặng đường, kèm mốc giờ ─────────────────────────────────────────────
  const reached: Partial<Record<number, Date>> = { 0: t.createdAt };
  for (const e of t.events) {
    // Nhận phiếu = tiếp nhận, kể cả khi không ai bấm riêng nút "Đã tiếp nhận".
    if (e.kind === "assign" && e.toValue !== "(chưa ai)" && !reached[1]) reached[1] = e.createdAt;
    if (e.kind !== "status") continue;
    const s = statusOfLabel(e.toValue);
    if (s) reached[STEP[s]] = e.createdAt;
  }
  if (t.status === "RESOLVED" && t.resolvedAt) reached[3] = t.resolvedAt;
  const cur = STEP[t.status];
  const waiting = t.status === "WAITING";
  const ended = t.status === "CLOSED" || t.status === "REJECTED";
  const you = staffView ? "người gửi" : "thầy/cô";
  const steps = [
    "Đã gửi",
    pending ? "Chờ đơn vị duyệt" : "Đã tiếp nhận",
    waiting ? `Chờ ${you} bổ sung` : "Đang xử lý",
    "Đã xong",
    t.status === "REJECTED" ? "Không xử lý" : "Đã đóng",
  ];

  const lastStaffMsg = [...comments]
    .reverse()
    .find((c) => c.authorUserId !== t.reporterUserId && !c.isInternal);

  // ── Dòng trao đổi: tin nhắn + sự kiện trạng thái xen kẽ theo thời gian ────
  type Item =
    | { type: "msg"; at: Date; c: (typeof comments)[number] }
    | { type: "ev"; at: Date; text: string };
  const thread: Item[] = [
    ...comments.map((c) => ({ type: "msg" as const, at: c.createdAt, c })),
    ...t.events
      .filter((e) => ["status", "assign", "approval", "escalate"].includes(e.kind))
      .map((e) => ({ type: "ev" as const, at: e.createdAt, text: eventText(e) })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  // ── Riêng cho người xử lý ────────────────────────────────────────────────
  let staffExtra: null | {
    prev?: { id: string; code: string };
    next?: { id: string; code: string };
    pos?: number;
    total: number;
    history: number;
    historyOpen: number;
    staff: Awaited<ReturnType<typeof assignableStaff>>;
    teams: string[];
  } = null;
  if (staffView) {
    const scope = queueScope(user.access);
    const [queue, history, historyOpen, staff, teamRows] = await Promise.all([
      prisma.ticket.findMany({
        where: { status: { in: OPEN_STATUSES }, ...(scope ?? {}) },
        orderBy: { createdAt: "asc" },
        select: { id: true, code: true },
        take: 500,
      }),
      prisma.ticket.count({ where: { reporterUserId: t.reporterUserId, id: { not: t.id } } }),
      prisma.ticket.count({
        where: { reporterUserId: t.reporterUserId, id: { not: t.id }, status: { in: OPEN_STATUSES } },
      }),
      // Giao cho người khác: trưởng nhóm / quản trị — chọn trong nhóm của phiếu.
      canAssignOthers(user, t) ? assignableStaff(user.access, user.access.sysAdmin ? undefined : t.team) : Promise.resolve([]),
      prisma.ticketTeam.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } }),
    ]);
    const i = queue.findIndex((q) => q.id === t.id);
    const teams = [...new Set([...teamRows.map((x) => x.name), t.team ?? ""])].filter(Boolean);
    staffExtra = {
      prev: i > 0 ? queue[i - 1] : undefined,
      next: i >= 0 && i < queue.length - 1 ? queue[i + 1] : undefined,
      pos: i >= 0 ? i + 1 : undefined,
      total: queue.length,
      history,
      historyOpen,
      staff,
      teams,
    };
  }

  const team = t.team ?? t.form.defaultTeam ?? "Bộ phận kỹ thuật";
  const firstName = t.reporterName.trim().split(/\s+/).pop() ?? t.reporterName;

  return (
    <>
      {/* ── Vùng sáng: thanh trên, mã phiếu, tiêu đề, chặng đường ────────── */}
      <section className="hero">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-7">
          <Link
            href={backHref}
            className="raise tap inline-flex h-[54px] items-center gap-2.5 rounded-full px-5 font-medium"
          >
            ← {!staffView ? "Phiếu của tôi" : isHandler(user.access) ? "Hàng đợi" : "Phiếu đơn vị"}
          </Link>

          {staffView && staffExtra ? (
            <div className="press flex items-center gap-2 rounded-full p-1.5">
              {staffExtra.prev ? (
                <Link href={`/phieu/${staffExtra.prev.id}`} className="raise tap rounded-full px-4 py-2 font-mono text-sm font-semibold">
                  ‹ {staffExtra.prev.code}
                </Link>
              ) : null}
              <span className="muted px-2 text-[13px]">
                {staffExtra.pos ? `${staffExtra.pos} / ${staffExtra.total}` : `${staffExtra.total}`} · Tất cả đang mở
              </span>
              {staffExtra.next ? (
                <Link href={`/phieu/${staffExtra.next.id}`} className="raise tap rounded-full px-4 py-2 font-mono text-sm font-semibold">
                  {staffExtra.next.code} ›
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="press flex flex-wrap gap-x-6 gap-y-1.5 rounded-full px-6 py-2.5">
              {[
                ["Loại", t.form.name],
                ["Mức độ", PRIORITY_LABEL[t.priority]],
                ["Người xử lý", t.assigneeName ?? "Chưa phân công"],
              ].map(([k, v]) => (
                <span key={k} className="muted flex flex-col text-[11px]">
                  {k}
                  <span className="text-sm font-medium text-[var(--text)]">{v}</span>
                </span>
              ))}
            </div>
          )}

          {staffView ? (
            <span />
          ) : isOwner && !ended ? (
            <CloseTicket ticketId={t.id} />
          ) : (
            <span />
          )}
        </div>

        <div className="flex flex-col gap-3.5 px-5 sm:px-9">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="raise-d inline-flex h-10 items-center rounded-full px-4 font-mono font-semibold text-[var(--on-dark)]">
              {t.code}
            </span>
            {staffView ? (
              <>
                <StatusTag status={t.status} className="h-10 px-4 text-sm" />
                <span className="press rounded-full px-4 py-2 text-[13px]">
                  {t.form.name} · tạo {hm(t.createdAt)}
                </span>
              </>
            ) : null}
          </div>
          <h1 className="max-w-[960px] text-[clamp(34px,4.6vw,64px)] font-medium leading-[1.02] tracking-[-0.035em]">
            {t.title}
          </h1>

          {staffView ? (
            <p className="max-w-[860px] whitespace-pre-line text-[17px] font-light leading-relaxed text-[#3b3e3c]">
              {t.description}
            </p>
          ) : (
            <ol
              aria-label="Tiến độ phiếu"
              className="raise mt-4 grid list-none gap-2.5 rounded-[34px] px-5 py-4 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]"
            >
              {steps.map((label, i) => {
                const done = i < cur || (i === cur && ended);
                const now = i === cur && !ended;
                const at = reached[i];
                return (
                  <li
                    key={label}
                    aria-current={now ? "step" : undefined}
                    className={"flex items-center gap-3 " + (!done && !now ? "muted" : "")}
                  >
                    <span
                      className={
                        "flex h-[46px] w-[46px] flex-none items-center justify-center rounded-full " +
                        (done ? "raise-d text-[var(--on-dark)]" : now ? (waiting ? "knob font-semibold" : "knob") : "press")
                      }
                      style={now ? { boxShadow: waiting ? "0 0 0 6px rgba(233,185,73,.25), 0 6px 14px -4px rgba(20,22,22,.45)" : "0 0 0 6px rgba(127,203,180,.3), 0 6px 14px -4px rgba(20,22,22,.45)", background: waiting ? undefined : "radial-gradient(circle at 35% 30%, #e6fff5 0%, #7fcbb4 60%, #4f9c85 100%)" } : undefined}
                    >
                      {done ? "✓" : now ? (waiting ? "!" : "") : ""}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className={now ? "font-semibold" : "font-medium"}>{label}</span>
                      <span className={"text-xs " + (now && waiting ? "text-[#6b4d00]" : "muted")}>
                        {at && (done || now) ? `${now && waiting ? "từ " : ""}${hm(at)}` : "—"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <CurveDown />
      </section>

      {/* ── Dải tối ──────────────────────────────────────────────────────── */}
      <section className="band flex flex-wrap items-stretch gap-5 px-5 pb-6 pt-1 sm:px-9">
        {pending ? (
          <ApprovalBox
            ticketId={t.id}
            unit={t.approvalUnitName}
            canDecide={approver}
            reporterView={isOwner}
          />
        ) : null}
        {staffView && staffExtra && acting ? (
          <>
            <StaffStatus ticketId={t.id} status={t.status} locked={pending} />
            <StaffMeta
              ticketId={t.id}
              priority={t.priority}
              assigneeUserId={t.assigneeUserId}
              assigneeName={t.assigneeName}
              me={{ id: user.id, name: user.name }}
              staff={staffExtra.staff}
              team={t.team}
              teams={staffExtra.teams}
              canAssign={canAssignOthers(user, t)}
              locked={pending}
            />
          </>
        ) : staffView ? (
          // Đầu mối đơn vị (chỉ xem) / Ban Chủ nhiệm: thấy tình hình, không thao tác.
          <div className="raise-d flex min-w-0 flex-[999_1_560px] flex-col gap-2 rounded-[34px] p-6">
            <h2 className="text-lg font-medium">Chỉ xem</h2>
            <p className="text-sm font-light text-[var(--on-dark-muted)]">
              Trạng thái <span className="font-medium text-[var(--on-dark)]">{STATUS_LABEL[t.status]}</span> · nhóm{" "}
              <span className="font-medium text-[var(--on-dark)]">{t.team ?? "chưa có"}</span> · người xử lý{" "}
              <span className="font-medium text-[var(--on-dark)]">{t.assigneeName ?? "chưa ai nhận"}</span>.
            </p>
            <p className="text-xs font-light text-[var(--on-dark-muted)]">
              Phiếu do nhóm phụ trách xử lý. Thầy/cô xem được vì {user.access.board ? "phiếu đã được báo lên Ban Chủ nhiệm" : "người gửi thuộc đơn vị của thầy/cô"}.
            </p>
          </div>
        ) : (
          <>
            <div className="raise-d flex min-w-0 flex-[999_1_560px] flex-col gap-3.5 rounded-[34px] p-6">
              {waiting && isOwner ? (
                <WaitingReply ticketId={t.id} assigneeName={t.assigneeName} />
              ) : t.status === "RESOLVED" && isOwner ? (
                <ResolvedChoice ticketId={t.id} days={AUTO_CLOSE_DAYS} resolvedAt={t.resolvedAt?.toISOString() ?? null} />
              ) : (
                <>
                  <h2 className="flex items-center gap-3 text-[21px] font-medium">
                    <span className="h-3.5 w-3.5 rounded-full" style={{ background: ended ? "#c4c7c4" : "#7fcbb4", boxShadow: ended ? undefined : "0 0 12px #7fcbb4" }} />
                    {ended ? STATUS_LABEL[t.status] : t.status === "NEW" ? "Phiếu đã tới nhóm phụ trách" : "Đang xử lý — thầy/cô chưa cần làm gì"}
                  </h2>
                  <p className="muted font-light">
                    {ended
                      ? `Phiếu đã kết thúc${t.closedAt ? ` lúc ${hm(t.closedAt)}` : ""}. Lỗi quay lại thì gửi phiếu mới, nhắc mã ${t.code}.`
                      : t.status === "NEW"
                        ? `${team} sẽ tiếp nhận sớm. Có cập nhật, hệ thống báo qua email.`
                        : "Có cập nhật mới, hệ thống báo qua email. Muốn bổ sung thì viết ở phần Trao đổi bên dưới."}
                  </p>
                </>
              )}
            </div>
            <div className="raise-d flex min-w-0 flex-[1_1_300px] flex-col justify-center gap-3.5 rounded-[34px] p-6">
              <div className="flex items-center gap-3.5">
                <span className="raise flex h-[60px] w-[60px] flex-none items-center justify-center rounded-full font-semibold text-[var(--text)]">
                  {t.assigneeName ? initials(t.assigneeName) : "?"}
                </span>
                <span className="flex flex-col">
                  <span className="font-medium">{t.assigneeName ?? "Chưa ai nhận"}</span>
                  <span className="muted text-[13px] font-light">
                    {t.assigneeName ? `Đang xử lý phiếu · ${team}` : `Phiếu nằm ở hàng đợi của ${team}`}
                  </span>
                </span>
              </div>
              {lastStaffMsg ? (
                <span className="press-d rounded-[22px] px-4 py-3 text-sm font-light">
                  “{lastStaffMsg.body.length > 140 ? `${lastStaffMsg.body.slice(0, 140)}…` : lastStaffMsg.body}”
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>
      <CurveUp />

      {/* ── Vùng sáng: trao đổi + thông tin ─────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-6 px-5 pb-11 pt-1.5 sm:px-8">
        <section aria-labelledby="th-h" className="raise flex min-w-0 flex-[999_1_600px] flex-col gap-4 rounded-[34px] p-6">
          <h2 id="th-h" className="text-xl font-medium">Trao đổi</h2>

          {/* Lời mô tả ban đầu là tin đầu tiên của cuộc trao đổi. */}
          <Message
            mine={isOwner}
            initials={initials(t.reporterName)}
            author={isOwner ? "Tôi" : t.reporterName}
            sub={staffView ? `người gửi · ${hm(t.createdAt)}` : hm(t.createdAt)}
            body={staffView ? (filesOf(null).length ? `Đã gửi phiếu kèm ${filesOf(null).length} tệp.` : "Đã gửi phiếu.") : t.description}
            files={filesOf(null)}
            fromStaff={false}
          />

          {thread.map((it) =>
            it.type === "ev" ? (
              <span key={`e${it.at.getTime()}${it.text}`} className="press self-center rounded-full px-4 py-1.5 text-xs text-[#4a4d4b]">
                {it.text} · {hm(it.at)}
              </span>
            ) : (
              <Message
                key={it.c.id}
                mine={it.c.authorUserId === user.id}
                initials={initials(it.c.authorName)}
                author={it.c.authorUserId === user.id ? "Tôi" : it.c.authorName}
                sub={
                  staffView && it.c.authorUserId === user.id && !it.c.isInternal
                    ? `trả lời người gửi · ${hm(it.c.createdAt)}`
                    : hm(it.c.createdAt)
                }
                body={it.c.body}
                internal={it.c.isInternal}
                files={filesOf(it.c.id)}
                fromStaff={it.c.authorUserId !== t.reporterUserId}
                staffView={staffView}
              />
            ),
          )}

          {staffView && acting ? (
            <Composer
              ticketId={t.id}
              status={t.status}
              reporterName={t.reporterName}
              firstName={firstName}
              notify={t.notifyEmail}
              staff={staffExtra?.staff ?? []}
              meId={user.id}
            />
          ) : isOwner && !ended && !waiting ? (
            <Composer ticketId={t.id} status={t.status} reporter />
          ) : null}
        </section>

        <aside aria-label="Thông tin phiếu" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4.5 gap-[18px]">
          <section className="raise flex flex-col gap-3 rounded-[34px] p-6">
            <h2 className="text-[17px] font-medium">{staffView ? "Thông tin đã điền" : "Thông tin thầy/cô đã điền"}</h2>
            <dl className="flex flex-col gap-2.5 text-sm">
              {info.map((f) => (
                <div key={f.label} className="press rounded-[20px] px-4 py-2.5">
                  <dt className="muted text-xs">{f.label}</dt>
                  <dd className={f.link ? "break-all font-mono text-[13px]" : "whitespace-pre-line font-medium"}>{f.text}</dd>
                </div>
              ))}
              {t.rating != null && staffView ? (
                <div className="press rounded-[20px] px-4 py-2.5">
                  <dt className="muted text-xs">Người gửi chấm</dt>
                  <dd className="font-medium">
                    <span className="text-[var(--amber)]">{"★".repeat(t.rating)}</span>
                    <span className="text-[#c9c8c3]">{"★".repeat(5 - t.rating)}</span>
                    {t.ratingNote ? <span className="block whitespace-pre-line text-sm font-normal">“{t.ratingNote}”</span> : null}
                  </dd>
                </div>
              ) : null}
              {staffView && !["RESOLVED", "CLOSED", "REJECTED"].includes(t.status) && !pending ? (
                <div className="press rounded-[20px] px-4 py-2.5">
                  <dt className="muted text-xs">Thời hạn</dt>
                  <dd className={"font-medium " + (t.escalation ? "text-[#a1301f]" : "")}>
                    {t.firstResponseAt ? "Đã phản hồi" : `Phản hồi trước ${hm(due.response)}`} · xong trước {hm(due.resolve)}
                  </dd>
                </div>
              ) : null}
              {files.length ? (
                <div className="press rounded-[20px] px-4 py-2.5">
                  <dt className="muted text-xs">Đính kèm</dt>
                  {files.map((a) => (
                    <dd key={a.id} className="font-medium">
                      <a href={`/ho-tro/api/attachments/${a.id}`} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">
                        {a.fileName}
                      </a>{" "}
                      <span className="muted font-normal">· {kb(a.sizeByte)}</span>
                    </dd>
                  ))}
                </div>
              ) : null}
            </dl>
          </section>

          {staffView && staffExtra ? (
            <>
              <section className="raise-d flex flex-col gap-3 rounded-[34px] p-6 text-[var(--on-dark)]">
                <div className="flex items-center gap-3">
                  <span className="raise flex h-12 w-12 flex-none items-center justify-center rounded-full text-sm font-semibold text-[var(--text)]">
                    {initials(t.reporterName)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{t.reporterName}</span>
                    {t.reporterUnit ? <span className="text-[13px] font-light text-[var(--on-dark-muted)]">{t.reporterUnit}</span> : null}
                  </span>
                </div>
                <a href={`mailto:${t.reporterEmail}`} className="truncate font-mono text-[13px] text-[var(--on-dark)] hover:underline">
                  {t.reporterEmail}
                </a>
                <Link
                  href={`/phieu?xem=tat-ca&nguoi=${encodeURIComponent(t.reporterUserId)}`}
                  className="text-sm text-[var(--amber)] hover:underline"
                >
                  {staffExtra.history ? `${staffExtra.history} phiếu trước đây · ${staffExtra.historyOpen} đang mở ↗` : "Phiếu đầu tiên của người này"}
                </Link>
                {!t.notifyEmail ? (
                  <span className="text-xs text-[var(--on-dark-muted)]">Người gửi đã tắt email báo tin — trả lời chỉ hiện trong phiếu.</span>
                ) : null}
              </section>

              <section className="raise flex flex-col gap-3 rounded-[34px] p-6">
                <h2 className="text-[17px] font-medium">Nhật ký</h2>
                <ol className="flex flex-col gap-2.5 text-[13px]">
                  {[...t.events].reverse().map((e, i, arr) => (
                    <li key={e.id} className="flex items-start gap-2.5">
                      <span
                        className={
                          "mt-1 h-3 w-3 flex-none rounded-full " +
                          (i === 0 ? "knob" : i === arr.length - 1 ? "raise-d" : "press")
                        }
                      />
                      <span>
                        <span className="font-mono text-xs">{hm(e.createdAt)}</span> · {eventText(e)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          ) : isOwner ? (
            <>
              {t.status === "CLOSED" && t.rating == null && t.resolvedAt ? <RatingCard ticketId={t.id} /> : null}
              <NotifyToggle ticketId={t.id} on={t.notifyEmail} />
            </>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Message({
  mine,
  initials: ini,
  author,
  sub,
  body,
  internal,
  files,
  fromStaff,
  staffView,
}: {
  mine: boolean;
  initials: string;
  author: string;
  sub: string;
  body: string;
  internal?: boolean;
  files: { id: string; fileName: string; mimeType: string }[];
  fromStaff: boolean;
  staffView?: boolean;
}) {
  // Người gửi nhìn: tin của mình bên phải (lõm), người xử lý bên trái (tối).
  // Người xử lý nhìn: mọi tin bên trái; tin của chính mình mang núm hổ phách.
  const right = mine && !staffView;
  const bubble = internal ? "note text-[#22252a]" : fromStaff ? "raise-d text-[var(--on-dark)]" : "press";
  const av = staffView && mine ? "knob" : fromStaff ? "raise-d text-[var(--on-dark)]" : "raise";
  return (
    <article aria-label={internal ? "Ghi chú nội bộ" : undefined} className={"flex gap-3 " + (right ? "flex-row-reverse" : "")}>
      <span className={av + " flex h-11 w-11 flex-none items-center justify-center rounded-full text-[13px] font-semibold"}>
        {ini}
      </span>
      <div className={"flex max-w-[560px] flex-col gap-1 " + (right ? "items-end" : "items-start")}>
        <span className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium">{author}</span>
          {internal ? <span className="raise-d rounded-full px-2.5 py-0.5 text-[11px] font-medium text-[var(--on-dark)]">Nội bộ</span> : null}
          <span className="muted font-light">· {sub}</span>
        </span>
        <p className={bubble + " m-0 whitespace-pre-line rounded-3xl px-4.5 px-[18px] py-3.5 font-light"}>{body}</p>
        {files.length ? (
          <span className="flex flex-wrap gap-2">
            {files.map((a) =>
              a.mimeType.startsWith("image/") ? (
                <a key={a.id} href={`/ho-tro/api/attachments/${a.id}`} target="_blank" rel="noopener" className="raise block overflow-hidden rounded-2xl p-1">
                  {/* biome-ignore lint: ảnh có kiểm quyền, không qua next/image */}
                  <img src={`/ho-tro/api/attachments/${a.id}`} alt={a.fileName} className="h-24 w-auto max-w-[220px] rounded-xl object-cover" />
                </a>
              ) : (
                <a key={a.id} href={`/ho-tro/api/attachments/${a.id}`} className="raise rounded-full px-3.5 py-1.5 text-xs font-medium">
                  📄 {a.fileName}
                </a>
              ),
            )}
          </span>
        ) : null}
      </div>
    </article>
  );
}
