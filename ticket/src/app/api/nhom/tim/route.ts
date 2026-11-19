import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser, searchCmsDirectory } from "@/lib/auth";

/**
 * GET /api/nhom/tim?q=… — tìm người để thêm vào nhóm / gán vai trò.
 * Nguồn: danh bạ của Khoa bên CMS, cộng những người đã từng vào Physupport.
 * Chỉ quản trị hệ thống (người duy nhất sửa được trang Nhóm).
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    if (!user.access.sysAdmin) return NextResponse.json({ items: [] }, { status: 403 });
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ items: [] });

    const [cms, seen] = await Promise.all([
      searchCmsDirectory(q),
      prisma.ticketStaff.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 10,
        select: { email: true, name: true, unit: true },
      }),
    ]);
    const map = new Map<string, { email: string; name: string; department: string | null }>();
    for (const p of cms) map.set(p.email, p);
    for (const s of seen) {
      const e = s.email.toLowerCase();
      if (!map.has(e)) map.set(e, { email: e, name: s.name, department: s.unit });
    }
    return NextResponse.json({ items: [...map.values()].slice(0, 15) });
  } catch (e) {
    return e instanceof UnauthorizedError
      ? NextResponse.json({ items: [] }, { status: 401 })
      : NextResponse.json({ items: [] }, { status: 500 });
  }
}
