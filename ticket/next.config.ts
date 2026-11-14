import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ảnh standalone: Docker chỉ cần copy .next/standalone, không phải cả
  // node_modules — đĩa máy chủ đang rất căng.
  output: "standalone",
  // Hệ ticket chạy dưới /ho-tro trên cùng tên miền web Khoa, nên không phải
  // xin thêm bản ghi DNS. Caddy chuyển tiếp nguyên đường dẫn sang đây.
  basePath: "/ho-tro",
};

export default nextConfig;
