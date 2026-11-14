import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { UnauthorizedError, requireUser } from "@/lib/auth";
import { MAX_BYTES, MAX_PER_TICKET, cleanName, sniff, store } from "@/lib/uploads";

/** POST /api/tickets/:id/attachments — tải một tệp (multipart, ô "file"). */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: { id: true, reporterUserId: true, _count: { select: { attachments: true } } },
    });
    if (!ticket) return NextResponse.json({ message: "Không có phiếu này" }, { status: 404 });
    if (!user.isStaff && ticket.reporterUserId !== user.id) {
      return NextResponse.json({ message: "Không đủ quyền" }, { status: 403 });
    }
    if (ticket._count.attachments >= MAX_PER_TICKET) {
      return NextResponse.json(
        { message: `Mỗi phiếu tối đa ${MAX_PER_TICKET} tệp` },
        { status: 400 },
      );
    }
    // Chặn sớm theo Content-Length để khỏi đọc cả tệp khổng lồ vào bộ nhớ.
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ message: "Tệp lớn hơn 10 MB" }, { status: 413 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Chưa chọn tệp" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ message: "Tệp lớn hơn 10 MB" }, { status: 413 });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(buf);
    if (!kind) {
      return NextResponse.json(
        { message: "Chỉ nhận ảnh PNG, JPG hoặc tệp PDF" },
        { status: 415 },
      );
    }

    const stored = await store(buf, kind.ext);
    const a = await prisma.ticketAttachment.create({
      data: {
        ticketId: id,
        url: stored,
        fileName: cleanName(file.name, kind.ext),
        mimeType: kind.mime,
        sizeByte: buf.byteLength,
        uploadedByUserId: user.id,
      },
      select: { id: true, fileName: true, mimeType: true, sizeByte: true },
    });
    await prisma.ticket.update({ where: { id }, data: { updatedAt: new Date() } });
    return NextResponse.json(a, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ message: "Chưa đăng nhập" }, { status: 401 });
    }
    console.warn("[attachments]", e instanceof Error ? e.message : e);
    return NextResponse.json({ message: "Lỗi máy chủ" }, { status: 500 });
  }
}
