#!/usr/bin/env node
/**
 * KIỂM THỬ THEO VAI TRÒ — Physupport.
 *
 * Đóng 8 vai (người gửi, người gửi đơn vị khác, đầu mối đơn vị, trưởng nhóm,
 * thành viên nhóm, thành viên nhóm khác, Ban Chủ nhiệm, quản trị), đi qua mọi
 * trang và thao tác, kiểm:
 *   - ai mở được trang nào, thấy phiếu nào, KHÔNG thấy gì (ghi chú nội bộ…)
 *   - ai được làm gì (đổi trạng thái, giao việc, duyệt, sửa mẫu, quản lý nhóm)
 *   - THƯ BÁO tới đúng người (đọc log ở chế độ TICKET_MAIL_DRYRUN)
 *   - leo thang, duyệt cấp quyền, chuyển qua đơn vị, chấm điểm, thông báo chung,
 *     thư tóm tắt sáng
 *
 * Chạy qua run.sh (dựng hệ chạy thử riêng rồi gỡ đi). Thoát mã 1 nếu có bước trượt.
 */
import { execFileSync } from "node:child_process";

const BASE = process.env.E2E_BASE ?? "http://localhost:3199/ho-tro";
const DB = process.env.E2E_DB ?? "physupport-e2e-db-1";
const APP = process.env.E2E_APP ?? "physupport-e2e-ticket-1";

