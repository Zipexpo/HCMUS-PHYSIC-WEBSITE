"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock as LockIcon, Save as SaveIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "react-toastify";
import { UserIcon } from "@/components/admin/icons";
import { authApi, mediaApi, resolveMediaUrl } from "@/lib/api";
import { isFacultyWide } from "@/lib/department";
import { MediaPickerModal } from "@/views/admin/widgets-layout/fields/media-picker-modal";
import { HeroBackgroundsManager } from "./hero-backgrounds-manager";

type ProfileState = {
  firstName: string;
  lastName: string;
  position: string;
  departmentName: string;
  phone: string;
  avatarUrl: string | null;
};

type PasswordState = {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
};

const INITIAL_PASSWORD: PasswordState = {
  currentPassword: "",
  newPassword: "",
  confirmNewPassword: "",
};

export function SettingsView() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["AUTH", "PROFILE"],
    queryFn: authApi.getProfile,
  });

  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [password, setPassword] = useState<PasswordState>(INITIAL_PASSWORD);

  useEffect(() => {
    const u = profileQuery.data;
    if (!u) return;
    setProfile({
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      position: u.position ?? "",
      departmentName: u.department?.name ?? "",
      phone: u.phone ?? "",
      avatarUrl: u.avatarUrl,
    });
  }, [profileQuery.data]);

  const updateProfile = useMutation({
    mutationKey: ["AUTH", "UPDATE_PROFILE"],
    mutationFn: authApi.updateProfile,
    onSuccess: () => {
      toast.success("Đã lưu hồ sơ");
      queryClient.invalidateQueries({ queryKey: ["AUTH", "PROFILE"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không lưu được hồ sơ");
    },
  });

  const changePassword = useMutation({
    mutationKey: ["AUTH", "CHANGE_PASSWORD"],
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      toast.success("Đã đổi mật khẩu");
      setPassword(INITIAL_PASSWORD);
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không đổi được mật khẩu");
    },
  });

  if (!profile) {
    return (
      <div className="min-h-full bg-slate-50 dark:bg-[#0B1120] px-6 py-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">Đang tải…</p>
      </div>
    );
  }

  const setField = <K extends keyof ProfileState>(
    key: K,
    value: ProfileState[K],
  ) => setProfile((p) => (p ? { ...p, [key]: value } : p));

  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Chỉ chấp nhận file ảnh");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File vượt quá 10MB");
      return;
    }
    setUploadingAvatar(true);
    try {
      const media = await mediaApi.upload(file);
      setField("avatarUrl", media.url);
      toast.success("Đã tải ảnh lên");
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Upload thất bại";
      toast.error(msg);
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.firstName.trim() || !profile.lastName.trim()) {
      toast.error("Tên không được để trống");
      return;
    }
    updateProfile.mutate({
      firstName: profile.firstName.trim(),
      lastName: profile.lastName.trim(),
      position: profile.position.trim() || null,
      departmentName: profile.departmentName.trim() || null,
      phone: profile.phone.trim() || null,
      avatarUrl: profile.avatarUrl,
    });
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.newPassword.length < 6) {
      toast.error("Mật khẩu mới tối thiểu 6 ký tự");
      return;
    }
    if (password.newPassword !== password.confirmNewPassword) {
      toast.error("Mật khẩu mới không khớp");
      return;
    }
    changePassword.mutate(password);
  };

  return (
    <div className="min-h-full bg-slate-50 dark:bg-[#0B1120]">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Settings
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Quản lý hồ sơ, bảo mật và tuỳ chọn của bạn.
          </p>
        </header>

        <form
          onSubmit={submitProfile}
          className="bg-white dark:bg-[#101622] border border-slate-200 dark:border-slate-800 rounded-xl p-6"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 mb-5">
            <UserIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            General Profile
          </div>

          <div className="flex items-center gap-4 mb-6">
            <Avatar url={profile.avatarUrl} />
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-700 hover:bg-slate-800 text-white disabled:opacity-50 dark:bg-slate-600 dark:hover:bg-slate-500"
                >
                  {uploadingAvatar ? "Đang tải…" : "Change Avatar"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMediaPicker(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#202c44]"
                >
                  Chọn từ thư viện
                </button>
                {profile.avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setField("avatarUrl", null)}
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline self-center"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAvatarFile(file);
                }}
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                JPG, PNG, WebP, GIF. Tối đa 10MB.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="First Name"
              value={profile.firstName}
              onChange={(v) => setField("firstName", v)}
            />
            <Field
              label="Last Name"
              value={profile.lastName}
              onChange={(v) => setField("lastName", v)}
            />
            <Field
              label="Academic Title"
              placeholder="PhD, Lecturer, Department Head…"
              value={profile.position}
              onChange={(v) => setField("position", v)}
            />
            <Field
              label="Phone Number"
              type="tel"
              value={profile.phone}
              onChange={(v) => setField("phone", v)}
            />
            <Field
              label="Department"
              placeholder="VD: Vật lý Tin học"
              value={profile.departmentName}
              onChange={(v) => setField("departmentName", v)}
              className="sm:col-span-2"
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={updateProfile.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              <SaveIcon className="w-4 h-4" />
              {updateProfile.isPending ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </form>

        <form
          onSubmit={submitPassword}
          data-tour="settings-password"
          className="bg-white dark:bg-[#101622] border border-slate-200 dark:border-slate-800 rounded-xl p-6"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 mb-5">
            <LockIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Security
          </div>

          <Field
            label="Current Password"
            type="password"
            value={password.currentPassword}
            onChange={(v) => setPassword((s) => ({ ...s, currentPassword: v }))}
          />

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="New Password"
              type="password"
              value={password.newPassword}
              onChange={(v) => setPassword((s) => ({ ...s, newPassword: v }))}
            />
            <Field
              label="Confirm New Password"
              type="password"
              value={password.confirmNewPassword}
              onChange={(v) =>
                setPassword((s) => ({ ...s, confirmNewPassword: v }))
              }
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={changePassword.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              <SaveIcon className="w-4 h-4" />
              {changePassword.isPending ? "Đang lưu…" : "Đổi mật khẩu"}
            </button>
          </div>
        </form>

        {isFacultyWide(
          profileQuery.data?.role,
          profileQuery.data?.departmentId,
        ) && <HeroBackgroundsManager />}
      </div>

      {showMediaPicker && (
        <MediaPickerModal
          onClose={() => setShowMediaPicker(false)}
          onSelect={(url) => {
            setField("avatarUrl", url);
            setShowMediaPicker(false);
          }}
        />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a2436] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-500/30"
      />
    </div>
  );
}

function Avatar({ url }: { url: string | null }) {
  if (url) {
    return (
      <div className="relative w-20 h-20 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700">
        <Image
          src={resolveMediaUrl(url)}
          alt=""
          fill
          sizes="80px"
          unoptimized
          className="object-cover"
        />
      </div>
    );
  }
  return (
    <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs text-slate-500 dark:text-slate-300">
      No avatar
    </div>
  );
}
