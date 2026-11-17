import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OPEN_STATUSES, STATUS_LABEL } from "@/lib/ticket";
import { STATUS_TONE } from "@/lib/labels";
import type { Prisma, TicketStatus } from "@/generated/prisma/client";
import { CurveDown, CurveUp, Led, homNay } from "@/components/ui";
import { canSeeReport, queueScope } from "@/lib/access";
import { DAY_MS, RANGES, hrefWith, pie, resolveRange, type Params } from "../phieu/filters";

export const dynamic = "force-dynamic";

const BASE = "/bao-cao";
const HOUR = 3_600_000;

/** "3 giờ", "2,5 ngày" — thời lượng dễ đọc. */
function dur(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))} phút`;
  if (ms < 48 * HOUR) return `${(ms / HOUR).toFixed(ms < 10 * HOUR ? 1 : 0).replace(".", ",")} giờ`;
  return `${(ms / DAY_MS).toFixed(1).replace(".", ",")} ngày`;
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const ddmm = (d: Date) => {
  const p = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "day")?.value}.${p.find((x) => x.type === "month")?.value}`;
};

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await currentUser();
  if (!user) redirect("/dang-nhap?next=/bao-cao");
  if (!canSeeReport(user.access)) notFound();

  const p = await searchParams;
  // Mặc định 30 ngày: đủ dài để thấy nhịp, đủ ngắn để còn ý nghĩa cho tuần này.
  const range = resolveRange({ ...p, tg: p.tg ?? (p.tu || p.den ? undefined : "30") });
  const now = Date.now();
  const from = range.from?.getTime() ?? null;
  const to = range.to?.getTime() ?? now;

  const where: Prisma.TicketWhereInput = {};
  if (range.from || range.to) where.createdAt = { gte: range.from, lt: range.to };
  // Báo cáo theo đúng phạm vi người xem: Ban Chủ nhiệm / quản trị thấy toàn Khoa,
  // trưởng nhóm thấy nhóm mình, đầu mối thấy đơn vị mình.
  const a = user.access;
  if (!a.sysAdmin && !a.board) {
    const scope = queueScope({ ...a, board: false });
    if (scope) Object.assign(where, scope);
  }

  const [tickets, firsts, openNow] = await Promise.all([
    prisma.ticket.findMany({
      where,
      take: 5000,
      select: {
        id: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        closedAt: true,
        systemName: true,
        team: true,
        reporterUnit: true,
        assigneeUserId: true,
        assigneeName: true,
        rating: true,
        form: { select: { name: true } },
      },
    }),
    // Lần ĐẦU bên xử lý động tới phiếu: trả lời công khai, nhận phiếu, đổi trạng thái.
    prisma.$queryRaw<{ id: string; first: Date | null }[]>`
      SELECT t.id, LEAST(
        (SELECT min(c."createdAt") FROM "TicketComment" c
          WHERE c."ticketId" = t.id AND NOT c."isInternal" AND c."authorUserId" <> t."reporterUserId"),
        (SELECT min(e."createdAt") FROM "TicketEvent" e
          WHERE e."ticketId" = t.id AND e.kind IN ('status', 'assign')
            AND e."actorUserId" IS DISTINCT FROM t."reporterUserId")) AS first
      FROM "Ticket" t`,
    prisma.ticket.count({ where: { status: { in: OPEN_STATUSES } } }),
  ]);
  const firstOf = new Map(firsts.map((f) => [f.id, f.first ? new Date(f.first).getTime() : null]));

  // ── Số chính ───────────────────────────────────────────────────────────
  const firstResp = tickets
    .map((t) => {
      const f = firstOf.get(t.id);
      return f != null ? f - t.createdAt.getTime() : null;
    })
    .filter((x): x is number => x != null);
  const doneAt = (t: (typeof tickets)[number]) =>
    t.resolvedAt ?? (t.status === "CLOSED" ? t.closedAt : null);
  const resolveTimes = tickets
    .map((t) => {
      const d = doneAt(t);
      return d ? d.getTime() - t.createdAt.getTime() : null;
    })
    .filter((x): x is number => x != null && x >= 0);
  const done = tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;
  // Đúng hạn = được động tới trong 24 giờ. Phiếu chưa ai động mà còn chưa quá
  // 24 giờ thì CHƯA tính — chưa trễ mà cũng chưa đúng.
  const measurable = tickets.filter((t) => firstOf.get(t.id) != null || now - t.createdAt.getTime() > DAY_MS);
  const onTime = measurable.filter((t) => {
    const f = firstOf.get(t.id);
    return f != null && f - t.createdAt.getTime() <= DAY_MS;
  }).length;
  const pctOnTime = measurable.length ? Math.round((onTime / measurable.length) * 100) : null;

  // ── Biểu đồ: phiếu mới vs phiếu xong theo ngày (≤ 31 ngày) hoặc theo tuần ──
  const start = from ?? Math.min(now, ...tickets.map((t) => t.createdAt.getTime()));
  const span = Math.max(DAY_MS, to - start);
  const step = span <= 31 * DAY_MS ? DAY_MS : 7 * DAY_MS;
  const nb = Math.min(60, Math.ceil(span / step));
  const bins = Array.from({ length: nb }, (_, i) => {
    const a = start + i * step;
    const b = a + step;
    return {
      a,
      created: tickets.filter((t) => t.createdAt.getTime() >= a && t.createdAt.getTime() < b).length,
      solved: tickets.filter((t) => {
        const d = doneAt(t)?.getTime();
        return d != null && d >= a && d < b;
      }).length,
    };
  });
  const binMax = Math.max(1, ...bins.map((b) => Math.max(b.created, b.solved)));

  // ── Bảng phân tích ──────────────────────────────────────────────────────
  type T = (typeof tickets)[number];
  const breakdown = (key: (t: T) => string) => {
    const m = new Map<string, T[]>();
    for (const t of tickets) {
      const k = key(t);
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()]
      .map(([k, ts]) => ({
        k,
        n: ts.length,
        open: ts.filter((t) => OPEN_STATUSES.includes(t.status)).length,
        resolve: median(
          ts.map((t) => (doneAt(t) ? doneAt(t)!.getTime() - t.createdAt.getTime() : null)).filter((x): x is number => x != null),
        ),
        rating: avg(ts.map((t) => t.rating).filter((x): x is number => x != null)),
        rated: ts.filter((t) => t.rating != null).length,
        first: median(ts.map((t) => (firstOf.get(t.id) != null ? firstOf.get(t.id)! - t.createdAt.getTime() : null)).filter((x): x is number => x != null)),
      }))
      .sort((a, b) => b.n - a.n);
  };
  const TABLES = [
    { title: "Theo loại yêu cầu", rows: breakdown((t) => t.form.name) },
    { title: "Theo hệ thống", rows: breakdown((t) => t.systemName ?? "(không ghi)") },
    { title: "Theo nhóm phụ trách", rows: breakdown((t) => t.team ?? "(chưa có nhóm)") },
    { title: "Theo người xử lý", rows: breakdown((t) => t.assigneeName ?? "Chưa ai nhận") },
    { title: "Theo đơn vị gửi", rows: breakdown((t) => t.reporterUnit ?? "(không ghi)").slice(0, 10) },
  ];

  const byStatus = (Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => ({
    s,
    n: tickets.filter((t) => t.status === s).length,
  }));

  const ratings = tickets.map((t) => t.rating).filter((x): x is number => x != null);
  const KPI = [
    { n: String(tickets.length), label: "Phiếu mới", sub: range.label },
    { n: String(done), label: "Đã xử lý xong", sub: tickets.length ? `${Math.round((done / tickets.length) * 100)}% số phiếu` : "—" },
    { n: dur(median(firstResp)), label: "Phản hồi đầu (trung vị)", sub: `${firstResp.length} phiếu có phản hồi` },
    { n: dur(median(resolveTimes)), label: "Thời gian xử lý (trung vị)", sub: `${resolveTimes.length} phiếu đã xong` },
    {
      n: ratings.length ? `${avg(ratings)!.toFixed(1).replace(".", ",")} ★` : "—",
      label: "Mức hài lòng",
      sub: ratings.length ? `${ratings.length} lượt chấm · ${ratings.filter((r) => r <= 2).length} chưa ổn` : "chưa có lượt chấm",
    },
  ];

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-5 px-5 pb-2 pt-8 sm:px-9 lg:pt-10">
        <div>
          <span className="eyebrow muted">{homNay()}</span>
          <h1 className="mt-1 text-[clamp(44px,5.4vw,76px)] font-medium leading-none tracking-[-0.04em]">Báo cáo</h1>
          <p className="muted mt-3 text-sm">
            Phiếu gửi trong khoảng “{range.label}” · hiện có {openNow} phiếu đang mở.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <nav aria-label="Khoảng thời gian" className="press flex flex-wrap gap-1 rounded-full p-1.5">
            {RANGES.map((r) => {
              const on = range.key === r.k;
              return (
                <Link
                  key={r.k}
                  scroll={false}
                  href={hrefWith(BASE, p, { tg: r.k === "30" ? undefined : r.k, tu: undefined, den: undefined })}
                  aria-current={on ? "true" : undefined}
                  className={"tap rounded-full px-3.5 py-2 text-[13px] " + (on ? "raise font-medium" : "muted hover:text-[var(--text)]")}
                >
                  {r.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </section>
      <CurveDown />

      <section className="band px-5 pb-6 sm:px-9">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {KPI.map((k) => (
            <div key={k.label} className="raise-d flex flex-col gap-1 rounded-[26px] px-5 py-4">
              <span className="text-3xl font-medium tabular-nums">{k.n}</span>
              <span className="text-sm">{k.label}</span>
              <span className="text-xs text-[var(--on-dark-muted)]">{k.sub}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_auto_auto]">
          <figure className="raise-d flex min-w-0 flex-col gap-3 rounded-[28px] p-5">
            <figcaption className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="font-medium">Phiếu mới và phiếu xong {step === DAY_MS ? "mỗi ngày" : "mỗi tuần"}</span>
              <span className="flex gap-4 text-xs text-[var(--on-dark-muted)]">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#c9ccc9]" /> Mới</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--mint)]" /> Xong</span>
              </span>
            </figcaption>
            <div
              role="img"
              aria-label={`Biểu đồ ${nb} cột: tổng ${tickets.length} phiếu mới, ${done} phiếu xong`}
              className="press-d flex h-40 items-end gap-[3px] rounded-[20px] px-3 pb-3 pt-4"
            >
              {bins.map((b) => (
                <span key={b.a} className="flex h-full flex-1 items-end gap-[2px]" title={`${ddmm(new Date(b.a))}: ${b.created} mới, ${b.solved} xong`}>
                  <span className="flex-1 rounded-t-[4px] bg-[#c9ccc9]" style={{ height: `${(b.created / binMax) * 100}%`, minHeight: b.created ? 4 : 0 }} />
                  <span className="flex-1 rounded-t-[4px] bg-[var(--mint)]" style={{ height: `${(b.solved / binMax) * 100}%`, minHeight: b.solved ? 4 : 0 }} />
                </span>
              ))}
            </div>
            <span className="flex justify-between text-[11px] text-[var(--on-dark-muted)]">
              <span>{ddmm(new Date(start))}</span>
              <span>{ddmm(new Date(Math.min(to, now)))}</span>
            </span>
          </figure>

          <figure className="raise-d flex flex-col items-center justify-center gap-3 rounded-[28px] p-6">
            <div
              className="disc flex h-32 w-32 items-center justify-center"
              role="img"
              aria-label={pctOnTime == null ? "Chưa đủ dữ liệu" : `${pctOnTime}% phiếu được phản hồi trong 24 giờ`}
              style={{ background: `conic-gradient(var(--amber) 0 ${(pctOnTime ?? 0) * 3.6}deg, var(--slate-deep) 0 360deg)` }}
            >
              <span className="raise-d flex h-20 w-20 flex-col items-center justify-center rounded-full">
                <span className="text-2xl font-medium leading-none">{pctOnTime == null ? "—" : `${pctOnTime}%`}</span>
                <span className="mt-1 text-[10px] text-[var(--on-dark-muted)]">đúng hạn</span>
              </span>
            </div>
            <figcaption className="max-w-[11rem] text-center text-sm">
              Phản hồi trong 24 giờ
              <span className="block text-xs text-[var(--on-dark-muted)]">{onTime}/{measurable.length} phiếu</span>
            </figcaption>
          </figure>

          <figure className="raise-d flex items-center gap-5 rounded-[28px] p-6">
            <div className="disc flex h-32 w-32 shrink-0 items-center justify-center" role="img" aria-label="Phân bố trạng thái" style={{ background: pie(byStatus.map((x) => ({ n: x.n, color: STATUS_TONE[x.s] }))) }}>
              <span className="raise-d flex h-16 w-16 flex-col items-center justify-center rounded-full">
                <span className="text-xl font-medium leading-none">{tickets.length}</span>
                <span className="mt-0.5 text-[10px] text-[var(--on-dark-muted)]">phiếu</span>
              </span>
            </div>
            <figcaption>
              <ul className="space-y-1 text-sm">
                {byStatus.filter((x) => x.n).map((x) => (
                  <li key={x.s} className="flex items-center gap-2">
                    <Led color={STATUS_TONE[x.s]} />
                    <span className="flex-1">{STATUS_LABEL[x.s]}</span>
                    <span className="font-mono text-xs text-[var(--on-dark-muted)]">{x.n}</span>
                  </li>
                ))}
              </ul>
            </figcaption>
          </figure>
        </div>
      </section>
      <CurveUp />

      <div className="grid gap-5 px-5 pb-10 pt-1.5 sm:px-9 xl:grid-cols-2">
        {TABLES.map((tb) => (
          <section key={tb.title} className="raise flex min-w-0 flex-col gap-2 rounded-[30px] p-5">
            <h2 className="px-1 text-lg font-medium">{tb.title}</h2>
            {tb.rows.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="muted text-left text-xs">
                    <th className="px-2 py-1.5 font-normal">Nhóm</th>
                    <th className="px-2 py-1.5 text-right font-normal">Phiếu</th>
                    <th className="px-2 py-1.5 text-right font-normal">Đang mở</th>
                    <th className="hidden px-2 py-1.5 text-right font-normal sm:table-cell">Phản hồi đầu</th>
                    <th className="px-2 py-1.5 text-right font-normal">Xử lý xong</th>
                    <th className="px-2 py-1.5 text-right font-normal">Hài lòng</th>
                  </tr>
                </thead>
                <tbody>
                  {tb.rows.map((r) => (
                    <tr key={r.k} className="border-t border-[var(--line)]">
                      <td className="max-w-[14rem] truncate px-2 py-2">
                        <span className="flex items-center gap-2">
                          <span className="press h-2 flex-none rounded-full" style={{ width: `${Math.max(6, (r.n / (tb.rows[0]?.n || 1)) * 48)}px`, background: "var(--slate-back)" }} />
                          <span className="truncate">{r.k}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{r.n}</td>
                      <td className={"px-2 py-2 text-right font-mono tabular-nums " + (r.open ? "" : "muted")}>{r.open}</td>
                      <td className="muted hidden px-2 py-2 text-right sm:table-cell">{dur(r.first)}</td>
                      <td className="muted px-2 py-2 text-right">{dur(r.resolve)}</td>
                      <td className={"px-2 py-2 text-right " + (r.rating != null && r.rating < 3.5 ? "font-medium text-[#a1301f]" : "muted")} title={`${r.rated} lượt chấm`}>
                        {r.rating != null ? `${r.rating.toFixed(1).replace(".", ",")} ★` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted px-1 text-sm">Chưa có phiếu trong khoảng này.</p>
            )}
          </section>
        ))}
        <p className="muted text-xs xl:col-span-2">
          “Phản hồi đầu”: từ lúc gửi tới lần đầu bên xử lý trả lời, nhận phiếu hoặc đổi trạng thái. “Xử lý xong”: từ lúc gửi tới lúc chuyển sang Đã xong. Cả hai lấy trung vị, để một phiếu kéo dài bất thường không làm lệch số. “Hài lòng”: điểm trung bình người gửi chấm (1–5 sao) khi phiếu xong; dưới 3,5 tô đỏ.
        </p>
      </div>
    </>
  );
}
