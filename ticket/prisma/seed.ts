/**
 * seed.ts — tạo các MẪU BIỂU ban đầu.
 *
 * Chạy lại được nhiều lần: mẫu đã có thì cập nhật, chưa có thì tạo. KHÔNG xoá
 * mẫu nào, vì phiếu cũ còn trỏ tới và Khoa có thể đã tự sửa nội dung mẫu.
 *
 * Thêm loại yêu cầu mới (đặt phòng, xin giấy tờ…) chỉ cần thêm một mục vào
 * mảng dưới đây rồi chạy lại — không phải sửa code giao diện.
 *
 * Dùng:
 *   pnpm --filter ticket seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({ connectionString: process.env.TICKET_DATABASE_URL }),
  ),
});

const HE_THONG = [
  "Web Khoa (phys.hcmus.edu.vn)",
  "Trang quản trị (/admin)",
  "Hồ sơ khoa học (phys-profile)",
  "Chatbot",
  "Email / tài khoản",
  "Khác",
];

const FORMS = [
  {
    key: "loi-phan-mem",
    defaultTeam: "Kỹ thuật web",
    name: "Báo lỗi phần mềm",
    description:
      "Chức năng chạy sai, báo lỗi, hiển thị không đúng, hoặc không bấm được.",
    icon: "bug",
    sortOrder: 10,
    fields: [
      {
        key: "he_thong",
        label: "Hệ thống gặp lỗi",
        type: "select",
        required: true,
        options: HE_THONG,
      },
      {
        key: "duong_dan",
        label: "Đường dẫn trang gặp lỗi",
        type: "text",
        hint: "Dán link trên thanh địa chỉ, ví dụ phys.hcmus.edu.vn/vi/tin-tuc",
      },
      {
        key: "cac_buoc",
        label: "Làm thế nào để thấy lỗi",
        type: "textarea",
        required: true,
        hint: "Bấm gì, nhập gì, rồi lỗi hiện ra. Càng cụ thể càng sửa nhanh.",
      },
      {
        key: "mong_doi",
        label: "Lẽ ra phải thế nào",
        type: "textarea",
      },
      {
        key: "trinh_duyet",
        label: "Trình duyệt / thiết bị",
        type: "text",
        hint: "Ví dụ: Chrome trên Windows, hoặc Safari trên iPhone",
      },
    ],
  },
  {
    key: "tai-khoan",
    defaultTeam: "Quản trị hệ thống",
    name: "Tài khoản & quyền truy cập",
    description:
      "Quên mật khẩu, không đăng nhập được, xin cấp tài khoản hoặc xin thêm quyền.",
    icon: "key-round",
    sortOrder: 20,
    fields: [
      {
        key: "loai_yeu_cau",
        label: "Loại yêu cầu",
        type: "select",
        required: true,
        options: [
          "Không đăng nhập được",
          "Quên mật khẩu",
          "Xin cấp tài khoản mới",
          "Xin thêm quyền",
          "Khoá / thu hồi tài khoản",
        ],
      },
      {
        key: "he_thong",
        label: "Hệ thống",
        type: "select",
        required: true,
        options: HE_THONG,
      },
      {
        key: "email_lien_quan",
        label: "Email tài khoản liên quan",
        type: "text",
        hint: "Nếu xin cho người khác thì ghi email của người đó.",
      },
    ],
  },
  {
    key: "sua-noi-dung",
    defaultTeam: "Biên tập web",
    name: "Sửa nội dung trên web",
    description:
      "Thông tin sai, ảnh hỏng, cần thêm/bớt/sửa nội dung trên trang công khai.",
    icon: "file-pen",
    sortOrder: 30,
    fields: [
      {
        key: "duong_dan",
        label: "Đường dẫn trang cần sửa",
        type: "text",
        required: true,
      },
      {
        key: "noi_dung_sai",
        label: "Chỗ nào đang sai",
        type: "textarea",
        required: true,
      },
      {
        key: "noi_dung_dung",
        label: "Nội dung đúng là gì",
        type: "textarea",
        required: true,
        hint: "Ghi rõ chữ cần thay, để người sửa khỏi đoán.",
      },
      { key: "han_chot", label: "Cần xong trước ngày", type: "date" },
    ],
  },
  {
    key: "de-xuat",
    defaultTeam: "Kỹ thuật web",
    name: "Đề xuất cải tiến",
    description: "Góp ý thêm chức năng mới hoặc làm cho thứ đang có dễ dùng hơn.",
    icon: "lightbulb",
    sortOrder: 40,
    fields: [
      {
        key: "he_thong",
        label: "Hệ thống",
        type: "select",
        required: true,
        options: HE_THONG,
      },
      {
        key: "van_de",
        label: "Hiện nay đang bất tiện chỗ nào",
        type: "textarea",
        required: true,
      },
      { key: "de_xuat", label: "Đề xuất của thầy/cô", type: "textarea" },
    ],
  },
];

/**
 * Chế độ --sql: in ra câu lệnh SQL thay vì tự ghi.
 *
 * Ảnh chạy thật là Next standalone, KHÔNG kèm Prisma CLI (cố ý — kèm vào thì
 * ảnh phình thêm hàng trăm MB). Nên trên máy chủ việc nạp mẫu biểu làm bằng
 * psql. In ra từ chính mảng FORMS ở trên để chỉ có MỘT nguồn sự thật, không
 * phải chép tay sang file .sql rồi hai bên lệch nhau.
 */
