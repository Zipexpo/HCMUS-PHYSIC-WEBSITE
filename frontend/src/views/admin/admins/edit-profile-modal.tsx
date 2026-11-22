"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "react-toastify";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type AdminListItem, adminApi, type StaffUnit } from "@/lib/api";

// Khoá phải khớp ĐÚNG chuỗi ACADsoom dùng (Mục 10.4).
// Export để trang "Quản lý cán bộ" (create-staff-modal) dùng chung, khỏi copy.
export const RANKS: [string, string][] = [
  ["GV", "Giảng viên"],
  ["GVC", "Giảng viên chính"],
  ["GVCC", "Giảng viên cao cấp"],
  ["TrG", "Trợ giảng"],
  ["NCV", "Nghiên cứu viên"],
  ["NCVC", "Nghiên cứu viên chính"],
  ["CV", "Chuyên viên"],
  ["KTV", "Kỹ thuật viên"],
  ["NV", "Nhân viên phòng ban"],
];
export const POSITIONS: [string, string][] = [
  ["truong_khoa", "Trưởng khoa"],
  ["pho_truong_khoa", "Phó Trưởng khoa"],
  ["truong_bo_mon", "Trưởng bộ môn"],
  ["pho_truong_bo_mon", "Phó Trưởng bộ môn"],
  ["truong_ptn", "Trưởng PTN"],
  ["giao_vu", "Giáo vụ"],
  ["tro_ly", "Trợ lý Khoa"],
  ["cong_doan", "Chủ tịch Công đoàn"],
  ["doan_thanh_nien", "Bí thư Đoàn TN"],
];
export const DEGREES: [string, string][] = [
  ["GS", "Giáo sư"],
  ["PGS", "Phó Giáo sư"],
  ["TS", "Tiến sĩ"],
  ["ThS", "Thạc sĩ"],
  ["CN", "Cử nhân"],
];
export const EMPLOYMENT: [string, string][] = [
  ["bien_che", "Biên chế"],
  ["hop_dong", "Hợp đồng"],
  ["thinh_giang", "Thỉnh giảng"],
  // Tính điểm y như thỉnh giảng (người ngoài); nhãn riêng để thống kê.
  ["thinh_giang_nuoc_ngoai", "Thỉnh giảng nước ngoài"],
];

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const nn = (s: string) => (s.trim() ? s : null);

const fieldCls =
  "w-full px-3 py-2 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a2436] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-500/30";

