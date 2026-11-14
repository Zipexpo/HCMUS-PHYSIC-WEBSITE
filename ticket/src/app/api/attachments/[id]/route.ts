import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { load } from "@/lib/uploads";

/**
 * GET /api/attachments/:id — tải tệp, có kiểm quyền.
 *
 * Ảnh mở thẳng trong trình duyệt (inline), PDF thì tải về; luôn kèm nosniff và
 * CSP chặn mọi script, phòng khi chữ ký tệp bị đánh lừa.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return new Response("Chưa đăng nhập", { status: 401 });
  const { id } = await ctx.params;
  const a = await prisma.ticketAttachment.findUnique({
    where: { id },
    include: {
      ticket: { select: { reporterUserId: true } },
      comment: { select: { isInternal: true } },
    },
  });
  const allowed =
    a &&
    (user.isStaff ||
      (a.ticket.reporterUserId === user.id && !a.comment?.isInternal));
  if (!a || !allowed) return new Response("Không tìm thấy", { status: 404 });

  const buf = await load(a.url);
  if (!buf) return new Response("Tệp không còn", { status: 410 });

  const inline = a.mimeType.startsWith("image/");
  const name = encodeURIComponent(a.fileName);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": a.mimeType,
      "content-length": String(buf.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=3600",
    },
  });
}
