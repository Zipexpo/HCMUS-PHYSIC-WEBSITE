import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canOpenQueue, isHandler } from "@/lib/access";
import { StaffBoard } from "../phieu/staff-board";
import type { Params } from "../phieu/filters";

export const dynamic = "force-dynamic";

/**
 * "Phiếu đơn vị" của đầu mối đơn vị / "Leo thang" của Ban Chủ nhiệm: cùng bảng
 * với hàng đợi, nhưng chỉ chứa phiếu họ được thấy và CHỈ XEM (trừ duyệt cấp
 * quyền, và phiếu sửa nội dung đơn vị mình — làm trong trang phiếu).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await currentUser();
  if (!user) redirect("/dang-nhap?next=/don-vi");
  if (isHandler(user.access)) redirect("/phieu");
  if (!canOpenQueue(user.access)) notFound();
  return <StaffBoard me={user} p={await searchParams} base="/don-vi" />;
}
