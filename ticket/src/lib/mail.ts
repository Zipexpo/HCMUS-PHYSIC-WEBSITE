/**
 * Email báo tin cho phiếu — gửi qua Resend (HTTP API, không cần thư viện).
 *
 * Chưa cấu hình TICKET_RESEND_API_KEY thì im lặng bỏ qua: email chỉ là tiện
 * ích, thiếu nó hệ vẫn phải chạy. Gửi kiểu "bắn rồi quên" — không bao giờ để
 * việc gửi thư hỏng hay chậm làm hỏng thao tác của người dùng.
 */
const KEY = process.env.TICKET_RESEND_API_KEY || "";
// Lấy ĐỊA CHỈ gửi từ cấu hình (dùng chung với CMS), nhưng tên hiển thị luôn là
// Physupport — để người nhận phân biệt thư phiếu hỗ trợ với thư của web Khoa.
const RAW_FROM = process.env.TICKET_MAIL_FROM || "no-reply@koomaru.com";
const FROM = `Physupport <${RAW_FROM.match(/<([^>]+)>/)?.[1] ?? RAW_FROM.trim()}>`;
const BASE = (process.env.TICKET_PUBLIC_URL || "https://phys.hcmus.edu.vn/ho-tro").replace(/\/$/, "");

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function ticketUrl(id: string): string {
  return `${BASE}/phieu/${id}`;
}

type Mail = {
  to: string;
  subject: string;
  /** Các đoạn văn thuần — tự thoát HTML ở đây, nơi gọi không phải lo. */
  lines: string[];
  link?: { href: string; label: string };
};

function html(m: Mail): string {
  const body = m.lines
    .map((l) => `<p style="margin:0 0 12px;white-space:pre-wrap">${esc(l)}</p>`)
    .join("");
  const btn = m.link
    ? `<p style="margin:20px 0"><a href="${esc(m.link.href)}" style="background:#22252a;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${esc(m.link.label)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#22252a;max-width:560px">${body}${btn}<p style="color:#7a7d7b;font-size:12px;margin-top:24px">Physupport — hỗ trợ kỹ thuật Khoa Vật lý – Vật lý Kỹ thuật, ĐH KHTN. Thư tự động, không cần trả lời thư này: trả lời ngay trong phiếu.</p></div>`;
}

export function sendMail(m: Mail): void {
  if (!m.to) return;
  // Chạy thử (e2e): ghi ra log thay vì gửi, để bộ kiểm thử biết thư tới ĐÚNG ai.
  if (process.env.TICKET_MAIL_DRYRUN === "1") {
    console.log(`[mail-dryrun] ${JSON.stringify({ to: m.to, subject: m.subject })}`);
    return;
  }
  if (!KEY) return;
  void fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [m.to],
      subject: m.subject,
      html: html(m),
      text: [...m.lines, m.link ? `${m.link.label}: ${m.link.href}` : ""].join("\n\n"),
    }),
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (r) => {
      if (!r.ok) console.warn("[mail] Resend", r.status, (await r.text()).slice(0, 200));
    })
    .catch((e: unknown) => console.warn("[mail]", e instanceof Error ? e.message : e));
}
