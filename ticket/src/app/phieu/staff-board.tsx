import Form from "next/form";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  OPEN_STATUSES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/lib/ticket";
import type { Prisma, TicketStatus } from "@/generated/prisma/client";
import { CurveDown, CurveUp, Led, homNay } from "@/components/ui";
import { assignableStaff } from "@/lib/staff";
import { type Who, canApprove, isHandler, queueScope } from "@/lib/access";
import { FilterMenu, QueueList, SavedFilters, type QueueRow } from "./queue-list";
import {
  DAY_MS,
  RANGES,
  bucketOf,
  groupRuns,
  hrefWith,
  pie,
  resolveRange,
  type Params,
} from "./filters";

const PER_PAGE = [25, 50, 100] as const;
/** Trần số phiếu nạp để tính số liệu. Một Khoa dùng nhiều năm vẫn dưới mức này. */
const CAP = 3000;

type Me = Who;

const ACTIVE: TicketStatus[] = ["NEW", "ACKNOWLEDGED", "IN_PROGRESS"];

/** Các góc nhìn có sẵn ở cột trái — mỗi góc là một câu hỏi thường gặp. */
const VIEWS = [
  { k: "cho-duyet", label: "Chờ duyệt cấp quyền" },
  { k: "cua-toi", label: "Phiếu tôi nhận" },
  { k: "chua-giao", label: "Chưa ai nhận" },
  { k: "qua-han", label: "Quá 24 giờ chưa trả lời" },
  { k: "cho", label: "Chờ người gửi" },
  { k: "mo", label: "Đang mở" },
  { k: "xong", label: "Đã xong" },
  { k: "dong", label: "Đã đóng / không xử lý" },
  { k: "tat-ca", label: "Tất cả" },
] as const;
type ViewKey = (typeof VIEWS)[number]["k"];

type Row = {
  team: string | null;
  reporterUnitId: string | null;
  unitRoute: boolean;
  approvalStatus: string | null;
  approvalUnitId: string | null;
  approvalUnitName: string | null;
  boardEscalated: boolean;
  escalation: number;
  id: string;
  code: string;
  title: string;
  status: TicketStatus;
  priority: keyof typeof PRIORITY_LABEL;
  reporterName: string;
  reporterUnit: string | null;
  reporterUserId: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  systemName: string | null;
  createdAt: Date;
  updatedAt: Date;
  form: { key: string; name: string };
  _count: { comments: number };
  events: { createdAt: Date }[];
  comments: { createdAt: Date; authorUserId: string }[];
};

/**
 * Phiếu đang chờ NGƯỜI XỬ LÝ trả lời từ lúc nào: lần người gửi lên tiếng gần
 * nhất (gửi phiếu hoặc nhắn thêm) mà sau đó chưa có ai bên xử lý động tới.
 * null = không ai đang phải trả lời (đã trả lời, đang chờ người gửi, đã xong).
 */
type WaitMap = Map<string, number | null>;

function inView(t: Row, v: ViewKey, me: Me, staleBefore: number, wait: WaitMap): boolean {
  switch (v) {
    case "cua-toi":
      return t.assigneeUserId === me.id && OPEN_STATUSES.includes(t.status);
    case "chua-giao":
      return !t.assigneeUserId && OPEN_STATUSES.includes(t.status);
    case "qua-han": {
      const w = wait.get(t.id);
      return ACTIVE.includes(t.status) && w != null && w < staleBefore;
    }
    case "cho":
      return t.status === "WAITING";
    case "mo":
      return OPEN_STATUSES.includes(t.status);
    case "xong":
      return t.status === "RESOLVED";
    case "dong":
      return t.status === "CLOSED" || t.status === "REJECTED";
    case "cho-duyet":
      return canApprove(me, t);
    default:
      return true;
  }
}

const PRIO_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;

