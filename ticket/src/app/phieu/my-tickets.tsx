import Form from "next/form";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { OPEN_STATUSES } from "@/lib/ticket";
import { STATUS_LABEL_REPORTER, STATUS_TAG_LIGHT } from "@/lib/labels";
import type { Prisma, TicketStatus } from "@/generated/prisma/client";
import { CurveDown, CurveUp, ProgressCells } from "@/components/ui";
import { RANGES, groupRuns, hrefWith, monthOf, resolveRange, type Params } from "./filters";

const BASE = "/phieu";
const STEP = 20;

const TABS = [
  { k: "tat-ca", label: "Tất cả" },
  { k: "dang-mo", label: "Đang mở" },
  { k: "cho-toi", label: "Chờ tôi bổ sung" },
  { k: "da-xong", label: "Đã xong" },
] as const;
type Tab = (typeof TABS)[number]["k"];

const DONE: TicketStatus[] = ["RESOLVED", "CLOSED", "REJECTED"];

const ddmm = (d: Date) => {
  const p = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "day")?.value}.${p.find((x) => x.type === "month")?.value}`;
};

/** Danh sách phiếu của chính người đang đăng nhập (người gửi). */
export async function MyTickets({
  userId,
  p,
  base = {},
}: {
  userId: string;
  p: Params;
  /** Tham số luôn giữ trên link (vd `cua=toi` khi quản trị xem phiếu mình gửi). */
  base?: Params;
}) {
  const range = resolveRange(p);
  const tab: Tab = TABS.some((t) => t.k === p.loc) ? (p.loc as Tab) : "tat-ca";
  const pp = { ...p, ...base };
  const q = (p.q ?? "").trim();
  const limit = Math.min(500, Math.max(STEP, Number(p.so) || STEP));

  const scope: Prisma.TicketWhereInput = { reporterUserId: userId };
  if (range.from || range.to) scope.createdAt = { gte: range.from, lt: range.to };
  if (q) {
    scope.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, forms] = await Promise.all([
    prisma.ticket.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        createdAt: true,
        form: { select: { key: true, name: true } },
      },
    }),
    prisma.ticketForm.findMany({ orderBy: { sortOrder: "asc" }, select: { key: true, name: true } }),
  ]);

  const byForm = p.loai ? items.filter((i) => i.form.key === p.loai) : items;
  const inTab = (s: TicketStatus, t: Tab) =>
    t === "tat-ca" ||
    (t === "dang-mo" && OPEN_STATUSES.includes(s)) ||
    (t === "cho-toi" && s === "WAITING") ||
    (t === "da-xong" && DONE.includes(s));
  const count = (t: Tab) => byForm.filter((i) => inTab(i.status, t)).length;
  const rows = byForm.filter((i) => inTab(i.status, tab));
  const shown = rows.slice(0, limit);
  const groups = groupRuns(shown, (t) => monthOf(t.createdAt));
  const keep = Object.entries(pp).filter(([k, v]) => v && !["q", "tg", "tu", "den", "so", "loai"].includes(k));

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-5 px-5 pb-2 pt-8 sm:px-9 lg:pt-10">
        <h1 className="text-[clamp(40px,5vw,68px)] font-medium leading-none tracking-[-0.04em]">Phiếu của tôi</h1>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Khoảng thời gian" className="press flex flex-wrap gap-1 rounded-full p-1.5">
            {RANGES.filter((r) => r.k !== "hom-nay").map((r) => {
              const on = range.key === r.k;
              return (
                <Link scroll={false}
                  key={r.k}
                  href={hrefWith(BASE, pp, { tg: r.k === "tat-ca" ? undefined : r.k, tu: undefined, den: undefined, so: undefined })}
                  aria-current={on ? "true" : undefined}
                  className={"tap rounded-full px-3.5 py-2 text-[13px] " + (on ? "raise font-medium" : "muted hover:text-[var(--text)]")}
                >
                  {r.label}
                </Link>
              );
            })}
          </nav>
          <Form action="/phieu" scroll={false} role="search" className="press flex items-center gap-2 rounded-full py-1 pl-4 pr-1">
            {keep.map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {p.tg ? <input type="hidden" name="tg" value={p.tg} /> : null}
            {p.loai ? <input type="hidden" name="loai" value={p.loai} /> : null}
            <span aria-hidden className="muted">⌕</span>
            <label htmlFor="s" className="sr-only">
              Tìm theo mã hoặc tiêu đề
            </label>
            <input id="s" name="q" type="search" defaultValue={q} placeholder="Mã hoặc tiêu đề" className="w-44 bg-transparent py-2 text-sm outline-none" />
          </Form>
        </div>
      </section>
      <CurveDown />

      <section className="band flex flex-wrap items-center justify-between gap-4 px-5 pb-5 sm:px-9">
        <div role="tablist" aria-label="Lọc theo trạng thái" className="press-d flex flex-wrap gap-1 rounded-[22px] p-1.5 sm:rounded-full">
          {TABS.map((t) => {
            const on = tab === t.k;
            const n = count(t.k);
            return (
              <Link scroll={false}
                key={t.k}
                role="tab"
                aria-selected={on}
                href={hrefWith(BASE, pp, { loc: t.k === "tat-ca" ? undefined : t.k, so: undefined })}
                className={
                  "tap inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm " +
                  (on ? "raise font-medium text-[var(--text)]" : "text-[var(--on-dark-muted)] hover:text-[var(--on-dark)]")
                }
              >
                {t.label}
                <span
                  className={
                    "rounded-full px-2 font-mono text-xs tabular-nums " +
                    (t.k === "cho-toi" && n ? "bg-[var(--amber)] text-[#22252a]" : "opacity-80")
                  }
                >
                  {n}
                </span>
              </Link>
            );
          })}
        </div>
        <Form action="/phieu" scroll={false} className="flex items-center gap-2 text-sm text-[var(--on-dark-muted)]">
          {keep.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {p.tg ? <input type="hidden" name="tg" value={p.tg} /> : null}
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <label htmlFor="loai">Loại</label>
          <select id="loai" name="loai" defaultValue={p.loai ?? ""} className="raise-d rounded-full border-0 px-4 py-2.5 text-[var(--on-dark)] outline-none">
            <option value="">Tất cả loại</option>
            {forms.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="submit" className="raise-d tap rounded-full px-4 py-2.5 text-[var(--on-dark)]">
            Lọc
          </button>
        </Form>
      </section>
      <CurveUp />

      <div className="flex flex-col gap-6 px-5 pb-10 pt-1.5 sm:px-9">
        {rows.length === 0 ? (
          <div className="raise flex flex-col items-center gap-1 rounded-[30px] px-6 py-14 text-center">
            <span className="text-lg font-medium">{items.length ? "Không có phiếu nào khớp bộ lọc" : "Thầy/cô chưa gửi phiếu nào"}</span>
            <span className="muted text-sm">
              {items.length ? "Thử mở rộng khoảng thời gian." : <Link href="/gui" className="underline">Gửi yêu cầu đầu tiên</Link>}
            </span>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="flex flex-col gap-3">
              <h2 className="flex items-baseline justify-between px-2">
                <span className="text-lg font-medium">{g.label}</span>
                <span className="muted text-[13px]">{g.items.length} phiếu</span>
              </h2>
              {g.items.map((t) => {
                const tag = STATUS_TAG_LIGHT[t.status];
                return (
                  <Link
                    key={t.id}
                    href={`/phieu/${t.id}`}
                    className="raise tap grid items-center gap-x-5 gap-y-2 rounded-[26px] px-4 py-3.5 transition-transform hover:-translate-y-0.5 [grid-template-columns:auto_1fr] md:[grid-template-columns:auto_minmax(0,1fr)_11rem_10rem]"
                  >
                    <span className="press rounded-full px-3.5 py-2 font-mono text-[13px] font-semibold">{t.code}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{t.title}</span>
                      <span className="muted text-[13px] font-light">
                        {t.form.name} · {ddmm(t.createdAt)}
                      </span>
                    </span>
                    <ProgressCells status={t.status} tone="light" className="col-start-2 md:col-auto" />
                    <span className="col-start-2 md:col-auto md:text-right">
                      <span className="inline-flex rounded-full px-3 py-1 text-xs font-medium" style={{ background: tag.bg, color: tag.fg }}>
                        {STATUS_LABEL_REPORTER[t.status]}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </section>
          ))
        )}

        {rows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-2">
            <span className="muted text-sm">
              Hiển thị {shown.length} / {rows.length} phiếu
            </span>
            {shown.length < rows.length ? (
              <Link
                href={hrefWith(BASE, pp, { so: String(limit + STEP) })}
                scroll={false}
                className="raise-d tap inline-flex h-[50px] items-center gap-3 rounded-full pl-5 pr-1.5 font-medium text-[var(--on-dark)]"
              >
                Tải thêm phiếu cũ hơn
                <span className="knob flex h-9 w-9 items-center justify-center rounded-full text-[#22252a]">↓</span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