export function EditProfileModal({
  person,
  units,
  onClose,
}: {
  person: AdminListItem;
  units: StaffUnit[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [rank, setRank] = useState(person.rank ?? "");
  const [positionKey, setPositionKey] = useState(person.positionKey ?? "");
  const [degree, setDegree] = useState(person.degree ?? "");
  const [teacherId, setTeacherId] = useState(person.teacherId ?? "");
  const [employmentType, setEmploymentType] = useState(
    person.employmentType ?? "",
  );
  const [departmentId, setDepartmentId] = useState(person.department?.id ?? "");
  const [positionFrom, setPositionFrom] = useState(day(person.positionFrom));
  const [positionTo, setPositionTo] = useState(day(person.positionTo));
  // Đổi ngạch phải khai lý do + ngày hiệu lực. So không phân biệt hoa thường,
  // khớp đúng luật backend dùng, để giao diện không chặn/thả lệch với nó.
  const [rankReason, setRankReason] = useState("");
  const [rankEffectiveFrom, setRankEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const rankChanged =
    (rank || "").trim().toLowerCase() !==
    (person.rank ?? "").trim().toLowerCase();
  const thieuKhai = rankChanged && !rankReason.trim();

  const save = useMutation({
    mutationKey: ["ADMINS", "UPDATE_PROFILE", person.id],
    mutationFn: () =>
      adminApi.updateProfile(person.id, {
        rank: nn(rank),
        positionKey: nn(positionKey),
        degree: nn(degree),
        teacherId: nn(teacherId),
        employmentType: nn(employmentType),
        departmentId: nn(departmentId),
        positionFrom: nn(positionFrom),
        positionTo: nn(positionTo),
        ...(rankChanged
          ? {
              rankReason: rankReason.trim(),
              rankEffectiveFrom: rankEffectiveFrom,
            }
          : {}),
      }),
    onSuccess: () => {
      toast.success("Đã lưu hồ sơ");
      // Modal này dùng chung cho cả trang admin (["ADMINS"]) lẫn trang cán bộ
      // (["STAFF"]); làm mới cả hai để danh sách đang mở cập nhật ngay.
      queryClient.invalidateQueries({ queryKey: ["ADMINS"] });
      queryClient.invalidateQueries({ queryKey: ["STAFF"] });
      onClose();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Lưu hồ sơ thất bại");
    },
  });

  const name =
    [person.lastName, person.firstName].filter(Boolean).join(" ").trim() ||
    person.email;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hồ sơ — {name}</DialogTitle>
          <DialogDescription>
            Web Khoa làm chủ các trường này; ACADsoom kéo về để tính định mức.
            Ngạch sai là sai định mức cả năm.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-2 grid grid-cols-2 gap-3"
        >
          <Field label="Ngạch" htmlFor={`${id}-rank`}>
            <select
              id={`${id}-rank`}
              value={rank}
              onChange={(e) => setRank(e.target.value)}
              className={fieldCls}
            >
              <option value="">— chưa đặt —</option>
              {RANKS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l} ({k})
                </option>
              ))}
            </select>
          </Field>

          {/* Hai ô này CHỈ hiện khi ngạch thật sự đổi — sửa học vị hay đơn vị
              thì không bắt khai gì. */}
          {rankChanged ? (
            <div className="col-span-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30 p-3 space-y-3">
              <p className="text-xs text-amber-900 dark:text-amber-200">
                Đang đổi ngạch <b>{person.rank || "(chưa đặt)"}</b> →{" "}
                <b>{rank || "(xoá trắng)"}</b>. Ngạch quyết định mẫu phiếu bên
                ACADsoom, nên phải ghi lại lý do và ngày có hiệu lực.
              </p>
              <Field label="Lý do đổi ngạch *" htmlFor={`${id}-rank-reason`}>
                <input
                  id={`${id}-rank-reason`}
                  value={rankReason}
                  onChange={(e) => setRankReason(e.target.value)}
                  maxLength={500}
                  placeholder="VD: chuyển vị trí việc làm theo QĐ số…"
                  className={fieldCls}
                />
              </Field>
              <Field label="Có hiệu lực từ *" htmlFor={`${id}-rank-effective`}>
                <input
                  id={`${id}-rank-effective`}
                  type="date"
                  value={rankEffectiveFrom}
                  onChange={(e) => setRankEffectiveFrom(e.target.value)}
                  className={fieldCls}
                />
              </Field>
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Ngày hiệu lực có thể khác hôm nay — hồi tố hoặc áp dụng từ kỳ
                sau đều được.
              </p>
            </div>
          ) : null}

          <Field label="Học vị" htmlFor={`${id}-degree`}>
            <select
              id={`${id}-degree`}
              value={degree}
              onChange={(e) => setDegree(e.target.value)}
              className={fieldCls}
            >
              <option value="">— chưa đặt —</option>
              {DEGREES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Chức vụ quản lý" htmlFor={`${id}-pos`}>
            <select
              id={`${id}-pos`}
              value={positionKey}
              onChange={(e) => setPositionKey(e.target.value)}
              className={fieldCls}
            >
              <option value="">— không giữ chức vụ —</option>
              {POSITIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Đơn vị" htmlFor={`${id}-unit`}>
            <select
              id={`${id}-unit`}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className={fieldCls}
            >
              <option value="">— chưa đặt —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nhiệm kỳ từ" htmlFor={`${id}-from`}>
            <input
              id={`${id}-from`}
              type="date"
              value={positionFrom}
              onChange={(e) => setPositionFrom(e.target.value)}
              className={fieldCls}
            />
          </Field>

          <Field label="Nhiệm kỳ đến" htmlFor={`${id}-to`}>
            <input
              id={`${id}-to`}
              type="date"
              value={positionTo}
              onChange={(e) => setPositionTo(e.target.value)}
              className={fieldCls}
            />
          </Field>

          <Field label="MSCB (giữ số 0 đầu)" htmlFor={`${id}-mscb`}>
            <input
              id={`${id}-mscb`}
              type="text"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className={fieldCls}
            />
          </Field>

          <Field label="Loại công tác" htmlFor={`${id}-emp`}>
            <select
              id={`${id}-emp`}
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              className={fieldCls}
            >
              <option value="">— chưa đặt —</option>
              {EMPLOYMENT.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>

          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#202c44]"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={save.isPending || thieuKhai}
              title={thieuKhai ? "Đổi ngạch phải ghi lý do" : undefined}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {save.isPending ? "Đang lưu…" : "Lưu hồ sơ"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