export async function StaffBoard({ me, p, base = "/phieu" }: { me: Me; p: Params; base?: string }) {
  const range = resolveRange(p);
  const handler = isHandler(me.access);
  const approver = me.access.sysAdmin || !!me.access.liaisonUnitId;
  // Mặc định: phiếu chờ phản hồi lâu nhất lên đầu — đúng câu hỏi "làm gì trước".
  const sort = ["moi", "cu", "uu-tien", "cap-nhat"].includes(p.sx ?? "") ? p.sx! : "cho";
  const q = (p.q ?? "").trim().toLowerCase();
  const tt = p.tt && p.tt in STATUS_LABEL ? (p.tt as TicketStatus) : undefined;
  const page = Math.max(1, Number(p.trang) || 1);
  const PAGE = (PER_PAGE as readonly number[]).includes(Number(p.ms)) ? Number(p.ms) : 25;

  const where: Prisma.TicketWhereInput = {};
  if (range.from || range.to) where.createdAt = { gte: range.from, lt: range.to };
  // Chỉ những phiếu người này có quyền thấy — xem lib/access.ts.
  const scope = queueScope(me.access);
  if (scope) Object.assign(where, scope);

  const [all, forms, staff, waitRows] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: CAP,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        priority: true,
        reporterName: true,
        reporterUnit: true,
        reporterUserId: true,
        assigneeUserId: true,
        assigneeName: true,
        systemName: true,
        team: true,
        reporterUnitId: true,
        unitRoute: true,
        approvalStatus: true,
        approvalUnitId: true,
        approvalUnitName: true,
        boardEscalated: true,
        escalation: true,
        createdAt: true,
        updatedAt: true,
        form: { select: { key: true, name: true } },
        _count: { select: { comments: true } },
        // Lần đầu có người động vào phiếu — để đo tốc độ phản hồi.
        events: {
          where: { kind: { not: "created" } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { createdAt: true },
        },
        comments: {
          where: { isInternal: false },
          orderBy: { createdAt: "asc" },
          take: 3,
          select: { createdAt: true, authorUserId: true },
        },
      },
    }) as Promise<Row[]>,
    prisma.ticketForm.findMany({
      orderBy: [{ sortOrder: "asc" }],
      select: { key: true, name: true },
    }),
    assignableStaff(me.access),
    // Một câu SQL cho mọi phiếu đang chạy: lần cuối người gửi lên tiếng và lần
    // cuối bên xử lý động tới (trả lời công khai, nhận phiếu, đổi trạng thái).
    prisma.$queryRaw<{ id: string; rep: Date; staff: Date | null }[]>`
      SELECT t.id,
        GREATEST(t."createdAt", (SELECT max(c."createdAt") FROM "TicketComment" c
          WHERE c."ticketId" = t.id AND NOT c."isInternal" AND c."authorUserId" = t."reporterUserId")) AS rep,
        GREATEST(
          (SELECT max(c."createdAt") FROM "TicketComment" c
            WHERE c."ticketId" = t.id AND NOT c."isInternal" AND c."authorUserId" <> t."reporterUserId"),
          (SELECT max(e."createdAt") FROM "TicketEvent" e
            WHERE e."ticketId" = t.id AND e.kind IN ('status', 'assign')
              AND e."actorUserId" IS DISTINCT FROM t."reporterUserId")) AS staff
      FROM "Ticket" t
      WHERE t.status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS')`,
  ]);
  const wait: WaitMap = new Map(
    waitRows.map((w) => [w.id, !w.staff || w.rep > w.staff ? new Date(w.rep).getTime() : null]),
  );

  const now = Date.now();
  const staleBefore = now - DAY_MS;

  // ── Số liệu trên dải tối (theo khoảng thời gian, chưa lọc góc nhìn) ──────
  // Dải tối trả lời "đang có gì trên bàn": chỉ tính phiếu ĐANG MỞ.
  const open = all.filter((t) => OPEN_STATUSES.includes(t.status));
  const byStatus = OPEN_STATUSES.map((s) => ({
    s,
    n: open.filter((t) => t.status === s).length,
  }));
  const SYS_COLORS = ["var(--mint)", "var(--amber)", "var(--peach)", "var(--sky)", "var(--rose)", "#b9b3a6"];
  const sysMap = new Map<string, number>();
  for (const t of open) {
    const k = t.systemName?.trim() || t.form.name;
    sysMap.set(k, (sysMap.get(k) ?? 0) + 1);
  }
  const sysSorted = [...sysMap.entries()].sort((a, b) => b[1] - a[1]);
  const bySystem = [
    ...sysSorted.slice(0, 5),
    ...(sysSorted.length > 5
      ? [["Khác", sysSorted.slice(5).reduce((s, x) => s + x[1], 0)] as [string, number]]
      : []),
  ].map(([label, n], i) => ({ label, n, color: SYS_COLORS[i % SYS_COLORS.length] }));

  // Phản hồi đầu tiên: sự kiện đầu (nhận phiếu, đổi trạng thái…) hoặc trả lời
  // đầu của người khác người gửi — cái nào tới trước.
  const firstTouch = (t: Row) => {
    const c = t.comments.find((c) => c.authorUserId !== t.reporterUserId);
    const times = [t.events[0]?.createdAt, c?.createdAt]
      .filter((d): d is Date => Boolean(d))
      .map((d) => d.getTime());
    return times.length ? Math.min(...times) : undefined;
  };
  const measurable = all.filter((t) => {
    const ft = firstTouch(t);
    return ft !== undefined || t.createdAt.getTime() < staleBefore;
  });
  const fast = measurable.filter((t) => {
    const ft = firstTouch(t);
    return ft !== undefined && ft - t.createdAt.getTime() <= DAY_MS;
  }).length;
  void fast;
  void measurable;
  // "Đúng hạn": phiếu mở không có ai phải chờ quá 24 giờ mới được trả lời.
  const onTime = open.filter((t) => {
    const w = wait.get(t.id);
    return w == null || w >= staleBefore;
  }).length;
  const pctFast = open.length ? Math.round((onTime / open.length) * 100) : null;

  const views = VIEWS.filter(
    (v) => (v.k === "cho-duyet" ? approver : true) && (handler || !["cua-toi", "chua-giao"].includes(v.k)),
  );
  const pendingMine = all.filter((t) => canApprove(me, t)).length;
  const requested = VIEWS.some((v) => v.k === p.xem) ? (p.xem as ViewKey) : null;
  const view: ViewKey = requested ?? (pendingMine ? "cho-duyet" : "mo");
  const viewCount = (v: ViewKey) => all.filter((t) => inView(t, v, me, staleBefore, wait)).length;
  const counts = Object.fromEntries(VIEWS.map((v) => [v.k, viewCount(v.k)])) as Record<ViewKey, number>;

  // Biểu đồ 30 ngày gần nhất — luôn 30 ngày, để thấy nhịp dù đang lọc gì.
  const today0 = new Date(new Date().toDateString()).getTime();
  const hist = Array.from({ length: 30 }, (_, i) => {
    const from = today0 - (29 - i) * DAY_MS;
    return {
      from,
      n: all.filter((t) => {
        const c = t.createdAt.getTime();
        return c >= from && c < from + DAY_MS;
      }).length,
    };
  });
  const histMax = Math.max(1, ...hist.map((h) => h.n));

  // ── Danh sách ───────────────────────────────────────────────────────────
  let rows = all.filter((t) => inView(t, view, me, staleBefore, wait));
  if (p.loai) rows = rows.filter((t) => t.form.key === p.loai);
  if (p.uu && p.uu in PRIORITY_LABEL) rows = rows.filter((t) => t.priority === p.uu);
  if (p.nguoi) rows = rows.filter((t) => t.reporterUserId === p.nguoi);
  if (p.he) rows = rows.filter((t) => (t.systemName ?? "") === (p.he === "-" ? "" : p.he));
  if (p.dv) rows = rows.filter((t) => (t.reporterUnit ?? "") === (p.dv === "-" ? "" : p.dv));
  if (p.xl) rows = rows.filter((t) => (p.xl === "chua" ? !t.assigneeUserId : t.assigneeUserId === p.xl));
  if (q)
    rows = rows.filter((t) =>
      [t.code, t.title, t.reporterName, t.reporterUnit ?? "", t.assigneeName ?? "", t.systemName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  // Đếm theo trạng thái TRƯỚC khi lọc trạng thái — để thanh tab luôn cho thấy
  // mỗi trạng thái còn bao nhiêu phiếu trong các bộ lọc khác đang bật.
  const beforeStatus = rows;
  if (tt) rows = rows.filter((t) => t.status === tt);
  const dateOf = (t: Row) => (sort === "cap-nhat" ? t.updatedAt : t.createdAt);
  const waitOf = (t: Row) => wait.get(t.id) ?? Number.POSITIVE_INFINITY;
  rows.sort((a, b) =>
    sort === "cho"
      ? waitOf(a) - waitOf(b) || a.createdAt.getTime() - b.createdAt.getTime()
      : sort === "uu-tien"
      ? PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || b.updatedAt.getTime() - a.updatedAt.getTime()
      : sort === "cu"
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : dateOf(b).getTime() - dateOf(a).getTime(),
  );
  const statusTabs = (Object.keys(STATUS_LABEL) as TicketStatus[])
    .map((s) => ({ s, n: beforeStatus.filter((t) => t.status === s).length }))
    .filter((x) => x.n > 0 || x.s === tt);

  // Lựa chọn cho các nút lọc thả xuống — lấy từ chính dữ liệu đang có.
  const countBy = (key: (t: Row) => string) => {
    const m = new Map<string, number>();
    for (const t of all.filter((t) => inView(t, view, me, staleBefore, wait))) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const menu = (param: string, allLabel: string, opts: { v: string; label: string; n?: number }[]) => [
    { label: allLabel, href: hrefWith(base, p, { [param]: undefined }), on: !p[param] },
    ...opts.map((o) => ({ label: o.label, n: o.n, href: hrefWith(base, p, { [param]: o.v }), on: p[param] === o.v })),
  ];
  const formCounts = new Map(countBy((t) => t.form.key));
  const menus = [
    { label: "Loại", options: menu("loai", "Mọi loại", forms.map((f) => ({ v: f.key, label: f.name, n: formCounts.get(f.key) ?? 0 }))) },
    { label: "Hệ thống", options: menu("he", "Mọi hệ thống", countBy((t) => t.systemName ?? "").map(([k, n]) => ({ v: k || "-", label: k || "(không ghi)", n }))) },
    { label: "Mức độ", options: menu("uu", "Mọi mức độ", (["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((k) => ({ v: k, label: PRIORITY_LABEL[k] }))) },
    {
      label: "Người xử lý",
      options: menu("xl", "Mọi người xử lý", [{ v: "chua", label: "Chưa ai nhận" }, ...staff.map((x) => ({ v: x.userId, label: x.userId === me.id ? `${x.name} (tôi)` : x.name }))]),
    },
    { label: "Đơn vị gửi", options: menu("dv", "Mọi đơn vị", countBy((t) => t.reporterUnit ?? "").map(([k, n]) => ({ v: k || "-", label: k || "(không ghi)", n }))) },
  ];
  const SORTS = [
    { v: "cho", label: "Chờ phản hồi lâu nhất" },
    { v: "moi", label: "Mới nhất" },
    { v: "uu-tien", label: "Mức độ cao trước" },
    { v: "cap-nhat", label: "Cập nhật gần đây" },
    { v: "cu", label: "Cũ nhất trước" },
  ];

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const groups =
    sort === "uu-tien"
      ? [{ label: "Theo mức độ", items: shown }]
      : sort === "cho"
        ? groupRuns(shown, (t) => (wait.get(t.id) != null ? "Đang chờ bên xử lý trả lời" : "Không chờ bên xử lý"))
        : groupRuns(shown, (t) => bucketOf(dateOf(t)));
  const waitText = (t: Row) => {
    if (t.status === "WAITING") return "chờ người gửi";
    const w = wait.get(t.id);
    if (w == null) return "—";
    const m = Math.max(0, Math.round((now - w) / 60000));
    return m < 60 ? `${m} phút` : m < 48 * 60 ? `${Math.round(m / 60)} giờ` : `${Math.round(m / 1440)} ngày`;
  };
  const toRow = (t: Row): QueueRow => ({
    id: t.id,
    code: t.code,
    title: t.title,
    reporter: `${t.reporterName}${t.reporterUnit ? ` · ${t.reporterUnit}` : ""}`,
    form: t.form.name,
    system: t.systemName ?? "",
    priority: t.priority,
    status: t.status,
    assignee: t.assigneeName,
    wait: waitText(t),
    late: (wait.get(t.id) ?? now) < staleBefore,
    flag:
      t.approvalStatus === "PENDING"
        ? `Chờ duyệt · ${t.approvalUnitName ?? "quản trị"}`
        : t.escalation >= 2
          ? "Quá hạn xử lý"
          : t.escalation === 1
            ? "Quá hạn phản hồi"
            : null,
  });
  const qs = new URLSearchParams(
    Object.entries(p).filter((e): e is [string, string] => Boolean(e[1]) && e[0] !== "trang"),
  ).toString();

  const chips: { label: string; href: string }[] = [];
  if (range.key !== "tat-ca")
    chips.push({ label: `Thời gian: ${range.label}`, href: hrefWith(base, p, { tg: undefined, tu: undefined, den: undefined }) });
  if (tt) chips.push({ label: `Trạng thái: ${STATUS_LABEL[tt]}`, href: hrefWith(base, p, { tt: undefined }) });
  if (p.loai) {
    const f = forms.find((f) => f.key === p.loai);
    chips.push({ label: `Loại: ${f?.name ?? p.loai}`, href: hrefWith(base, p, { loai: undefined }) });
  }
  if (p.uu && p.uu in PRIORITY_LABEL)
    chips.push({ label: `Mức độ: ${PRIORITY_LABEL[p.uu as keyof typeof PRIORITY_LABEL]}`, href: hrefWith(base, p, { uu: undefined }) });
  if (q) chips.push({ label: `Tìm: “${p.q}”`, href: hrefWith(base, p, { q: undefined }) });
  if (p.he) chips.push({ label: `Hệ thống: ${p.he === "-" ? "(không ghi)" : p.he}`, href: hrefWith(base, p, { he: undefined }) });
  if (p.dv) chips.push({ label: `Đơn vị: ${p.dv === "-" ? "(không ghi)" : p.dv}`, href: hrefWith(base, p, { dv: undefined }) });
  if (p.nguoi) {
    const who = all.find((t) => t.reporterUserId === p.nguoi)?.reporterName ?? "một người";
    chips.push({ label: `Người gửi: ${who}`, href: hrefWith(base, p, { nguoi: undefined }) });
  }
  if (p.xl) {
    const who = p.xl === "chua" ? "chưa ai nhận" : (staff.find((x) => x.userId === p.xl)?.name ?? "—");
    chips.push({ label: `Xử lý: ${who}`, href: hrefWith(base, p, { xl: undefined }) });
  }

  const KPIS: { k: ViewKey; label: string; tone: string }[] = [
    { k: "chua-giao", label: "Chưa ai nhận", tone: "var(--sky)" },
    { k: "qua-han", label: "Quá 24 giờ", tone: "var(--rose)" },
    { k: "cho", label: "Chờ người gửi", tone: "var(--amber)" },
    { k: "cua-toi", label: "Phiếu tôi nhận", tone: "var(--mint)" },
  ];
  const kpis = [
    ...(approver ? [{ k: "cho-duyet" as ViewKey, label: "Chờ duyệt", tone: "var(--amber)" }] : []),
    ...KPIS.filter((k) => handler || !["cua-toi", "chua-giao"].includes(k.k)),
  ].slice(0, 4);

  return (
    <>
      {/* ── Vùng sáng: tiêu đề + khoảng thời gian ───────────────────────── */}
      <section className="grid gap-6 px-5 pb-2 pt-8 sm:px-10 lg:grid-cols-[1fr_auto] lg:items-end lg:pt-12">
        <div>
          <p className="eyebrow muted">{homNay()}</p>
          <h1 className="mt-1 text-[clamp(44px,5.4vw,76px)] font-medium leading-none tracking-[-0.04em]">
            Hàng đợi
          </h1>
          <p className="muted mt-3 text-sm">
            {counts.mo} phiếu đang mở · {all.length} phiếu trong khoảng “{range.label}”
            {all.length >= CAP ? ` (chỉ tính ${CAP} phiếu mới nhất)` : ""}.
          </p>
        </div>

        <div className="space-y-3">
          <nav aria-label="Khoảng thời gian" className="raise flex flex-wrap gap-1 rounded-[22px] p-1.5 sm:rounded-full">
            {RANGES.map((r) => {
              const on = range.key === r.k;
              return (
                <Link scroll={false}
                  key={r.k}
                  href={hrefWith(base, p, { tg: r.k === "tat-ca" ? undefined : r.k, tu: undefined, den: undefined })}
                  aria-current={on ? "true" : undefined}
                  className={"tap rounded-full px-3.5 py-2 text-[13px] " + (on ? "press font-medium" : "muted hover:text-[var(--text)]")}
                >
                  {r.label}
                </Link>
              );
            })}
          </nav>
          <Form action={base} scroll={false} className="flex flex-wrap items-center gap-2 text-[13px]">
            {Object.entries(p)
              .filter(([k, v]) => v && !["tg", "tu", "den", "trang"].includes(k))
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <label className="muted" htmlFor="tu">Từ</label>
            <input id="tu" name="tu" type="date" defaultValue={p.tu} className="field w-auto rounded-full px-3 py-1.5 text-[13px]" />
            <label className="muted" htmlFor="den">đến</label>
            <input id="den" name="den" type="date" defaultValue={p.den} className="field w-auto rounded-full px-3 py-1.5 text-[13px]" />
            <button type="submit" className="btn btn-ghost px-4 py-1.5 text-[13px]">Áp dụng</button>
          </Form>
        </div>

        <div className="lg:col-span-2">
          <div className="press flex h-24 items-end gap-[3px] rounded-[22px] px-4 pb-3 pt-4" role="img" aria-label="Số phiếu gửi mỗi ngày trong 30 ngày gần nhất">
            {hist.map((h, i) => (
              <span
                key={h.from}
                title={`${new Date(h.from).toLocaleDateString("vi-VN")}: ${h.n} phiếu`}
                className={"flex-1 rounded-t-md " + (i === hist.length - 1 ? "bg-[var(--amber)]" : "bg-[var(--slate-back)]")}
                style={{ height: `${Math.max(h.n ? 8 : 3, (h.n / histMax) * 100)}%`, opacity: h.n ? 1 : 0.35 }}
              />
            ))}
          </div>
          <p className="muted mt-1.5 flex justify-between px-1 text-[11px]">
            <span>30 ngày trước</span>
            <span>Hôm nay</span>
          </p>
        </div>
      </section>

      <CurveDown />

      {/* ── Dải tối: đĩa số liệu, vòng đo, nút số ─────────────────────── */}
      <section className="band px-5 pb-6 sm:px-10">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr_auto]">
          <Dial
            title="Đang mở · theo trạng thái"
            total={open.length}
            parts={byStatus.map((x) => ({ label: STATUS_LABEL[x.s], n: x.n, color: STATUS_TONE[x.s], href: hrefWith(base, p, { xem: "tat-ca", tt: x.s }) }))}
          />
          <Dial
            title="Đang mở · theo hệ thống"
            total={open.length}
            parts={bySystem.map((x) => ({ ...x, href: hrefWith(base, p, { xem: "tat-ca", q: x.label === "Khác" ? undefined : x.label }) }))}
          />
          <div className="raise-d flex flex-col items-center justify-center gap-3 rounded-[28px] p-6">
            <div
              className="disc flex h-32 w-32 items-center justify-center"
              role="img"
              aria-label={pctFast === null ? "Không có phiếu mở" : `${pctFast}% phiếu đang mở được trả lời trong 24 giờ`}
              style={{ background: `conic-gradient(var(--amber) 0 ${(pctFast ?? 0) * 3.6}deg, var(--slate-deep) 0 360deg)` }}
            >
              <span className="raise-d flex h-20 w-20 flex-col items-center justify-center rounded-full">
                <span className="text-2xl font-medium leading-none">{pctFast === null ? "—" : `${pctFast}%`}</span>
                <span className="muted mt-1 text-[10px]">đúng hạn</span>
              </span>
            </div>
            <p className="max-w-[11rem] text-center text-sm">
              Phiếu mở đã có trả lời trong 24 giờ
              <span className="muted block text-xs">{onTime}/{open.length} phiếu</span>
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => {
            const on = view === k.k;
            return (
              <Link scroll={false}
                key={k.k}
                href={hrefWith(base, p, { xem: k.k, tt: undefined })}
                aria-current={on ? "true" : undefined}
                className={(on ? "press-d" : "raise-d hover:-translate-y-0.5") + " tap flex items-center justify-between gap-3 rounded-[22px] px-5 py-4 transition-transform"}
              >
                <span>
                  <span className="block text-3xl font-medium tabular-nums">{counts[k.k]}</span>
                  <span className="muted text-sm">{k.label}</span>
                </span>
                <Led color={k.tone} off={!counts[k.k]} />
              </Link>
            );
          })}
        </div>
      </section>

      <CurveUp />

      {/* ── Vùng sáng: góc nhìn + danh sách ──────────────────────────── */}
      <section className="grid gap-6 px-5 pb-6 pt-2 sm:px-10 lg:grid-cols-[15rem_1fr] lg:items-start">
        <aside className="space-y-4 lg:sticky lg:top-6">
          <nav aria-label="Góc nhìn" className="press space-y-1 rounded-[26px] p-2">
            {views.map((v) => {
              const on = view === v.k;
              return (
                <Link scroll={false}
                  key={v.k}
                  href={hrefWith(base, p, { xem: v.k === "mo" ? undefined : v.k, tt: undefined })}
                  aria-current={on ? "page" : undefined}
                  className={"tap flex items-center justify-between gap-2 rounded-full px-4 py-2.5 text-sm " + (on ? "raise font-medium" : "muted hover:text-[var(--text)]")}
                >
                  {v.label}
                  <span className="font-mono text-xs tabular-nums">{counts[v.k]}</span>
                </Link>
              );
            })}
          </nav>
          <SavedFilters current={qs} label={chips.map((c) => c.label).join(" · ") || "Bộ lọc của tôi"} />
          <Link href={handler ? "/phieu?cua=toi" : "/phieu"} className="muted tap block rounded-full px-4 text-sm hover:text-[var(--text)]">
            Phiếu do tôi gửi →
          </Link>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Form action={base} scroll={false} role="search" className="press flex min-w-[16rem] flex-1 items-center gap-2 rounded-full py-1 pl-4 pr-1">
              {Object.entries(p)
                .filter(([k, v]) => v && k !== "q" && k !== "trang")
                .map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
              <span aria-hidden className="muted">⌕</span>
              <label htmlFor="q" className="sr-only">Tìm phiếu</label>
              <input id="q" name="q" type="search" defaultValue={p.q} placeholder="Mã, tiêu đề, người gửi, email…" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
            </Form>
            {menus.map((m) => (
              <FilterMenu key={m.label} label={m.label} options={m.options} />
            ))}
            <span className="muted ml-auto text-[13px]">Sắp xếp</span>
            <FilterMenu
              plain
              label={SORTS.find((x) => x.v === sort)?.label ?? "Sắp xếp"}
              options={SORTS.map((x) => ({ label: x.label, href: hrefWith(base, p, { sx: x.v === "cho" ? undefined : x.v }), on: sort === x.v }))}
            />
          </div>

          {chips.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="muted text-[13px]">Đang lọc</span>
              {chips.map((c) => (
                <span key={c.label} className="raise-d inline-flex items-center gap-2 rounded-full py-1 pl-4 pr-1 text-[13px] text-[var(--on-dark)]">
                  {c.label}
                  <Link scroll={false} href={c.href} aria-label={`Bỏ lọc ${c.label}`} className="press-d tap flex h-6 w-6 items-center justify-center rounded-full text-xs">
                    ×
                  </Link>
                </span>
              ))}
              <Link scroll={false} href={hrefWith(base, {}, { xem: p.xem })} className="muted tap rounded px-2 text-[13px] hover:underline">
                Xoá tất cả
              </Link>
            </div>
          ) : null}

          <nav aria-label="Trạng thái" className="press flex flex-wrap gap-1 rounded-[22px] p-1.5 sm:rounded-full">
            <Link scroll={false}
              href={hrefWith(base, p, { tt: undefined })}
              aria-current={!tt ? "page" : undefined}
              className={"tap inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] " + (!tt ? "raise font-medium" : "muted hover:text-[var(--text)]")}
            >
              Tất cả <span className="font-mono text-xs">{beforeStatus.length}</span>
            </Link>
            {statusTabs.map((x) => (
              <Link scroll={false}
                key={x.s}
                href={hrefWith(base, p, { tt: x.s })}
                aria-current={tt === x.s ? "page" : undefined}
                className={"tap inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] " + (tt === x.s ? "raise font-medium" : "muted hover:text-[var(--text)]")}
              >
                <Led color={STATUS_TONE[x.s]} off={tt !== x.s} />
                {STATUS_LABEL[x.s]}
                <span className="font-mono text-xs">{x.n}</span>
              </Link>
            ))}
          </nav>

          {rows.length === 0 ? (
            <div className="card px-6 py-14 text-center">
              <p className="text-lg font-medium">Không có phiếu nào khớp</p>
              <p className="muted mx-auto mt-1 max-w-sm text-sm">
                Thử nới khoảng thời gian hoặc bỏ bớt bộ lọc.
              </p>
            </div>
          ) : (
            <QueueList
              groups={groups.map((g) => ({ label: g.label, rows: g.items.map(toRow) }))}
              staff={staff}
              meId={me.id}
              selectable={handler}
            />
          )}

          {rows.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <span className="muted flex items-center gap-2 text-sm">
                {(cur - 1) * PAGE + 1}–{Math.min(cur * PAGE, rows.length)} trong {rows.length} ·
                <FilterMenu
                  plain
                  label={`Mỗi trang ${PAGE}`}
                  options={PER_PAGE.map((n) => ({ label: `${n} phiếu`, href: hrefWith(base, p, { ms: n === 25 ? undefined : String(n) }), on: n === PAGE }))}
                />
              </span>
              {pages > 1 ? (
                <nav aria-label="Phân trang" className="press flex items-center gap-1 rounded-full p-1">
                  {cur > 1 ? (
                    <Link scroll={false} href={hrefWith(base, p, { trang: String(cur - 1) })} aria-label="Trang trước" className="raise tap flex h-9 w-9 items-center justify-center rounded-full">‹</Link>
                  ) : (
                    <span aria-hidden className="muted flex h-9 w-9 items-center justify-center">‹</span>
                  )}
                  {Array.from({ length: pages }, (_, i) => i + 1)
                    .filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1)
                    .map((n, i, arr) => (
                      <span key={n} className="flex items-center">
                        {i > 0 && n - arr[i - 1] > 1 ? <span className="muted px-1">…</span> : null}
                        <Link scroll={false}
                          href={hrefWith(base, p, { trang: String(n) })}
                          aria-current={n === cur ? "page" : undefined}
                          className={"tap flex h-9 min-w-9 items-center justify-center rounded-full px-2 font-mono text-sm " + (n === cur ? "raise-d text-[var(--on-dark)]" : "")}
                        >
                          {n}
                        </Link>
                      </span>
                    ))}
                  {cur < pages ? (
                    <Link scroll={false} href={hrefWith(base, p, { trang: String(cur + 1) })} aria-label="Trang sau" className="raise tap flex h-9 w-9 items-center justify-center rounded-full">›</Link>
                  ) : (
                    <span aria-hidden className="muted flex h-9 w-9 items-center justify-center">›</span>
                  )}
                </nav>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

/** Đĩa tròn 3D: các múi màu, viền có vạch chia, nút tổng nổi ở giữa. */
function Dial({
  title,
  total,
  parts,
}: {
  title: string;
  total: number;
  parts: { label: string; n: number; color: string; href: string }[];
}) {
  const nonzero = parts.filter((x) => x.n > 0);
  return (
    <div className="raise-d flex flex-col gap-5 rounded-[28px] p-6 sm:flex-row sm:items-center">
      <div
        className="disc mx-auto flex h-36 w-36 shrink-0 items-center justify-center sm:mx-0"
        role="img"
        aria-label={`${title}: ${nonzero.map((x) => `${x.label} ${x.n}`).join(", ") || "chưa có phiếu"}`}
        style={{ background: pie(parts) }}
      >
        <span className="raise-d flex h-16 w-16 flex-col items-center justify-center rounded-full">
          <span className="text-xl font-medium leading-none">{total}</span>
          <span className="muted mt-0.5 text-[10px]">phiếu</span>
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="eyebrow muted">{title}</h2>
        <ul className="mt-3 space-y-1">
          {(nonzero.length ? nonzero : parts.slice(0, 3)).map((x) => (
            <li key={x.label}>
              <Link scroll={false} href={x.href} className="tap flex items-center gap-2.5 rounded-full px-2 py-1 text-sm hover:bg-white/5">
                <Led color={x.color} off={!x.n} />
                <span className="min-w-0 flex-1 truncate">{x.label}</span>
                <span className="muted font-mono text-xs tabular-nums">{x.n}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