// ─── Tiện ích ────────────────────────────────────────────────────────────────
const results = [];
let section = "";
const step = (name) => { section = name; console.log(`\n▶ ${name}`); };
function check(name, ok, detail = "") {
  results.push({ section, name, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ← ${detail}`}`);
}
const expectStatus = (name, got, want) => check(`${name} → ${want}`, got === want, `được ${got}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = (q) =>
  execFileSync("docker", ["exec", DB, "psql", "-U", "e2e", "-d", "hcmus_ticket", "-tAc", q], { encoding: "utf8" }).trim();

/** Mọi thư "đã gửi" (log dry-run) tính tới lúc này. */
function allMails() {
  const log = execFileSync("docker", ["logs", APP], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return log
    .split("\n")
    .filter((l) => l.includes("[mail-dryrun]"))
    .map((l) => JSON.parse(l.slice(l.indexOf("{"))));
}
/** Chạy `fn` rồi trả về các thư mới phát sinh trong lúc đó. */
async function mailsDuring(fn) {
  const before = allMails().length;
  const out = await fn();
  await sleep(700); // thư gửi kiểu "bắn rồi quên"
  return { out, mails: allMails().slice(before) };
}
const to = (mails) => [...new Set(mails.map((m) => m.to))].sort();
const has = (mails, email, re) => mails.some((m) => m.to === email && (!re || re.test(m.subject)));

class Who {
  constructor(email) { this.email = email; this.cookie = ""; }
  async login() {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.email, password: "x" }),
    });
    const c = r.headers.get("set-cookie");
    if (!r.ok || !c) throw new Error(`Không đăng nhập được ${this.email}: ${r.status}`);
    this.cookie = c.split(";")[0];
    await this.page("/phieu"); // lần vào đầu: hệ ghi sổ người dùng (đơn vị, vai trò CMS)
    return this;
  }
  async page(path) {
    const r = await fetch(`${BASE}${path}`, { headers: { cookie: this.cookie }, redirect: "manual" });
    return { status: r.status, html: r.status === 200 ? await r.text() : "", location: r.headers.get("location") ?? "" };
  }
  async api(method, path, body) {
    const isForm = body instanceof FormData;
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { cookie: this.cookie, ...(isForm ? {} : { "content-type": "application/json" }) },
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = {};
    try { json = JSON.parse(text); } catch { /* không phải JSON */ }
    return { status: r.status, json };
  }
}

const E = (u) => `${u}@hcmus.edu.vn`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fileForm = (name, bytes, type) => { const f = new FormData(); f.append("file", new Blob([bytes], { type }), name); return f; };

// ─── Kịch bản ───────────────────────────────────────────────────────────────
async function main() {
  step("0. Đăng nhập 8 vai, quản trị lập nhóm");
  const gv = await new Who(E("giangvien")).login();       // người gửi, BM VLLT
  const gv2 = await new Who(E("giangvien2")).login();     // người gửi, BM Quang học (đơn vị chưa có đầu mối)
  const dm = await new Who(E("daumoi")).login();          // đầu mối BM VLLT
  const web1 = await new Who(E("web1")).login();          // trưởng nhóm Kỹ thuật web
  const web2 = await new Who(E("web2")).login();          // thành viên Kỹ thuật web
  const tk = await new Who(E("taikhoan")).login();        // thành viên Tài khoản & Quyền
  const bcn = await new Who(E("truongkhoa")).login();     // Ban Chủ nhiệm
  const sa = await new Who(E("superadmin")).login();      // quản trị (SUPER_ADMIN)
  check("cả 8 tài khoản đăng nhập được (kể cả cán bộ LECTURER)", true);

  const team = (name) => sql(`select id from "TicketTeam" where name='${name}'`);
  const KTW = team("Kỹ thuật web"), TKQ = team("Tài khoản & Quyền");
  expectStatus("thành viên thường gọi API quản lý nhóm", (await web1.api("POST", "/nhom", { action: "addTeam", name: "Thử" })).status, 403);
  for (const [teamId, email, lead] of [[KTW, E("web1"), true], [KTW, E("web2"), false], [TKQ, E("taikhoan"), false]]) {
    expectStatus(`quản trị thêm ${email} vào nhóm`, (await sa.api("POST", "/nhom", { action: "addMember", teamId, email, lead })).status, 200);
  }
  expectStatus("quản trị gán Ban Chủ nhiệm", (await sa.api("POST", "/nhom", { action: "addRole", email: E("truongkhoa"), role: "BOARD" })).status, 200);
  expectStatus("thêm người chưa từng đăng nhập mà thiếu họ tên", (await sa.api("POST", "/nhom", { action: "addMember", teamId: KTW, email: E("nguoila") })).status, 400);
  // Quyền đọc lại từ CSDL mỗi lần tải trang → không cần đăng nhập lại.

  step("1. Ai mở được trang nào");
  const PAGES = ["", "/gui", "/phieu", "/don-vi", "/nhom", "/bao-cao", "/mau-bieu"];
  const MATRIX = {
    // trang:          /    gui  phieu don-vi nhom bao-cao mau-bieu      (307 = chuyển hướng)
    giangvien:  [gv,   [200, 200, 200, 404, 404, 404, 404]],
    daumoi:     [dm,   [200, 200, 200, 200, 404, 200, 404]],
    "trưởng nhóm": [web1, [307, 200, 200, 307, 200, 200, 200]],
    // web2 là ADMIN của Văn phòng Khoa bên CMS → cũng là đầu mối VP Khoa → xem Báo cáo được.
    "thành viên":  [web2, [307, 200, 200, 307, 200, 200, 404]],
    "Ban Chủ nhiệm": [bcn, [200, 200, 200, 200, 404, 200, 404]],
    "quản trị": [sa,   [307, 200, 200, 307, 200, 200, 200]],
  };
  for (const [role, [who, want]] of Object.entries(MATRIX)) {
    const got = [];
    for (const p of PAGES) got.push((await who.page(p)).status);
    const bad = PAGES.filter((_, i) => got[i] !== want[i]).map((p, i) => `${p}=${got[PAGES.indexOf(p)]}`);
    check(`${role}: ${PAGES.map((p, i) => `${p || "/"} ${want[i]}`).join(", ")}`, !bad.length, bad.join(" "));
  }
  const nav = async (who) => (await who.page("/gui")).html;
  check("đầu mối có mục “Phiếu đơn vị”", (await nav(dm)).includes("Phiếu đơn vị"));
  check("Ban Chủ nhiệm có mục “Leo thang”", (await nav(bcn)).includes("Leo thang"));
  check("trưởng nhóm có “Mẫu biểu”, thành viên thì không", (await nav(web1)).includes("Mẫu biểu") && !(await nav(web2)).includes("Mẫu biểu"));

  step("2. Báo lỗi phần mềm — đi trọn vòng đời");
  let r = await mailsDuring(() =>
    gv.api("POST", "/tickets", {
      formKey: "loi-phan-mem",
      title: "Không tải được ảnh đại diện",
      description: "Bấm Đổi ảnh, chọn JPG thì báo tải lên thất bại.",
      priority: "NORMAL",
      answers: { he_thong: "Hồ sơ khoa học (phys-profile)", cac_buoc: "Bấm Đổi ảnh" },
    }),
  );
  expectStatus("người gửi tạo phiếu", r.out.status, 201);
  const BUG = r.out.json.id, BUG_CODE = r.out.json.code;
  check("thư phiếu mới tới đúng CẢ nhóm Kỹ thuật web", JSON.stringify(to(r.mails)) === JSON.stringify([E("web1"), E("web2")]), JSON.stringify(to(r.mails)));

  const sees = async (who) => (await who.page(`/phieu/${BUG}`)).status;
  expectStatus("trưởng nhóm mở phiếu", await sees(web1), 200);
  expectStatus("thành viên nhóm KHÁC mở phiếu", await sees(tk), 404);
  expectStatus("đầu mối CÙNG đơn vị người gửi mở phiếu (chỉ xem)", await sees(dm), 200);
  expectStatus("người gửi đơn vị khác mở phiếu", await sees(gv2), 404);
  expectStatus("Ban Chủ nhiệm mở phiếu chưa leo thang", await sees(bcn), 404);
  check("phiếu hiện trên hàng đợi của nhóm", (await web1.page("/phieu")).html.includes(BUG_CODE));
  check("phiếu KHÔNG hiện trên hàng đợi nhóm khác", !(await tk.page("/phieu?xem=tat-ca")).html.includes(BUG_CODE));

  expectStatus("đầu mối đổi trạng thái phiếu không thuộc diện đơn vị xử lý", (await dm.api("PATCH", `/tickets/${BUG}`, { status: "IN_PROGRESS" })).status, 403);
  expectStatus("đầu mối viết vào phiếu (chỉ xem)", (await dm.api("POST", `/tickets/${BUG}/comments`, { body: "xin chào" })).status, 403);
  expectStatus("thành viên nhóm khác đổi trạng thái", (await tk.api("PATCH", `/tickets/${BUG}`, { status: "IN_PROGRESS" })).status, 403);
  expectStatus("người gửi tự đánh dấu “Đã xong”", (await gv.api("PATCH", `/tickets/${BUG}`, { status: "RESOLVED" })).status, 403);

  expectStatus("thành viên tự nhận phiếu", (await web2.api("PATCH", `/tickets/${BUG}`, { assign: "me" })).status, 200);
  expectStatus("thành viên giao phiếu cho người khác", (await web2.api("PATCH", `/tickets/${BUG}`, { assign: "u-web1" })).status, 403);
  expectStatus("thành viên chuyển nhóm", (await web2.api("PATCH", `/tickets/${BUG}`, { team: "Tài khoản & Quyền" })).status, 403);
  r = await mailsDuring(() => web1.api("PATCH", `/tickets/${BUG}`, { assign: "u-web1" }));
  expectStatus("trưởng nhóm giao phiếu", r.out.status, 200);
  expectStatus("trưởng nhóm giao cho người NGOÀI nhóm", (await web1.api("PATCH", `/tickets/${BUG}`, { assign: "u-tk" })).status, 400);
  await web1.api("PATCH", `/tickets/${BUG}`, { assign: "u-web2" });
  check("có mốc phản hồi đầu sau khi bên xử lý động tới", sql(`select "firstResponseAt" is not null from "Ticket" where id='${BUG}'`) === "t");

  r = await mailsDuring(() => web2.api("POST", `/tickets/${BUG}/comments`, { body: "Thầy/cô gửi giúp ảnh chụp màn hình ạ." }));
  check("trả lời công khai → thư tới người gửi", has(r.mails, E("giangvien"), /trả lời/));
  r = await mailsDuring(() => web2.api("POST", `/tickets/${BUG}/comments`, { body: "BÍ-MẬT-NỘI-BỘ: lỗi 413 ở Caddy, nhờ @Lê Quang Huy xem", isInternal: true }));
  check("ghi chú nội bộ có @tên → thư tới đúng người được nhắc", has(r.mails, E("web1"), /nhắc/) && !has(r.mails, E("giangvien")), JSON.stringify(to(r.mails)));
  check("người gửi KHÔNG thấy ghi chú nội bộ", !(await gv.page(`/phieu/${BUG}`)).html.includes("BÍ-MẬT-NỘI-BỘ"));
  check("đầu mối (chỉ xem) KHÔNG thấy ghi chú nội bộ", !(await dm.page(`/phieu/${BUG}`)).html.includes("BÍ-MẬT-NỘI-BỘ"));
  check("trưởng nhóm thấy ghi chú nội bộ", (await web1.page(`/phieu/${BUG}`)).html.includes("BÍ-MẬT-NỘI-BỘ"));
  expectStatus("người gửi cố gửi ghi chú nội bộ (bị hạ thành công khai)", (await gv.api("POST", `/tickets/${BUG}/comments`, { body: "thử nội bộ", isInternal: true })).status, 201);
  check("…và nó được lưu là CÔNG KHAI", sql(`select "isInternal" from "TicketComment" where body='thử nội bộ'`) === "f");

  expectStatus("người gửi đính kèm ảnh PNG thật", (await gv.api("POST", `/tickets/${BUG}/attachments`, fileForm("loi.png", PNG, "image/png"))).status, 201);
  expectStatus("đính kèm HTML giả làm PNG", (await gv.api("POST", `/tickets/${BUG}/attachments`, fileForm("x.png", Buffer.from("<script>alert(1)</script>"), "image/png"))).status, 415);
  expectStatus("đầu mối (chỉ xem) đính kèm", (await dm.api("POST", `/tickets/${BUG}/attachments`, fileForm("a.png", PNG, "image/png"))).status, 403);

  r = await mailsDuring(() => web2.api("PATCH", `/tickets/${BUG}`, { status: "RESOLVED" }));
  // Vừa trả lời công khai < 2 phút trước → KHÔNG gửi thêm thư đổi trạng thái (một việc, một thư).
  check("trả lời rồi chuyển “Đã xong” ngay → không gửi thư thứ hai", !has(r.mails, E("giangvien")), JSON.stringify(r.mails));
  r = await mailsDuring(() => gv.api("PATCH", `/tickets/${BUG}`, { status: "IN_PROGRESS" }));
  expectStatus("người gửi mở lại (vẫn còn lỗi)", r.out.status, 200);
  check("mở lại → thư tới người đang giữ phiếu", has(r.mails, E("web2"), /mở lại/));
  await web2.api("PATCH", `/tickets/${BUG}`, { status: "RESOLVED" });
  expectStatus("người gửi chấm điểm 5 sao lúc đóng", (await gv.api("PATCH", `/tickets/${BUG}`, { status: "CLOSED", rating: 5 })).status, 200);
  expectStatus("chấm điểm lần hai", (await gv.api("PATCH", `/tickets/${BUG}`, { rating: 1 })).status, 409);
  expectStatus("người khác chấm điểm hộ", (await web1.api("PATCH", `/tickets/${BUG}`, { rating: 1 })).status, 403);
  check("điểm được lưu đúng", sql(`select rating from "Ticket" where id='${BUG}'`) === "5");

  step("3. Xin cấp quyền — đầu mối đơn vị DUYỆT");
  const xinQuyen = (who, title) =>
    who.api("POST", "/tickets", {
      formKey: "tai-khoan",
      title,
      description: "Nhờ cấp quyền đăng tin trên trang bộ môn.",
      answers: { loai_yeu_cau: "Xin thêm quyền", he_thong: "Trang quản trị (/admin)" },
    });
  r = await mailsDuring(() => xinQuyen(gv, "Xin quyền đăng tin cho trợ giảng"));
  const AP = r.out.json.id;
  check("phiếu vào trạng thái CHỜ DUYỆT của đúng đơn vị", sql(`select "approvalStatus"||'|'||"approvalUnitId" from "Ticket" where id='${AP}'`) === "PENDING|d-vllt");
  check("thư “cần duyệt” tới ĐẦU MỐI, không tới nhóm", has(r.mails, E("daumoi"), /duyệt/) && !has(r.mails, E("taikhoan")), JSON.stringify(to(r.mails)));
  expectStatus("nhóm nhận phiếu khi chưa duyệt", (await tk.api("PATCH", `/tickets/${AP}`, { assign: "me" })).status, 409);
  expectStatus("thành viên nhóm tự duyệt", (await tk.api("PATCH", `/tickets/${AP}`, { approval: "APPROVE" })).status, 403);
  expectStatus("đầu mối từ chối mà không ghi lý do", (await dm.api("PATCH", `/tickets/${AP}`, { approval: "REJECT" })).status, 400);
  check("đầu mối thấy phiếu ở góc “Chờ duyệt”", (await dm.page("/don-vi")).html.includes("Chờ duyệt"));
  r = await mailsDuring(() => dm.api("PATCH", `/tickets/${AP}`, { approval: "APPROVE", approvalNote: "Đồng ý" }));
  expectStatus("đầu mối duyệt", r.out.status, 200);
  check("duyệt xong → thư tới nhóm Tài khoản & Quyền VÀ người gửi", has(r.mails, E("taikhoan")) && has(r.mails, E("giangvien")), JSON.stringify(to(r.mails)));
  expectStatus("duyệt lại lần hai", (await dm.api("PATCH", `/tickets/${AP}`, { approval: "APPROVE" })).status, 403);
  expectStatus("nhóm nhận phiếu sau khi duyệt", (await tk.api("PATCH", `/tickets/${AP}`, { assign: "me" })).status, 200);

  r = await mailsDuring(() => xinQuyen(gv, "Xin quyền quản trị toàn Khoa"));
  const AP2 = r.out.json.id;
  r = await mailsDuring(() => dm.api("PATCH", `/tickets/${AP2}`, { approval: "REJECT", approvalNote: "Chỉ cấp quyền đăng bài" }));
  check("từ chối → phiếu “Không xử lý” + thư lý do tới người gửi", sql(`select status from "Ticket" where id='${AP2}'`) === "REJECTED" && has(r.mails, E("giangvien"), /không duyệt/i));

  r = await mailsDuring(() => xinQuyen(gv2, "Xin quyền cho NCS"));
  const AP3 = r.out.json.id;
  check("đơn vị CHƯA có đầu mối → thư duyệt tới quản trị", has(r.mails, E("superadmin"), /duyệt/), JSON.stringify(to(r.mails)));
  expectStatus("đầu mối đơn vị KHÁC duyệt hộ", (await dm.api("PATCH", `/tickets/${AP3}`, { approval: "APPROVE" })).status, 403);
  expectStatus("quản trị duyệt thay", (await sa.api("PATCH", `/tickets/${AP3}`, { approval: "APPROVE" })).status, 200);

  const self = await xinQuyen(dm, "Đầu mối xin quyền cho người trong bộ môn");
  check("đầu mối tự gửi cho đơn vị mình → coi như đã duyệt", sql(`select "approvalStatus" from "Ticket" where id='${self.json.id}'`) === "APPROVED");

  step("4. Sửa nội dung — chuyển qua đầu mối đơn vị trước");
  const sua = (who) =>
    who.api("POST", "/tickets", {
      formKey: "sua-noi-dung",
      title: "Sai tên đề tài trên trang bộ môn",
      description: "Tên đề tài bị sai chính tả ở mục nghiên cứu.",
      answers: { duong_dan: "phys.hcmus.edu.vn/vi/bm", noi_dung_sai: "a", noi_dung_dung: "b" },
    });
  r = await mailsDuring(() => sua(gv));
  const SUA = r.out.json.id;
  check("thư tới ĐẦU MỐI đơn vị (không tới nhóm Biên tập)", JSON.stringify(to(r.mails)) === JSON.stringify([E("daumoi")]), JSON.stringify(to(r.mails)));
  expectStatus("đầu mối XỬ LÝ được phiếu chuyển qua đơn vị", (await dm.api("PATCH", `/tickets/${SUA}`, { status: "IN_PROGRESS" })).status, 200);
  expectStatus("đầu mối trả lời trong phiếu đó", (await dm.api("POST", `/tickets/${SUA}/comments`, { body: "Bộ môn sửa ngay." })).status, 201);
  r = await mailsDuring(() => sua(gv2));
  check("đơn vị không có đầu mối + nhóm Biên tập trống → thư tới quản trị", has(r.mails, E("superadmin")), JSON.stringify(to(r.mails)));

  step("5. Quá hạn → leo thang");
  const urg = await gv.api("POST", "/tickets", {
    formKey: "loi-phan-mem",
    title: "Web Khoa trả về lỗi 502",
    description: "Trang chủ web Khoa không mở được từ sáng.",
    priority: "URGENT",
    answers: { he_thong: "Web Khoa (phys.hcmus.edu.vn)", cac_buoc: "Mở trang chủ" },
  });
  const URG = urg.json.id;
  await web2.api("POST", `/tickets/${URG}/comments`, { body: "NỘI-BỘ-URG", isInternal: true });
  sql(`update "Ticket" set "createdAt" = now() - interval '10 days', "firstResponseAt" = null, escalation = 0 where id='${URG}'`);
  r = await mailsDuring(async () => { await gv.page(""); await sleep(1500); });
  const esc = sql(`select escalation||'|'||"boardEscalated" from "Ticket" where id='${URG}'`);
  check("phiếu Khẩn quá hạn xử lý → mức 2 + báo Ban Chủ nhiệm", esc === "2|true", esc);
  check("thư leo thang tới trưởng nhóm, quản trị, Ban Chủ nhiệm", [E("web1"), E("superadmin"), E("truongkhoa")].every((e) => has(r.mails, e, /QUÁ HẠN/)), JSON.stringify(to(r.mails)));
  check("thành viên thường KHÔNG nhận thư leo thang", !has(r.mails, E("web2"), /QUÁ HẠN/));
  expectStatus("Ban Chủ nhiệm mở phiếu bị leo thang", (await bcn.page(`/phieu/${URG}`)).status, 200);
  check("Ban Chủ nhiệm KHÔNG đọc ghi chú nội bộ", !(await bcn.page(`/phieu/${URG}`)).html.includes("NỘI-BỘ-URG"));
  expectStatus("Ban Chủ nhiệm đổi trạng thái", (await bcn.api("PATCH", `/tickets/${URG}`, { status: "IN_PROGRESS" })).status, 403);
  r = await mailsDuring(async () => { await gv.page(""); await sleep(1000); });
  check("leo thang KHÔNG gửi lặp ở lần quét sau", !r.mails.some((m) => /QUÁ HẠN/.test(m.subject)));
  check("hàng đợi có góc “Quá hạn / sắp tới hạn” chứa phiếu này", (await web1.page("/phieu?xem=sap-han")).html.includes(urg.json.code));

  step("6. Mẫu biểu — ai sửa được gì");
  const formBody = (key, team) => ({
    key, name: "Báo lỗi phần mềm", description: "Mô tả", defaultTeam: team, isActive: true, sortOrder: 10,
    unitRoute: false, approval: null,
    fields: [{ key: "he_thong", label: "Hệ thống gặp lỗi", type: "select", required: true, options: ["Web Khoa (phys.hcmus.edu.vn)", "Hồ sơ khoa học (phys-profile)"] }],
  });
  const fid = (k) => sql(`select id from "TicketForm" where key='${k}'`);
  expectStatus("trưởng nhóm sửa mẫu của NHÓM MÌNH", (await web1.api("PUT", `/forms/${fid("loi-phan-mem")}`, formBody("loi-phan-mem", "Kỹ thuật web"))).status, 200);
  expectStatus("trưởng nhóm đẩy mẫu sang nhóm khác", (await web1.api("PUT", `/forms/${fid("loi-phan-mem")}`, formBody("loi-phan-mem", "Tài khoản & Quyền"))).status, 403);
  expectStatus("trưởng nhóm sửa mẫu nhóm KHÁC", (await web1.api("PUT", `/forms/${fid("tai-khoan")}`, formBody("tai-khoan", "Tài khoản & Quyền"))).status, 403);
  expectStatus("thành viên sửa mẫu", (await web2.api("PUT", `/forms/${fid("loi-phan-mem")}`, formBody("loi-phan-mem", "Kỹ thuật web"))).status, 403);
  expectStatus("trưởng nhóm tạo LOẠI mới", (await web1.api("POST", "/forms", formBody("thu-moi", "Kỹ thuật web"))).status, 403);
  expectStatus("quản trị tạo loại mới", (await sa.api("POST", "/forms", { ...formBody("dat-phong", "Kỹ thuật web"), name: "Đặt phòng họp" })).status, 200);
  expectStatus("luật duyệt dựa trên ô không phải kiểu chọn", (await sa.api("PUT", `/forms/${fid("dat-phong")}`, { ...formBody("dat-phong", "Kỹ thuật web"), approval: { field: "khong_co", values: ["x"] } })).status, 400);

  step("7. Thông báo sự cố chung");
  expectStatus("người gửi đặt thông báo", (await gv.api("POST", "/thong-bao", { message: "x" })).status, 403);
  expectStatus("trưởng nhóm đặt thông báo", (await web1.api("POST", "/thong-bao", { message: "WEB-KHOA-CHAM — đang xử lý", level: "warn" })).status, 200);
  check("người gửi thấy thông báo ở đầu trang", (await gv.page("/gui")).html.includes("WEB-KHOA-CHAM"));
  expectStatus("trưởng nhóm gỡ thông báo", (await web1.api("POST", "/thong-bao", { message: null })).status, 200);
  check("gỡ xong thì không còn", !(await gv.page("/gui")).html.includes("WEB-KHOA-CHAM"));

  step("8. Thư tóm tắt sáng");
  sql(`delete from "TicketSetting" where key='digest:last'`);
  r = await mailsDuring(async () => { await gv.page(""); await sleep(1500); });
  const digest = r.mails.filter((m) => /việc hôm nay/.test(m.subject));
  check("quản trị nhận tóm tắt toàn Khoa", digest.some((m) => m.to === E("superadmin")), JSON.stringify(to(digest)));
  check("người đang giữ phiếu nhận tóm tắt", digest.some((m) => m.to === E("taikhoan")), JSON.stringify(to(digest)));
  check("Ban Chủ nhiệm nhận tổng kết tuần", digest.some((m) => m.to === E("truongkhoa")), JSON.stringify(to(digest)));
  check("người gửi thường KHÔNG nhận tóm tắt", !digest.some((m) => m.to === E("giangvien")));
  r = await mailsDuring(async () => { await gv.page(""); await sleep(1000); });
  check("tóm tắt chỉ gửi MỘT lần mỗi ngày", !r.mails.some((m) => /việc hôm nay/.test(m.subject)));

  step("9. Báo cáo theo phạm vi");
  check("Ban Chủ nhiệm xem báo cáo có điểm hài lòng", (await bcn.page("/bao-cao?tg=tat-ca")).html.includes("Mức hài lòng"));
  check("trưởng nhóm xem báo cáo", (await web1.page("/bao-cao")).status === 200);
}

main()
  .catch((e) => {
    results.push({ section, name: `LỖI KỊCH BẢN: ${e.message}`, ok: false });
    console.error(e);
  })
  .finally(() => {
    const bad = results.filter((x) => !x.ok);
    console.log(`\n═══ ${results.length - bad.length}/${results.length} bước đạt ═══`);
    for (const b of bad) console.log(`  ✗ [${b.section}] ${b.name}`);
    process.exit(bad.length ? 1 : 0);
  });
