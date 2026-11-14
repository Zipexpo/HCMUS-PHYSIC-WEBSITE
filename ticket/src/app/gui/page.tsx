import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseFields } from "@/lib/ticket";
import { TicketForm } from "./ticket-form";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ loai?: string; "tieu-de"?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/dang-nhap?next=/gui");

  const sp = await searchParams;
  const loai = sp.loai;
  const tieuDe = (sp["tieu-de"] ?? "").trim().slice(0, 200);
  const forms = await prisma.ticketForm.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }],
    select: { key: true, name: true, description: true, fields: true, defaultTeam: true },
  });

  const picked = forms.find((f) => f.key === loai) ?? forms[0];
  if (!picked) {
    return (
      <p className="card m-5 p-6 text-sm sm:m-10">
        Chưa có loại yêu cầu nào được mở.
      </p>
    );
  }

  return (
    <TicketForm
      forms={forms.map((f) => ({
        key: f.key,
        name: f.name,
        description: f.description,
        team: f.defaultTeam,
        fields: parseFields(f.fields),
      }))}
      initialKey={picked.key}
      initialTitle={tieuDe}
      email={user.email}
    />
  );
}
