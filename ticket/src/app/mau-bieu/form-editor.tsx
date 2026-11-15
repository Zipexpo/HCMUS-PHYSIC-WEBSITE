"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormField } from "@/lib/ticket";
import { Led } from "@/components/ui";

type Initial = {
  id?: string;
  key: string;
  name: string;
  description: string;
  defaultTeam: string;
  isActive: boolean;
  sortOrder: number;
  unitRoute: boolean;
  approval: { field: string; values: string[] } | null;
  fields: FormField[];
  ticketCount: number;
};

/** Một ô đang soạn. `locked` = ô đã có từ trước, khoá không được đổi. */
type Draft = FormField & { uid: string; locked: boolean; keyTouched: boolean; optionsText: string };

const TYPES: { v: FormField["type"]; label: string }[] = [
  { v: "text", label: "Một dòng" },
  { v: "textarea", label: "Đoạn văn" },
  { v: "select", label: "Chọn một" },
  { v: "date", label: "Ngày" },
  { v: "checkbox", label: "Ô đánh dấu" },
];

/** "Phần mềm bị lỗi" → "phan_mem_bi_loi" — khoá ô đọc được, không dấu. */
function slug(s: string, sep = "_"): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, "g"), "")
    .slice(0, 40);
}

let seq = 0;
const uid = () => `f${++seq}`;

