import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OPEN_STATUSES } from "@/lib/ticket";
import { AUTO_CLOSE_DAYS } from "@/lib/lifecycle";
import {
  ArrowUpRight,
  CurveDown,
  CurveUp,
  ProgressCells,
  StatusTag,
  homNay,
  tuBayGio,
} from "@/components/ui";
import { ResolvedButtons } from "./home-actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/dang-nhap");
  // Người xử lý vào thẳng hàng đợi — trang này là của người gửi.
  if (user.isStaff) redirect("/phieu");

  const [forms, open, total, resolved] = await Promise.all([
    prisma.ticketForm.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { key: true, name: true, description: true, defaultTeam: true },
    }),
    prisma.ticket.findMany({
      where: { reporterUserId: user.id, status: { in: OPEN_STATUSES } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        assigneeName: true,
        updatedAt: true,
        form: { select: { name: true } },
        comments: {
          where: { isInternal: false, NOT: { authorUserId: user.id } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, createdAt: true },
        },
      },
    }),
    prisma.ticket.count({ where: { reporterUserId: user.id } }),
    prisma.ticket.findFirst({
      where: { reporterUserId: user.id, status: "RESOLVED" },
      orderBy: { resolvedAt: "desc" },
      select: { id: true, code: true, title: true },
    }),
  ]);

  // Phiếu chờ chính người gửi được kéo lên đầu: đó là việc duy nhất trên trang
  // mà nếu họ không làm thì phiếu đứng yên.
  const waiting = open.find((t) => t.status === "WAITING");
  const ask = waiting?.comments[0];
  const shown = [...open].sort((a, b) => Number(b.status === "WAITING") - Number(a.status === "WAITING")).slice(0, 3);

  return (
    <>
      {/* ── Vùng sáng: câu hỏi lớn + ô mô tả nhanh + phiếu đang chờ ──────── */}
      <section className="flex flex-wrap items-end gap-8 px-5 pb-2 pt-8 sm:px-9 lg:pt-10">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <span className="eyebrow muted">{homNay()}</span>
          <h1 className="text-[clamp(44px,6.4vw,92px)] font-medium leading-[0.98] tracking-[-0.045em]">
            Thầy/cô cần hỗ trợ
            <br />
            việc gì?
          </h1>
          {/* Gõ một câu rồi bấm — câu đó thành tiêu đề phiếu ở trang sau. */}
          <form action="/ho-tro/gui" className="raise flex max-w-[680px] items-center gap-2 rounded-full p-2">
            <label htmlFor="quick" className="sr-only">
              Mô tả ngắn sự cố
            </label>
            <input
              id="quick"
              name="tieu-de"
              type="text"
              maxLength={200}
              placeholder="Một câu về sự cố — ví dụ: không tải được ảnh…"
              className="press min-w-0 flex-1 rounded-full border-0 px-5 py-3.5 outline-none placeholder:text-[var(--muted)] focus-visible:ring-[3px] focus-visible:ring-[var(--amber)]"
            />
            <button type="submit" className="raise-d tap inline-flex h-[52px] shrink-0 items-center gap-3 rounded-full pl-5 pr-1.5 font-medium text-[var(--on-dark)]">
              Bắt đầu
              <span className="knob flex h-10 w-10 items-center justify-center rounded-full text-[#22252a]">
                <ArrowUpRight size={16} />
              </span>
            </button>
          </form>
        </div>

        {waiting ? (
          <article className="raise flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-[34px] p-6">
            <span className="flex items-center gap-2.5 text-sm font-medium text-[#6b4d00]">
              <span className="knob h-3 w-3 rounded-full" />
              Đang chờ thầy/cô bổ sung
            </span>
            <h2 className="text-[22px] font-medium leading-snug">{waiting.title}</h2>
            <p className="muted text-sm font-light">
              {ask
                ? `${waiting.assigneeName ?? "Người xử lý"}: “${ask.body.length > 120 ? `${ask.body.slice(0, 120)}…` : ask.body}” · ${tuBayGio(ask.createdAt)}`
                : `${waiting.assigneeName ?? "Người xử lý"} cần thêm thông tin để làm tiếp · ${tuBayGio(waiting.updatedAt)}`}
            </p>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-sm font-semibold">{waiting.code}</span>
              <Link
                href={`/phieu/${waiting.id}`}
                aria-label={`Bổ sung cho phiếu ${waiting.code}`}
                className="knob tap flex h-14 w-14 items-center justify-center rounded-full"
              >
                <ArrowUpRight size={22} />
              </Link>
            </div>
          </article>
        ) : null}
      </section>
      <CurveDown />

      {/* ── Dải tối: phiếu đang mở ────────────────────────────────────── */}
      <section aria-labelledby="open-h" className="band px-5 pb-6 sm:px-9">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="open-h" className="text-2xl font-medium">
            Phiếu đang mở
          </h2>
          <Link href="/phieu" className="text-sm text-[var(--amber)] hover:underline">
            {total ? `Tất cả ${total} phiếu, lọc theo thời gian ↗` : "Phiếu của tôi ↗"}
          </Link>
        </div>
        {shown.length ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {shown.map((t) => (
              <Link
                key={t.id}
                href={`/phieu/${t.id}`}
                className="raise-d tap flex flex-col gap-3 rounded-[30px] p-5 transition-transform hover:-translate-y-0.5"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{t.code}</span>
                  <StatusTag status={t.status} dark reporter />
                </span>
                <span className="text-lg font-medium leading-snug">{t.title}</span>
                <span className="mt-auto text-[13px] font-light text-[var(--on-dark-muted)]">
                  {t.form.name} · {tuBayGio(t.updatedAt)}
                </span>
                <ProgressCells status={t.status} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="max-w-lg text-sm font-light text-[var(--on-dark-muted)]">
            Không có phiếu nào đang mở. Gửi yêu cầu xong, phiếu hiện ở đây cùng tiến độ: đã gửi → tiếp nhận → đang xử lý → xong.
          </p>
        )}
      </section>
      <CurveUp />

      {/* ── Vùng sáng: chọn loại yêu cầu + phiếu vừa xong ─────────────── */}
      <div className="flex flex-col gap-6 px-5 pb-10 pt-1.5 sm:px-9">
        <section aria-labelledby="cat-h">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="cat-h" className="text-2xl font-medium">
              Chọn loại yêu cầu
            </h2>
            <span className="muted text-sm">Phiếu tới thẳng nhóm phụ trách</span>
          </div>
          {forms.length === 0 ? (
            <div className="card px-6 py-12 text-center">
              <p className="text-lg font-medium">Chưa có loại yêu cầu nào</p>
              <p className="muted mt-1 text-sm">Quản trị viên cần chạy bước nạp mẫu biểu.</p>
            </div>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
              {forms.map((f, i) => (
                <Link
                  key={f.key}
                  href={`/gui?loai=${f.key}`}
                  className="raise tap group flex flex-col gap-3 rounded-[30px] p-5 transition-transform hover:-translate-y-0.5"
                >
                  <span className="flex items-center justify-between">
                    <span className="press flex h-11 w-11 items-center justify-center rounded-full font-mono text-sm font-semibold">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="raise flex h-10 w-10 items-center justify-center rounded-full transition-transform group-hover:rotate-45">
                      <ArrowUpRight size={15} />
                    </span>
                  </span>
                  <span className="text-lg font-medium">{f.name}</span>
                  {f.description ? <span className="muted text-sm font-light leading-relaxed">{f.description}</span> : null}
                  {f.defaultTeam ? (
                    <span className="muted mt-auto text-[13px]">
                      Nhóm nhận · <span className="font-medium text-[var(--text)]">{f.defaultTeam}</span>
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </section>

        {resolved ? (
          <section aria-labelledby="done-h" className="raise flex flex-wrap items-center gap-5 rounded-[34px] p-5 pl-6">
            <span className="press flex h-14 w-14 flex-none items-center justify-center rounded-full text-xl text-[#1f5e47]">✓</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id="done-h" className="text-lg font-medium">
                <Link href={`/phieu/${resolved.id}`} className="hover:underline">
                  {resolved.code} đã xử lý xong — thầy/cô kiểm tra giúp nhé
                </Link>
              </h2>
              <span className="muted text-sm font-light">
                {resolved.title} · sau {AUTO_CLOSE_DAYS} ngày phiếu tự đóng
              </span>
            </div>
            <ResolvedButtons ticketId={resolved.id} />
          </section>
        ) : null}
      </div>
    </>
  );
}
