"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormField } from "@/lib/ticket";
import { ArrowUpRight, CurveDown, CurveUp } from "@/components/ui";

type Form = {
  key: string;
  name: string;
  description: string | null;
  team: string | null;
  fields: FormField[];
};

/** Mức độ theo ẢNH HƯỞNG — người gửi biết rõ việc của mình bị cản ra sao, khó tự xếp "cao/thấp". */
const PRIOS = [
  { v: "LOW", label: "Thấp", desc: "Bất tiện nhỏ, có cách khác", c: "#9aa09e" },
  { v: "NORMAL", label: "Bình thường", desc: "Ảnh hưởng việc của tôi", c: "#5fb39a" },
  { v: "HIGH", label: "Cao", desc: "Cản trở nhiều người", c: "#e9b949" },
  { v: "URGENT", label: "Khẩn", desc: "Web Khoa ngừng hoạt động", c: "#d2553e" },
] as const;
type Prio = (typeof PRIOS)[number]["v"];

const OK_TYPES = ["image/png", "image/jpeg", "application/pdf"];
const MAX = 10 * 1024 * 1024;
const DRAFT = "ticket.draft.v2";

type Draft = {
  formKey: string;
  title: string;
  description: string;
  priority: Prio;
  answers: Record<string, Record<string, unknown>>;
};

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function TicketForm({
  forms,
  initialKey,
  initialTitle,
  email,
}: {
  forms: Form[];
  initialKey: string;
  initialTitle: string;
  email: string;
}) {
  const router = useRouter();
  const [formKey, setFormKey] = useState(initialKey);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Prio>("NORMAL");
  // Câu trả lời giữ riêng theo TỪNG mẫu: đổi loại rồi đổi lại vẫn còn.
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [notify, setNotify] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [restored, setRestored] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const form = useMemo(() => forms.find((f) => f.key === formKey) ?? forms[0], [forms, formKey]);
  const current = answers[formKey] ?? {};
  const setAnswer = (k: string, v: unknown) => setAnswers((prev) => ({ ...prev, [formKey]: { ...current, [k]: v } }));

  // ── Bản nháp: tự lưu trên máy này, mở lại trang là còn nguyên ───────────
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null") as Draft | null;
      // Đến từ ô "Mô tả ngắn" ở trang chủ thì ưu tiên câu vừa gõ, không đè bằng nháp cũ.
      if (d && (d.title || d.description) && !initialTitle) {
        if (forms.some((f) => f.key === d.formKey) && initialKey === forms[0]?.key) setFormKey(d.formKey);
        setTitle(d.title ?? "");
        setDescription(d.description ?? "");
        setPriority(d.priority ?? "NORMAL");
        setAnswers(d.answers ?? {});
        setRestored(true);
      }
    } catch {
      /* nháp hỏng: bỏ qua */
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT, JSON.stringify({ formKey, title, description, priority, answers } satisfies Draft));
      } catch {
        /* chế độ riêng tư */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [formKey, title, description, priority, answers]);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (!OK_TYPES.includes(f.type)) setErr(`"${f.name}": chỉ nhận PNG, JPG hoặc PDF`);
      else if (f.size > MAX) setErr(`"${f.name}" lớn hơn 10 MB`);
      else ok.push(f);
    }
    setFiles((cur) => [...cur, ...ok].slice(0, 10));
  }

  // ── Bước đã xong / bước đang làm ─────────────────────────────────────────
  const describedOk = title.trim().length >= 5 && description.trim().length >= 10;
  const missing = form.fields.filter(
    (f) => f.required && f.type !== "checkbox" && !String(current[f.key] ?? "").trim(),
  );
  const done = [true, describedOk, describedOk && missing.length === 0, false];
  const curStep = done.findIndex((d) => !d);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 5) return setErr("Tiêu đề quá ngắn — ít nhất 5 ký tự");
    if (description.trim().length < 10) return setErr("Mô tả quá ngắn — ít nhất 10 ký tự");
    if (missing.length) return setErr(`Còn thiếu: ${missing.map((f) => f.label).join(", ")}`);
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/ho-tro/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          formKey,
          title,
          description,
          priority,
          notifyEmail: notify,
          // Ô "hệ thống" ghi ra cột riêng để bàn điều phối gom phiếu theo hệ thống.
          systemName: typeof current.he_thong === "string" && current.he_thong ? current.he_thong : undefined,
          answers: current,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !data.id) {
        setErr(data.message ?? "Gửi không thành công");
        return;
      }
      // Phiếu đã có; tệp tải lên sau. Tệp nào hỏng thì phiếu vẫn còn, người
      // gửi đính kèm lại trong phần trao đổi được.
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        await fetch(`/ho-tro/api/tickets/${data.id}/attachments`, { method: "POST", body: fd }).catch(() => null);
      }
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* bỏ qua */
      }
      router.push(`/phieu/${data.id}`);
      router.refresh();
    } catch {
      setErr("Không kết nối được máy chủ");
    } finally {
      setBusy(false);
    }
  }

  function clearDraft() {
    setTitle("");
    setDescription("");
    setPriority("NORMAL");
    setAnswers({});
    setFiles([]);
    setRestored(false);
    try {
      localStorage.removeItem(DRAFT);
    } catch {
      /* bỏ qua */
    }
  }

  const fieldEl = (f: FormField) => {
    const id = `f-${f.key}`;
    const v = String(current[f.key] ?? "");
    if (f.type === "textarea")
      return <textarea id={id} rows={3} value={v} onChange={(e) => setAnswer(f.key, e.target.value)} className="field" />;
    if (f.type === "select")
      return (
        <select id={id} value={v} onChange={(e) => setAnswer(f.key, e.target.value)} className="raise w-full rounded-full border-0 px-4 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--amber)]">
          <option value="">— Chọn —</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    if (f.type === "checkbox")
      return (
        <label className="press flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-sm">
          <input id={id} type="checkbox" checked={Boolean(current[f.key])} onChange={(e) => setAnswer(f.key, e.target.checked)} className="h-5 w-5 accent-[#3b4040]" />
          <span>{f.hint ?? "Có"}</span>
        </label>
      );
    return (
      <input
        id={id}
        type={f.type === "date" ? "date" : "text"}
        value={v}
        onChange={(e) => setAnswer(f.key, e.target.value)}
        placeholder={f.key === "duong_dan" ? "phys.hcmus.edu.vn/…" : undefined}
        className="field"
      />
    );
  };

  const prio = PRIOS.find((p) => p.v === priority)!;
  const STEPS = ["Loại", "Mô tả", "Thông tin riêng", "Ảnh hưởng"];

  return (
    <form onSubmit={submit} noValidate>
      {/* ── Vùng sáng: tiêu đề + 4 bước ────────────────────────────────── */}
      <section className="flex flex-wrap items-end justify-between gap-5 px-5 pt-8 sm:px-9">
        <h1 className="text-[clamp(40px,5vw,68px)] font-medium leading-none tracking-[-0.04em]">Gửi yêu cầu</h1>
        <ol aria-label="Các bước" className="press flex flex-wrap gap-1.5 rounded-full p-1.5">
          {STEPS.map((s, i) => {
            const ok = done[i];
            const now = i === curStep;
            return (
              <li
                key={s}
                aria-current={now ? "step" : undefined}
                className={"flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm " + (ok ? "raise" : now ? "font-medium" : "muted")}
              >
                <span
                  className={
                    "flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold " +
                    (ok ? "raise-d text-[var(--on-dark)]" : now ? "knob" : "")
                  }
                >
                  {ok ? "✓" : i + 1}
                </span>
                {s}
              </li>
            );
          })}
        </ol>
      </section>
      <CurveDown />

      {/* ── Dải tối: chọn loại ─────────────────────────────────────────── */}
      <section aria-labelledby="s1" className="band px-5 pb-6 sm:px-9">
        <h2 id="s1" className="mb-4 text-xl font-medium">
          1 · Loại yêu cầu
        </h2>
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {forms.map((f) => {
            const on = f.key === formKey;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={on}
                onClick={() => setFormKey(f.key)}
                className={(on ? "press-d" : "raise-d hover:-translate-y-0.5") + " tap flex flex-col gap-2 rounded-[28px] p-5 text-left transition-transform"}
              >
                <span className="flex items-center justify-between gap-3 font-medium">
                  {f.name}
                  <span
                    className="h-3 w-3 flex-none rounded-full"
                    style={{ background: on ? "#7fcbb4" : "#3d4141", boxShadow: on ? "0 0 12px rgba(127,203,180,.9)" : "inset 0 1px 2px rgba(0,0,0,.5)" }}
                  />
                </span>
                {f.description ? <span className="text-sm font-light text-[var(--on-dark-muted)]">{f.description}</span> : null}
                {f.team ? <span className="mt-auto text-[13px] text-[var(--on-dark-muted)]">→ {f.team}</span> : null}
              </button>
            );
          })}
        </div>
      </section>
      <CurveUp />

      {/* ── Vùng sáng: nội dung + bản nháp ─────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-6 px-5 pb-11 pt-1.5 sm:px-8">
        <div className="flex min-w-0 flex-[999_1_620px] flex-col gap-5">
          {restored ? (
            <p className="press flex flex-wrap items-center justify-between gap-3 rounded-full py-2 pl-5 pr-2 text-sm">
              Đã mở lại bản nháp lần trước.
              <button type="button" onClick={clearDraft} className="raise tap rounded-full px-4 py-1.5 text-[13px]">
                Bắt đầu lại từ đầu
              </button>
            </p>
          ) : null}

          <section className="raise flex flex-col gap-3 rounded-[34px] p-6">
            <h2 className="text-xl font-medium">2 · Chuyện gì đang xảy ra?</h2>
            <label htmlFor="title" className="text-sm font-medium">
              Tiêu đề <span className="text-[#a1301f]">*</span>
            </label>
            <input id="title" type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Một câu tóm tắt — ví dụ: Không tải được ảnh đại diện" className="field" />
            <label htmlFor="desc" className="text-sm font-medium">
              Mô tả <span className="text-[#a1301f]">*</span>
            </label>
            <textarea
              id="desc"
              rows={4}
              value={description}
              maxLength={5000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Thầy/cô đang làm gì thì gặp chuyện này? Lỗi hiện ra như thế nào?"
              className="field"
            />
          </section>

          {form.fields.length ? (
            <section className="raise flex flex-col gap-4 rounded-[34px] p-6">
              <h2 className="text-xl font-medium">
                3 · Thông tin riêng <span className="muted text-base font-light">cho “{form.name}”</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {form.fields.map((f) => (
                  <div key={`${formKey}-${f.key}`} className={"flex flex-col gap-2 " + (f.type === "textarea" ? "sm:col-span-2" : "")}>
                    <label htmlFor={`f-${f.key}`} className="text-sm font-medium">
                      {f.label} {f.required ? <span className="text-[#a1301f]">*</span> : null}
                    </label>
                    {fieldEl(f)}
                    {f.hint && f.type !== "checkbox" ? <span className="muted text-xs">{f.hint}</span> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="raise flex flex-col gap-4 rounded-[34px] p-6">
            <h2 className="text-xl font-medium">{form.fields.length ? "4" : "3"} · Ảnh hưởng &amp; tệp đính kèm</h2>
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2.5 text-sm font-medium">Sự cố ảnh hưởng tới công việc thế nào?</legend>
              <div className="press grid gap-1.5 rounded-[26px] p-1.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                {PRIOS.map((p) => {
                  const on = p.v === priority;
                  return (
                    <button
                      key={p.v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPriority(p.v)}
                      className={(on ? "raise " : "") + "tap flex flex-col gap-1 rounded-[20px] px-4 py-3 text-left"}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? p.c : "#c9c8c3", boxShadow: on ? `0 0 10px ${p.c}` : "none" }} />
                        {p.label}
                      </span>
                      <span className="muted text-xs">{p.desc}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label
              htmlFor="files"
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(e.dataTransfer.files);
              }}
              onPaste={(e) => addFiles(e.clipboardData.files)}
              tabIndex={-1}
              className={"press flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-[26px] px-5 py-4 " + (drag ? "ring-[3px] ring-[var(--amber)]" : "")}
            >
              <span className="flex flex-col">
                <span className="font-medium">Kéo thả, chọn tệp, hoặc dán ảnh bằng Ctrl+V</span>
                <span className="muted text-xs">PNG, JPG, PDF — tối đa 10 MB mỗi tệp</span>
              </span>
              <span className="raise-d rounded-full px-5 py-2.5 text-sm font-medium text-[var(--on-dark)]">Chọn tệp</span>
              <input
                ref={fileInput}
                id="files"
                type="file"
                multiple
                accept="image/png,image/jpeg,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {files.map((f, i) => (
              <div key={`${f.name}${i}`} className="raise flex items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                <span className="muted text-xs">{kb(f.size)}</span>
                <button
                  type="button"
                  aria-label={`Bỏ tệp ${f.name}`}
                  onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                  className="press tap flex h-8 w-8 items-center justify-center rounded-full"
                >
                  ×
                </button>
              </div>
            ))}
          </section>
        </div>

        <aside aria-label="Bản nháp phiếu" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 lg:sticky lg:top-6">
          <div className="raise-d flex flex-col gap-4 rounded-[34px] p-6 text-[var(--on-dark)]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--on-dark-muted)]">Phiếu nháp</span>
              <span className="font-mono font-semibold">VL-····</span>
            </div>
            <span className="text-lg font-medium leading-snug">{title.trim() || "Chưa có tiêu đề"}</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Loại", form.name],
                ["Tới nhóm", form.team ?? "Bộ phận kỹ thuật"],
                ["Mức độ", prio.label],
                ["Đính kèm", files.length ? `${files.length} tệp` : "Không"],
              ].map(([k, v]) => (
                <span key={k} className="press-d flex flex-col rounded-[18px] px-3.5 py-2.5 text-xs text-[var(--on-dark-muted)]">
                  {k}
                  <span className="text-sm font-medium text-[var(--on-dark)]">{v}</span>
                </span>
              ))}
            </div>
            <ol className="flex flex-col gap-1.5 text-sm font-light">
              {["Nhận mã phiếu và email xác nhận", "Có người tiếp nhận trong giờ hành chính", "Mọi trao đổi hiện trên phiếu"].map((s, i) => (
                <li key={s}>
                  <span className="font-mono text-[var(--amber)]">{String(i + 1).padStart(2, "0")} </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          <label className="raise flex cursor-pointer items-center gap-3 rounded-[26px] px-5 py-4 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-[#3b4040]" />
            <span className="flex min-w-0 flex-col">
              Email cho tôi khi có trả lời
              <span className="muted truncate font-mono text-xs">{email}</span>
            </span>
          </label>
          {err ? (
            <p role="alert" className="rounded-2xl bg-[#f3dcd6] px-4 py-2.5 text-sm text-[#8a2e1e]">
              {err}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="raise-d tap inline-flex h-[60px] items-center justify-between gap-3 rounded-full pl-7 pr-2 text-lg font-medium text-[var(--on-dark)] disabled:opacity-60"
          >
            {busy ? "Đang gửi…" : "Gửi phiếu"}
            <span className="knob flex h-11 w-11 items-center justify-center rounded-full text-[#22252a]">
              <ArrowUpRight size={18} />
            </span>
          </button>
          <span className="muted text-center text-xs">Bản nháp tự lưu trên máy này.</span>
        </aside>
      </div>
    </form>
  );
}
