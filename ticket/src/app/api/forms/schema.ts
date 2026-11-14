import { z } from "zod";
import { FormFieldSchema } from "@/lib/ticket";

/**
 * Dữ liệu một mẫu biểu gửi lên từ màn hình sửa mẫu.
 * Khoá ô chỉ gồm chữ thường, số, gạch dưới — nó là tên cột trong JSON câu
 * trả lời của các phiếu đã gửi, nên phải ổn định và không trùng.
 */
export const FormInput = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{2,40}$/, "Mã loại chỉ gồm chữ thường, số, gạch ngang"),
    name: z.string().trim().min(2, "Tên quá ngắn").max(120),
    description: z.string().trim().max(500).optional().nullable(),
    defaultTeam: z.string().trim().max(120).optional().nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
    fields: z
      .array(
        FormFieldSchema.extend({
          key: z.string().regex(/^[a-z0-9_]{1,40}$/, "Khoá ô không hợp lệ"),
          label: z.string().trim().min(1, "Ô thiếu nhãn").max(120),
        }),
      )
      .max(30),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.fields.forEach((f, i) => {
      if (seen.has(f.key))
        ctx.addIssue({ code: "custom", path: ["fields", i, "key"], message: `Trùng khoá ô "${f.key}"` });
      seen.add(f.key);
      if (f.type === "select" && !(f.options ?? []).filter((o) => o.trim()).length)
        ctx.addIssue({ code: "custom", path: ["fields", i], message: `Ô "${f.label}" cần ít nhất một lựa chọn` });
    });
  });

export function clean(v: z.infer<typeof FormInput>) {
  return {
    key: v.key,
    name: v.name,
    description: v.description || null,
    defaultTeam: v.defaultTeam || null,
    isActive: v.isActive,
    sortOrder: v.sortOrder,
    fields: v.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      ...(f.required ? { required: true } : {}),
      ...(f.type === "select"
        ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) }
        : {}),
      ...(f.hint?.trim() ? { hint: f.hint.trim() } : {}),
    })),
  };
}

export const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
