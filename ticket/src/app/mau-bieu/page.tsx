import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseFields } from "@/lib/ticket";
import { CurveDown, CurveUp, Led } from "@/components/ui";
import { FormEditor } from "./form-editor";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/dang-nhap?next=/mau-bieu");
  // Trang quản trị: người gửi thường coi như không tồn tại.
  if (!user.isStaff) notFound();

  const { id } = await searchParams;
  const forms = await prisma.ticketForm.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { tickets: true } } },
  });

  const isNew = id === "moi";
  const picked = isNew ? null : (forms.find((f) => f.id === id) ?? forms[0] ?? null);

  return (
    <>
      <section className="px-5 pb-2 pt-10 sm:px-10 lg:pt-12">
        <h1 className="text-[clamp(40px,5vw,68px)] font-medium leading-none tracking-[-0.04em]">
          Mẫu biểu
        </h1>
        <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">
          Sửa ở đây là trang Gửi yêu cầu đổi ngay — không cần sửa code. Phiếu
          đã gửi giữ nguyên câu trả lời cũ.
        </p>
      </section>

      <CurveDown />
      <section className="band px-5 pb-4 sm:px-10">
        <nav aria-label="Loại yêu cầu" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {forms.map((f) => {
            const on = picked?.id === f.id;
            return (
              <Link
                key={f.id}
                scroll={false}
                href={`/mau-bieu?id=${f.id}`}
                aria-current={on ? "page" : undefined}
                className={
                  (on ? "press-d" : "raise-d hover:-translate-y-0.5") +
                  " tap flex flex-col gap-1.5 rounded-[24px] p-5 transition-transform"
                }
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.name}</span>
                  <Led color={f.isActive ? "var(--mint)" : "#9aa09d"} off={!on} />
                </span>
                <span className="muted text-xs">
                  {parseFields(f.fields).length} ô riêng · {f._count.tickets} phiếu
                  {f.isActive ? "" : " · đang tắt"}
                </span>
              </Link>
            );
          })}
          <Link
            scroll={false}
            href="/mau-bieu?id=moi"
            aria-current={isNew ? "page" : undefined}
            className={
              (isNew ? "press-d" : "hover:-translate-y-0.5") +
              " tap flex items-center justify-center gap-2 rounded-[24px] border-2 border-dashed border-white/25 p-5 text-sm transition-transform"
            }
          >
            + Loại yêu cầu mới
          </Link>
        </nav>
      </section>
      <CurveUp />

      <FormEditor
        // key đổi theo mẫu đang chọn để trạng thái soạn thảo làm mới hẳn.
        key={picked?.id ?? "moi"}
        initial={
          picked
            ? {
                id: picked.id,
                key: picked.key,
                name: picked.name,
                description: picked.description ?? "",
                defaultTeam: picked.defaultTeam ?? "",
                isActive: picked.isActive,
                sortOrder: picked.sortOrder,
                fields: parseFields(picked.fields),
                ticketCount: picked._count.tickets,
              }
            : {
                key: "",
                name: "",
                description: "",
                defaultTeam: "",
                isActive: true,
                sortOrder: (forms.at(-1)?.sortOrder ?? 0) + 1,
                fields: [],
                ticketCount: 0,
              }
        }
      />
    </>
  );
}