export function FormEditor({ initial, teams }: { initial: Initial; teams: string[] }) {
  const router = useRouter();
  const isNew = !initial.id;
  const [meta, setMeta] = useState({
    key: initial.key,
    name: initial.name,
    description: initial.description,
    defaultTeam: initial.defaultTeam,
    isActive: initial.isActive,
    sortOrder: initial.sortOrder,
    unitRoute: initial.unitRoute,
    approval: initial.approval,
  });
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const fromInitial = (): Draft[] =>
    initial.fields.map((f) => ({
      ...f,
      uid: uid(),
      locked: true,
      keyTouched: true,
      optionsText: (f.options ?? []).join("\n"),
    }));
  const [fields, setFields] = useState<Draft[]>(fromInitial);
  // Có thay đổi chưa lưu? So nội dung chứ không đếm lần gõ — sửa rồi sửa lại
  // như cũ thì coi như không đổi.
  const snapshot = (m: typeof meta, fs: Draft[]) =>
    JSON.stringify([m, fs.map(({ uid: _u, keyTouched: _k, ...rest }) => rest)]);
  const [base, setBase] = useState(() => snapshot(
    {
      key: initial.key,
      name: initial.name,
      description: initial.description,
      defaultTeam: initial.defaultTeam,
      isActive: initial.isActive,
      sortOrder: initial.sortOrder,
    unitRoute: initial.unitRoute,
    approval: initial.approval,
    },
    fromInitial(),
  ));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setM = (patch: Partial<typeof meta>) => {
    setMeta((m) => ({ ...m, ...patch }));
    setSaved(false);
  };
  const setF = (id: string, patch: Partial<Draft>) => {
    setFields((fs) => fs.map((f) => (f.uid === id ? { ...f, ...patch } : f)));
    setSaved(false);
  };
  const move = (i: number, d: -1 | 1) => {
    setFields((fs) => {
      const j = i + d;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSaved(false);
  };
  // Kéo ⋮⋮ để đổi chỗ: thả ô `from` vào vị trí `to`.
  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    setFields((fs) => {
      const next = [...fs];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
    setSaved(false);
  };
  const add = () => {
    setFields((fs) => [
      ...fs,
      { uid: uid(), key: "", label: "", type: "text", locked: false, keyTouched: false, optionsText: "" },
    ]);
    setSaved(false);
  };
  const remove = (f: Draft) => {
    if (
      f.locked &&
      initial.ticketCount > 0 &&
      !window.confirm(
        `Bỏ ô "${f.label}"? Phiếu cũ vẫn giữ câu trả lời, nhưng phiếu mới sẽ không hỏi ô này nữa.`,
      )
    )
      return;
    setFields((fs) => fs.filter((x) => x.uid !== f.uid));
    setSaved(false);
  };

  const dirty = snapshot(meta, fields) !== base;
  // Rời trang khi còn thay đổi chưa lưu thì trình duyệt hỏi lại.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function discard() {
    if (!window.confirm("Bỏ mọi thay đổi chưa lưu của mẫu này?")) return;
    setMeta({
      key: initial.key,
      name: initial.name,
      description: initial.description,
      defaultTeam: initial.defaultTeam,
      isActive: initial.isActive,
      sortOrder: initial.sortOrder,
    unitRoute: initial.unitRoute,
    approval: initial.approval,
    });
    setFields(fromInitial());
    setKeyTouched(!isNew);
    setErr(null);
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = {
        ...meta,
        fields: fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.type === "checkbox" ? false : Boolean(f.required),
          options: f.type === "select" ? f.optionsText.split("\n") : undefined,
          hint: f.hint,
        })),
      };
      const res = await fetch(isNew ? "/ho-tro/api/forms" : `/ho-tro/api/forms/${initial.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        setErr(data.message ?? "Không lưu được");
        return;
      }
      setSaved(true);
      setBase(snapshot(meta, fields));
      if (isNew && data.id) router.push(`/mau-bieu?id=${data.id}`);
      router.refresh();
    } catch {
      setErr("Không kết nối được máy chủ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="form-editor" onSubmit={save} className="grid gap-6 px-5 pb-6 pt-2 sm:px-10 xl:grid-cols-[1fr_24rem] xl:items-start">
      <div className="raise sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-full py-2 pl-6 pr-2 xl:col-span-2">
        <span className="flex items-center gap-2.5 text-sm">
          <Led color={dirty ? "var(--amber)" : "var(--mint)"} />
          {dirty ? "Có thay đổi chưa lưu" : saved ? "Đã lưu — trang Gửi yêu cầu đã đổi theo" : isNew ? "Loại yêu cầu mới" : "Chưa sửa gì"}
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={discard} disabled={!dirty || busy} className="raise tap h-11 rounded-full px-5 text-sm font-medium disabled:opacity-40">
            Bỏ thay đổi
          </button>
          <button
            type="submit"
            disabled={busy || (!dirty && !isNew)}
            className="raise-d tap inline-flex h-11 items-center gap-3 rounded-full pl-5 pr-1.5 text-sm font-medium text-[var(--on-dark)] disabled:opacity-40"
          >
            {busy ? "Đang lưu…" : isNew ? "Tạo & áp dụng" : "Lưu & áp dụng"}
            <span className="knob flex h-8 w-8 items-center justify-center rounded-full text-[#22252a]">✓</span>
          </button>
        </span>
      </div>
      <div className="space-y-6">
        {/* ── Thông tin chung ─────────────────────────────────────── */}
        <div className="card space-y-5 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow muted">{isNew ? "Loại yêu cầu mới" : "Thông tin chung"}</h2>
            <label className="press flex cursor-pointer items-center gap-2.5 rounded-full px-4 py-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--amber)]"
                checked={meta.isActive}
                onChange={(e) => setM({ isActive: e.target.checked })}
              />
              <Led color={meta.isActive ? "var(--mint)" : "#9aa09d"} off={!meta.isActive} />
              {meta.isActive ? "Đang nhận yêu cầu" : "Đang tắt"}
            </label>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="m-name" className="block text-sm font-medium">
                Tên loại <span className="text-[var(--rose)]">*</span>
              </label>
              <input
                id="m-name"
                required
                value={meta.name}
                onChange={(e) =>
                  setM({ name: e.target.value, ...(keyTouched ? {} : { key: slug(e.target.value, "-") }) })
                }
                className="field mt-2"
                placeholder="Lỗi phần mềm"
              />
            </div>
            <div>
              <label htmlFor="m-key" className="block text-sm font-medium">
                Mã trên đường link
              </label>
              <input
                id="m-key"
                required
                disabled={!isNew}
                value={meta.key}
                onChange={(e) => {
                  setKeyTouched(true);
                  setM({ key: e.target.value.toLowerCase() });
                }}
                className={"field mt-2 font-mono" + (isNew ? "" : " opacity-60")}
                placeholder="loi-phan-mem"
              />
              <p className="muted mt-1.5 text-xs">
                {isNew ? "Không đổi được sau khi tạo." : "Đã khoá — link cũ vẫn phải mở đúng loại này."}
              </p>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="m-desc" className="block text-sm font-medium">
                Mô tả ngắn
              </label>
              <textarea
                id="m-desc"
                rows={2}
                value={meta.description}
                onChange={(e) => setM({ description: e.target.value })}
                className="field mt-2"
                placeholder="Hiện dưới tên loại để người gửi chọn đúng."
              />
            </div>
            <div>
              <label htmlFor="m-team" className="block text-sm font-medium">
                Nhóm nhận mặc định
              </label>
              {/* Chỉ chọn trong các nhóm đã lập (trang Nhóm) — gõ tay tên lạ thì phiếu
                  tới một nhóm không có ai. */}
              <select
                id="m-team"
                value={meta.defaultTeam}
                onChange={(e) => setM({ defaultTeam: e.target.value })}
                className="field mt-2"
              >
                {meta.defaultTeam && !teams.includes(meta.defaultTeam) ? (
                  <option value={meta.defaultTeam}>{meta.defaultTeam} (nhóm chưa lập)</option>
                ) : null}
                {!meta.defaultTeam ? <option value="">— Chọn nhóm —</option> : null}
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="m-order" className="block text-sm font-medium">
                Thứ tự hiển thị
              </label>
              <input
                id="m-order"
                type="number"
                min={0}
                max={999}
                value={meta.sortOrder}
                onChange={(e) => setM({ sortOrder: Number(e.target.value) || 0 })}
                className="field mt-2"
              />
            </div>
          </div>
        </div>

        {/* ── Chuyển phiếu & duyệt ───────────────────────────────── */}
        <div className="card space-y-4 p-6 sm:p-7">
          <h2 className="eyebrow muted">Chuyển phiếu &amp; duyệt</h2>
          <label className="press flex cursor-pointer items-start gap-3 rounded-[20px] px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={meta.unitRoute}
              onChange={(e) => setM({ unitRoute: e.target.checked })}
              className="mt-0.5 h-5 w-5 accent-[#3b4040]"
            />
            <span>
              <span className="font-medium">Chuyển trước cho đầu mối đơn vị của người gửi</span>
              <span className="muted block text-xs">
                Dùng cho việc đơn vị tự làm được (vd sửa nội dung trang bộ môn). Quá hạn phản hồi, hoặc đơn vị chưa có
                đầu mối, thì nhóm phụ trách nhận.
              </span>
            </span>
          </label>
          {(() => {
            const selects = fields.filter((f) => f.type === "select" && f.key);
            const rule = meta.approval;
            const ruleField = selects.find((f) => f.key === rule?.field);
            const opts = ruleField ? ruleField.optionsText.split("\n").map((o) => o.trim()).filter(Boolean) : [];
            return (
              <div className="press space-y-3 rounded-[20px] px-4 py-3 text-sm">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={!!rule}
                    disabled={!selects.length}
                    onChange={(e) =>
                      setM({ approval: e.target.checked && selects[0] ? { field: selects[0].key, values: [] } : null })
                    }
                    className="mt-0.5 h-5 w-5 accent-[#3b4040]"
                  />
                  <span>
                    <span className="font-medium">Cần đầu mối đơn vị duyệt trước khi xử lý</span>
                    <span className="muted block text-xs">
                      {selects.length
                        ? "Người gửi chọn một trong các lựa chọn đánh dấu dưới đây thì phiếu chờ đầu mối đơn vị của họ duyệt, rồi nhóm mới làm."
                        : "Cần ít nhất một ô kiểu chọn để đặt luật duyệt."}
                    </span>
                  </span>
                </label>
                {rule ? (
                  <div className="space-y-2 pl-8">
                    <label className="flex flex-wrap items-center gap-2">
                      Dựa trên ô
                      <select
                        value={rule.field}
                        onChange={(e) => setM({ approval: { field: e.target.value, values: [] } })}
                        className="raise rounded-full border-0 px-3 py-1.5 text-[13px] outline-none"
                      >
                        {selects.map((f) => (
                          <option key={f.uid} value={f.key}>
                            {f.label || f.key}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {opts.map((o) => {
                        const on = rule.values.includes(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setM({
                                approval: {
                                  field: rule.field,
                                  values: on ? rule.values.filter((v) => v !== o) : [...rule.values, o],
                                },
                              })
                            }
                            className={"tap rounded-full px-3.5 py-1.5 text-[13px] " + (on ? "raise-d text-[var(--on-dark)]" : "raise")}
                          >
                            {on ? "✓ " : ""}
                            {o}
                          </button>
                        );
                      })}
                    </div>
                    {!rule.values.length ? <p className="text-xs text-[#8a2e1e]">Chọn ít nhất một lựa chọn cần duyệt.</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>

        {/* ── Các ô riêng ─────────────────────────────────────────── */}
        <div className="card space-y-4 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="eyebrow muted">Ô hỏi thêm · {fields.length} <span className="normal-case tracking-normal">— kéo ⋮⋮ để đổi thứ tự</span></h2>
              <p className="muted mt-1 text-xs">
                Tiêu đề, mô tả và mức độ luôn có sẵn — chỉ thêm những gì riêng của loại này.
              </p>
            </div>
            <button type="button" onClick={add} className="btn btn-ghost">
              + Thêm ô
            </button>
          </div>

          {fields.length === 0 ? (
            <p className="press rounded-[22px] px-5 py-8 text-center text-sm muted">
              Chưa có ô riêng nào.
            </p>
          ) : (
            <ol className="space-y-3">
              {fields.map((f, i) => (
                <li
                  key={f.uid}
                  onDragOver={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    setDragOver(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null) moveTo(dragFrom, i);
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  className={
                    "press space-y-4 rounded-[24px] p-4 transition-opacity sm:p-5 " +
                    (dragFrom === i ? "opacity-40 " : "") +
                    (dragOver === i && dragFrom !== null && dragFrom !== i ? "ring-[3px] ring-[var(--amber)]" : "")
                  }
                >
                  <div className="flex flex-wrap items-start gap-3">
                    {/* Tay nắm kéo thả. Bàn phím / màn hình cảm ứng vẫn dùng nút ↑ ↓ bên phải. */}
                    <span
                      draggable
                      onDragStart={(e) => {
                        setDragFrom(i);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(i));
                        const row = e.currentTarget.closest("li");
                        if (row) e.dataTransfer.setDragImage(row, 24, 24);
                      }}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      title="Kéo để đổi thứ tự"
                      aria-hidden
                      className="muted flex h-9 w-6 shrink-0 cursor-grab select-none items-center justify-center text-lg active:cursor-grabbing"
                    >
                      ⋮⋮
                    </span>
                    <span className="raise flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-xs">
                      {i + 1}
                    </span>
                    <div className="min-w-[12rem] flex-1">
                      <label htmlFor={`${f.uid}-l`} className="sr-only">
                        Nhãn ô {i + 1}
                      </label>
                      <input
                        id={`${f.uid}-l`}
                        required
                        value={f.label}
                        onChange={(e) =>
                          setF(f.uid, {
                            label: e.target.value,
                            ...(f.keyTouched ? {} : { key: slug(e.target.value) }),
                          })
                        }
                        placeholder="Nhãn ô, vd: Phần mềm bị lỗi"
                        className="field bg-[var(--raise-a)]"
                      />
                      <p className="muted mt-1.5 font-mono text-[11px]">
                        khoá: {f.key || "—"}
                        {f.locked ? " (đã khoá)" : ""}
                      </p>
                    </div>
                    <label htmlFor={`${f.uid}-t`} className="sr-only">
                      Kiểu ô {i + 1}
                    </label>
                    <select
                      id={`${f.uid}-t`}
                      value={f.type}
                      onChange={(e) => setF(f.uid, { type: e.target.value as FormField["type"] })}
                      className="field w-auto bg-[var(--raise-a)]"
                    >
                      {TYPES.map((t) => (
                        <option key={t.v} value={t.v}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-1">
                      <button type="button" aria-label={`Đưa ô ${i + 1} lên`} disabled={i === 0} onClick={() => move(i, -1)} className="raise tap h-10 w-10 rounded-full disabled:opacity-40">
                        ↑
                      </button>
                      <button type="button" aria-label={`Đưa ô ${i + 1} xuống`} disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="raise tap h-10 w-10 rounded-full disabled:opacity-40">
                        ↓
                      </button>
                      <button type="button" aria-label={`Bỏ ô ${i + 1}`} onClick={() => remove(f)} className="raise tap h-10 w-10 rounded-full text-[var(--rose)]">
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center sm:pl-12">
                    <div>
                      <label htmlFor={`${f.uid}-h`} className="sr-only">
                        Gợi ý cho ô {i + 1}
                      </label>
                      <input
                        id={`${f.uid}-h`}
                        value={f.hint ?? ""}
                        onChange={(e) => setF(f.uid, { hint: e.target.value })}
                        placeholder={f.type === "checkbox" ? "Chữ cạnh ô đánh dấu" : "Gợi ý (không bắt buộc)"}
                        className="field bg-[var(--raise-a)] text-sm"
                      />
                    </div>
                    {f.type !== "checkbox" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--amber)]"
                          checked={Boolean(f.required)}
                          onChange={(e) => setF(f.uid, { required: e.target.checked })}
                        />
                        Bắt buộc
                      </label>
                    ) : null}
                  </div>

                  {f.type === "select" ? (
                    <div className="raise-d rounded-[20px] p-4 sm:ml-12">
                      <label htmlFor={`${f.uid}-o`} className="text-sm font-medium">
                        Các lựa chọn — mỗi dòng một lựa chọn
                      </label>
                      <textarea
                        id={`${f.uid}-o`}
                        rows={4}
                        value={f.optionsText}
                        onChange={(e) => setF(f.uid, { optionsText: e.target.value })}
                        className="field mt-2 border-0 bg-[var(--slate-deep)] text-[var(--on-dark)]"
                        placeholder={"Hồ sơ khoa học\nWeb Khoa\nEmail"}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ── Xem trước + lưu ──────────────────────────────────────── */}
      <aside className="space-y-4 xl:sticky xl:top-6">
        <div className="raise-d space-y-4 rounded-[32px] p-6">
          <p className="eyebrow muted">Người gửi sẽ thấy</p>
          <div>
            <p className="text-lg font-medium">{meta.name || "Tên loại"}</p>
            {meta.description ? <p className="muted mt-1 text-sm">{meta.description}</p> : null}
          </div>
          <div aria-hidden className="space-y-3 text-sm">
            {["Tiêu đề", "Mô tả chi tiết"].map((l) => (
              <div key={l}>
                <p>{l} <span className="text-[var(--rose)]">*</span></p>
                <div className="press-d mt-1.5 h-9 rounded-xl" />
              </div>
            ))}
            {fields.map((f) => (
              <div key={f.uid}>
                {f.type === "checkbox" ? (
                  <p className="flex items-center gap-2">
                    <span className="press-d inline-block h-4 w-4 rounded" />
                    {f.hint || f.label || "Ô đánh dấu"}
                  </p>
                ) : (
                  <>
                    <p>
                      {f.label || "(chưa đặt nhãn)"}{" "}
                      {f.required ? <span className="text-[var(--rose)]">*</span> : null}
                    </p>
                    <div className={"press-d mt-1.5 flex items-center justify-between rounded-xl px-3 text-xs muted " + (f.type === "textarea" ? "h-16" : "h-9")}>
                      {f.type === "select"
                        ? (f.optionsText.split("\n").find((o) => o.trim()) ?? "— Chọn —")
                        : f.type === "date"
                          ? "dd/mm/yyyy"
                          : ""}
                      {f.type === "select" ? <span>▾</span> : null}
                    </div>
                    {f.hint ? <p className="muted mt-1 text-xs">{f.hint}</p> : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {err ? (
          <p role="alert" className="rounded-2xl bg-[var(--rose)] px-4 py-2.5 text-sm text-[#22252a]">
            {err}
          </p>
        ) : saved ? (
          <p role="status" className="press flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm">
            <Led color="var(--mint)" /> Đã lưu
          </p>
        ) : null}
        <button type="submit" disabled={busy} className="btn btn-primary w-full py-3.5">
          {busy ? "Đang lưu…" : isNew ? "Tạo loại yêu cầu" : "Lưu mẫu biểu"}
        </button>
        {!isNew && initial.ticketCount > 0 ? (
          <p className="muted text-xs">
            {initial.ticketCount} phiếu đã dùng mẫu này. Đổi nhãn hay bỏ ô không làm mất câu trả lời cũ.
          </p>
        ) : null}
      </aside>
    </form>
  );
}
