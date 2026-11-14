import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export {
  STATUS_LABEL,
  STATUS_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  OPEN_STATUSES,
} from "./labels";

/** Một ô nhập do mẫu biểu định nghĩa. */
export const FormFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "select", "date", "checkbox"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  hint: z.string().optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const parseFields = (raw: unknown): FormField[] => {
  const r = z.array(FormFieldSchema).safeParse(raw);
  return r.success ? r.data : [];
};

export const CreateTicketSchema = z.object({
  formKey: z.string().min(1),
  title: z.string().trim().min(5, "Tiêu đề quá ngắn").max(200),
  description: z.string().trim().min(10, "Mô tả quá ngắn").max(5000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  systemName: z.string().trim().max(120).optional(),
  answers: z.record(z.string(), z.unknown()).default({}),
  notifyEmail: z.boolean().default(true),
});

/**
 * Sinh mã phiếu kiểu VL-0007.
 *
 * Tăng bộ đếm NGAY TRONG giao dịch tạo phiếu: hai người bấm gửi cùng lúc mà
 * đếm ngoài giao dịch sẽ ra trùng mã, rồi vỡ ràng buộc unique.
 */
export async function nextTicketCode(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const counter = await tx.ticketCounter.upsert({
    where: { id: "main" },
    create: { id: "main", value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${counter.prefix}-${String(counter.value).padStart(4, "0")}`;
}

/**
 * Kiểm các ô riêng của mẫu. Trả về danh sách lỗi; rỗng nghĩa là hợp lệ.
 * Chỉ chặn ô BẮT BUỘC bỏ trống — không tự ý loại bỏ dữ liệu người ta đã nhập.
 */
export function validateAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
): string[] {
  const errs: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const v = answers[f.key];
    const empty =
      v === undefined || v === null || (typeof v === "string" && !v.trim());
    if (empty) errs.push(`Thiếu "${f.label}"`);
  }
  return errs;
}
