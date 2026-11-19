import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isHandler } from "@/lib/access";
import { SLA_HOURS, slaText } from "@/lib/sla";
import { PRIORITY_LABEL } from "@/lib/labels";
import { CurveDown, CurveUp } from "@/components/ui";
import { AddMember, AddRole, AddTeam, MemberRow, RoleRow } from "./team-actions";

export const dynamic = "force-dynamic";

/** Nhóm hỗ trợ, thành viên và vai trò toàn hệ. Ai trong nhóm cũng xem được; chỉ quản trị sửa. */
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/dang-nhap?next=/nhom");
  if (!isHandler(user.access)) notFound();
  const edit = user.access.sysAdmin;

  const [teams, roles, forms, liaisons] = await Promise.all([
    prisma.ticketTeam.findMany({
      orderBy: { sortOrder: "asc" },
      include: { members: { orderBy: [{ role: "asc" }, { name: "asc" }] } },
    }),
    prisma.ticketRole.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.ticketForm.findMany({ select: { name: true, defaultTeam: true, isActive: true } }),
    prisma.ticketStaff.findMany({
      where: { cmsRole: "ADMIN", unitId: { not: null } },
      orderBy: [{ unit: "asc" }, { name: "asc" }],
      select: { email: true, name: true, unit: true },
    }),
  ]);
  const seen = new Set((await prisma.ticketStaff.findMany({ select: { email: true } })).map((s) => s.email.toLowerCase()));

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-5 px-5 pb-2 pt-8 sm:px-9 lg:pt-10">
        <div>
          <h1 className="text-[clamp(40px,5vw,68px)] font-medium leading-none tracking-[-0.04em]">Nhóm hỗ trợ</h1>
          <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">
            Phiếu tới nhóm theo loại yêu cầu. Thành viên thấy và xử lý phiếu của nhóm mình; trưởng nhóm giao việc, sửa mẫu
            biểu của nhóm và nhận cảnh báo quá hạn.{edit ? "" : " Chỉ quản trị hệ thống sửa được trang này."}
          </p>
        </div>
      </section>
      <CurveDown />

      <section className="band px-5 pb-6 sm:px-9">
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          {teams.map((t) => {
            const fs = forms.filter((f) => f.defaultTeam === t.name);
            return (
              <article key={t.id} className="raise-d flex flex-col gap-3 rounded-[30px] p-5">
                <header>
                  <h2 className="text-xl font-medium">{t.name}</h2>
                  {t.description ? <p className="text-sm font-light text-[var(--on-dark-muted)]">{t.description}</p> : null}
                  <p className="mt-1 text-xs text-[var(--on-dark-muted)]">
                    Nhận: {fs.length ? fs.map((f) => f.name + (f.isActive ? "" : " (tắt)")).join(", ") : "chưa có loại yêu cầu nào"}
                  </p>
                </header>
                <ul className="flex flex-col gap-1.5">
                  {t.members.length ? (
                    t.members.map((m) => (
                      <MemberRow
                        key={m.email}
                        teamId={t.id}
                        email={m.email}
                        name={m.name}
                        lead={m.role === "LEAD"}
                        seen={seen.has(m.email.toLowerCase())}
                        edit={edit}
                      />
                    ))
                  ) : (
                    <li className="press-d rounded-[18px] px-4 py-3 text-sm text-[#f3c9a8]">
                      Chưa có thành viên — phiếu của nhóm sẽ gửi tới quản trị hệ thống.
                    </li>
                  )}
                </ul>
                {edit ? <AddMember teamId={t.id} /> : null}
              </article>
            );
          })}
          {edit ? <AddTeam /> : null}
        </div>
      </section>
      <CurveUp />

      <div className="grid gap-5 px-5 pb-10 pt-1.5 sm:px-9 xl:grid-cols-2">
        <section className="raise flex flex-col gap-3 rounded-[30px] p-5">
          <h2 className="text-lg font-medium">Quản trị hệ thống &amp; Ban Chủ nhiệm</h2>
          <p className="muted text-xs">
            Quản trị hệ thống: toàn quyền (tài khoản SUPER_ADMIN của web Khoa luôn có quyền này). Ban Chủ nhiệm: xem Báo
            cáo và các phiếu bị leo thang, nhận thư khi phiếu Khẩn quá hạn xử lý.
          </p>
          <ul className="flex flex-col gap-1.5">
            {roles.map((r) => (
              <RoleRow key={r.email} email={r.email} name={r.name} role={r.role} edit={edit} self={r.email === user.email.toLowerCase()} />
            ))}
            {roles.length ? null : <li className="muted text-sm">Chưa gán ai.</li>}
          </ul>
          {edit ? <AddRole /> : null}
        </section>

        <section className="raise flex flex-col gap-3 rounded-[30px] p-5">
          <h2 className="text-lg font-medium">Đầu mối đơn vị</h2>
          <p className="muted text-xs">
            Tự động: tài khoản quản trị (ADMIN) của bộ môn, Văn phòng Khoa, Đoàn – Hội, CLB trên web Khoa. Họ xem phiếu của
            đơn vị mình, duyệt yêu cầu cấp quyền, xử lý phiếu sửa nội dung trang đơn vị. Danh sách dưới đây là những người
            đã từng vào hệ hỗ trợ — đơn vị chưa có ai vào thì quản trị hệ thống duyệt thay.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {liaisons.map((l) => (
              <li key={l.email} className="press flex flex-wrap items-baseline justify-between gap-2 rounded-[16px] px-4 py-2">
                <span className="font-medium">{l.unit}</span>
                <span className="muted text-xs">
                  {l.name} · {l.email}
                </span>
              </li>
            ))}
            {liaisons.length ? null : <li className="muted">Chưa có đầu mối nào đăng nhập.</li>}
          </ul>
        </section>

        <section className="raise flex flex-col gap-3 rounded-[30px] p-5 xl:col-span-2">
          <h2 className="text-lg font-medium">Thời hạn (giờ hành chính: T2–T6, 7:30–11:30 &amp; 13:00–17:00)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="muted text-left text-xs">
                <th className="py-1.5 font-normal">Mức độ</th>
                <th className="py-1.5 font-normal">Phản hồi đầu</th>
                <th className="py-1.5 font-normal">Xử lý xong</th>
                <th className="py-1.5 font-normal">Quá hạn thì báo</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(SLA_HOURS) as (keyof typeof SLA_HOURS)[]).map((k) => (
                <tr key={k} className="border-t border-[var(--line)]">
                  <td className="py-2 font-medium">{PRIORITY_LABEL[k]}</td>
                  <td className="py-2">{slaText(SLA_HOURS[k].response)}</td>
                  <td className="py-2">{slaText(SLA_HOURS[k].resolve)}</td>
                  <td className="muted py-2">
                    Trưởng nhóm → quản trị hệ thống{k === "URGENT" ? " → Ban Chủ nhiệm" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
