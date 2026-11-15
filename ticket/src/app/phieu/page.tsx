import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { MyTickets } from "./my-tickets";
import { StaffBoard } from "./staff-board";
import type { Params } from "./filters";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await currentUser();
  if (!user) redirect("/dang-nhap?next=/phieu");

  const p = await searchParams;

  // Quản trị viên mặc định vào bàn điều phối; `cua=toi` để xem phiếu chính
  // mình gửi đi như mọi người gửi khác.
  if (user.isStaff && p.cua !== "toi") {
    return <StaffBoard me={user} p={p} />;
  }
  return (
    <MyTickets
      userId={user.id}
      p={p}
      base={user.isStaff ? { cua: "toi" } : {}}
    />
  );
}
