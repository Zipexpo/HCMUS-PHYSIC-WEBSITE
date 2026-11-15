import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";

/**
 * POST /api/nhom — quản lý nhóm hỗ trợ và vai trò toàn hệ. CHỈ quản trị hệ thống.
 *
 * Một route, nhiều thao tác (trường `action`) — đều nhỏ và cùng một quyền.
 */
const Email = z.string().trim().toLowerCase().email("Email không hợp lệ").max(200);
const Name = z.string().trim().min(2, "Tên quá ngắn").max(120);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addTeam"), name: Name, description: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("addMember"), teamId: z.string(), email: Email, name: Name.optional(), lead: z.boolean().default(false) }),
  z.object({ action: z.literal("setLead"), teamId: z.string(), email: Email, lead: z.boolean() }),
  z.object({ action: z.literal("removeMember"), teamId: z.string(), email: Email }),
  z.object({ action: z.literal("addRole"), email: Email, name: Name.optional(), role: z.enum(["ADMIN", "BOARD"]) }),
  z.object({ action: z.literal("removeRole"), email: Email }),
]);

const bad = (message: string, status = 400) => NextResponse.json({ message }, { status });

/** Tên người theo email: lấy từ sổ người đã đăng nhập, nếu không có thì dùng tên nhập tay. */
async function nameFor(email: string, typed?: string): Promise<string | null> {
  if (typed) return typed;
  const s = await prisma.ticketStaff.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  return s?.name ?? null;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    if (!user.access.sysAdmin) return bad("Chỉ quản trị hệ thống mới sửa nhóm", 403);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const b = parsed.data;

    switch (b.action) {
      case "addTeam": {
        if (await prisma.ticketTeam.findUnique({ where: { name: b.name } })) return bad("Đã có nhóm tên này", 409);
        const max = await prisma.ticketTeam.aggregate({ _max: { sortOrder: true } });
        await prisma.ticketTeam.create({
          data: { name: b.name, description: b.description || null, sortOrder: (max._max.sortOrder ?? 0) + 10 },
        });
        break;
      }
      case "addMember": {
        const name = await nameFor(b.email, b.name);
        if (!name) return bad("Người này chưa đăng nhập lần nào — nhập thêm họ tên");
        await prisma.ticketTeamMember.upsert({
          where: { teamId_email: { teamId: b.teamId, email: b.email } },
          create: { teamId: b.teamId, email: b.email, name, role: b.lead ? "LEAD" : "MEMBER" },
          update: { name, role: b.lead ? "LEAD" : "MEMBER" },
        });
        break;
      }
      case "setLead":
        await prisma.ticketTeamMember.update({
          where: { teamId_email: { teamId: b.teamId, email: b.email } },
          data: { role: b.lead ? "LEAD" : "MEMBER" },
        });
        break;
      case "removeMember":
        await prisma.ticketTeamMember.delete({ where: { teamId_email: { teamId: b.teamId, email: b.email } } });
        break;
      case "addRole": {
        const name = await nameFor(b.email, b.name);
        if (!name) return bad("Người này chưa đăng nhập lần nào — nhập thêm họ tên");
        await prisma.ticketRole.upsert({
          where: { email: b.email },
          create: { email: b.email, name, role: b.role },
          update: { name, role: b.role },
        });
        break;
      }
      case "removeRole":
        // Không cho tự gỡ quyền quản trị của chính mình — tránh khoá mất cửa.
        if (b.email === user.email.toLowerCase()) return bad("Không tự gỡ vai trò của chính mình được");
        await prisma.ticketRole.delete({ where: { email: b.email } });
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return bad("Chưa đăng nhập", 401);
    console.warn("[nhom]", e instanceof Error ? e.message : e);
    return bad("Không lưu được", 500);
  }
}