function printSql(): void {
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  console.log("-- Mẫu biểu ban đầu. Chạy lại được: đã có thì cập nhật.");
  console.log("BEGIN;");
  for (const f of FORMS) {
    const cols = [
      q(`form_${f.key}`),
      q(f.key),
      q(f.name),
      q(f.description),
      q(f.icon),
      `${q(JSON.stringify(f.fields))}::jsonb`,
      String(f.sortOrder),
      q(f.defaultTeam),
    ].join(", ");
    console.log(
      `INSERT INTO "TicketForm" ("id","key","name","description","icon","fields","sortOrder","defaultTeam","updatedAt")
` +
        `VALUES (${cols}, NOW())
` +
        `ON CONFLICT ("key") DO UPDATE SET
` +
        `  "name"=EXCLUDED."name", "description"=EXCLUDED."description",
` +
        `  "icon"=EXCLUDED."icon", "fields"=EXCLUDED."fields",
` +
        `  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW(),
` +
        `  "defaultTeam"=COALESCE("TicketForm"."defaultTeam", EXCLUDED."defaultTeam");`,
    );
  }
  console.log(
    `INSERT INTO "TicketCounter" ("id","prefix","value") VALUES ('main','VL',0)
` +
      `ON CONFLICT ("id") DO NOTHING;`,
  );
  console.log("COMMIT;");
}

async function main(): Promise<void> {
  if (process.argv.includes("--sql")) {
    printSql();
    return;
  }
  for (const f of FORMS) {
    const saved = await prisma.ticketForm.upsert({
      where: { key: f.key },
      create: {
        key: f.key,
        name: f.name,
        description: f.description,
        icon: f.icon,
        sortOrder: f.sortOrder,
        fields: f.fields,
        defaultTeam: f.defaultTeam,
      },
      // Cố ý KHÔNG đụng isActive và defaultTeam: Khoa tắt mẫu nào thì để nguyên như vậy.
      update: {
        name: f.name,
        description: f.description,
        icon: f.icon,
        sortOrder: f.sortOrder,
        fields: f.fields,
      },
    });
    console.log(`  ${saved.key.padEnd(16)} ${saved.name}`);
  }

  await prisma.ticketCounter.upsert({
    where: { id: "main" },
    create: { id: "main", prefix: "VL", value: 0 },
    update: {},
  });

  const n = await prisma.ticketForm.count();
  console.log(`\nXong. Có ${n} mẫu biểu.`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
