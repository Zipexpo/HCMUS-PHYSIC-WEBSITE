// CMS GIẢ cho bộ kiểm thử — mô phỏng đúng những gì Physupport gọi sang backend:
//   POST /auth/login, /auth/login-otp, /auth/otp     (mật khẩu / mã: gì cũng đúng)
//   GET  /auth/me       mọi vai trò
//   GET  /auth/profile  CHỈ admin — y như backend thật (cán bộ bị 403)
// Token chính là email cho dễ đọc log.
import http from "node:http";

const U = (id, email, last, first, role, dept) => ({
  id, email, firstName: first, lastName: last, role, department: dept,
});
const D_VLLT = { id: "d-vllt", name: "BM Vật lý Lý thuyết" };
const D_QH = { id: "d-qh", name: "BM Quang học" };
const D_VP = { id: "d-vp", name: "Văn phòng Khoa" };

// Mỗi tài khoản đóng một vai trong bộ kiểm thử (xem roles.e2e.mjs).
const USERS = Object.fromEntries(
  [
    U("u-gv", "giangvien@hcmus.edu.vn", "TS. Trần", "Thu Hà", "LECTURER", D_VLLT),       // người gửi
    U("u-gv2", "giangvien2@hcmus.edu.vn", "ThS. Đỗ", "Mai Phương", "LECTURER", D_QH),    // người gửi đơn vị khác
    U("u-dm", "daumoi@hcmus.edu.vn", "Đầu mối", "BM VLLT", "ADMIN", D_VLLT),           // đầu mối đơn vị
    U("u-web1", "web1@hcmus.edu.vn", "Lê", "Quang Huy", "ADMIN", D_VP),               // trưởng nhóm Kỹ thuật web
    U("u-web2", "web2@hcmus.edu.vn", "Nguyễn", "Hoàng Long", "ADMIN", D_VP),          // thành viên Kỹ thuật web
    U("u-tk", "taikhoan@hcmus.edu.vn", "Phan", "Ngọc Trâm", "ADMIN", D_VP),           // thành viên Tài khoản & Quyền
    U("u-bcn", "truongkhoa@hcmus.edu.vn", "PGS.", "Trưởng Khoa", "LECTURER", D_VP),   // Ban Chủ nhiệm
    U("u-sa", "superadmin@hcmus.edu.vn", "Quản trị", "Hệ thống", "SUPER_ADMIN", null), // quản trị
  ].map((u) => [u.email, u]),
);

const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });

http
  .createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && (url.pathname === "/auth/login" || url.pathname === "/auth/login-otp")) {
      const { email } = JSON.parse((await body(req)) || "{}");
      return USERS[email] ? send(200, { accessToken: email, refreshToken: email }) : send(401, { message: "Sai" });
    }
    if (req.method === "POST" && url.pathname === "/auth/otp") { await body(req); return send(200, { message: "ok" }); }
    if (url.pathname === "/auth/me" || url.pathname === "/auth/profile") {
      const u = USERS[(req.headers.authorization || "").replace("Bearer ", "")];
      if (!u) return send(401, { message: "token" });
      if (url.pathname === "/auth/profile" && u.role === "LECTURER") return send(403, { message: "Insufficient permissions" });
      return send(200, u);
    }
    if (url.pathname === "/admins/directory") {
      // Như backend thật: chỉ tài khoản quản trị tra được danh bạ.
      const u = USERS[(req.headers.authorization || "").replace("Bearer ", "")];
      if (!u) return send(401, { message: "token" });
      if (u.role === "LECTURER") return send(403, { message: "Insufficient permissions" });
      const q = (url.searchParams.get("search") || "").toLowerCase();
      const items = Object.values(USERS)
        .filter((x) => `${x.lastName} ${x.firstName} ${x.email}`.toLowerCase().includes(q))
        .map((x) => ({ id: x.id, email: x.email, name: `${x.lastName} ${x.firstName}`, role: x.role, department: x.department?.name ?? null }));
      return send(200, { items });
    }
    send(404, { message: "not found" });
  })
  .listen(3001, () => console.log("fake-cms :3001"));
