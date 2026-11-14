"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CurveDown } from "@/components/ui";

type Mode = "email" | "code" | "password";
const RESEND_S = 60;

/** Nút chính trên dải tối: viên thuốc SÁNG + núm hổ phách. */
function MainButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="raise tap inline-flex h-[58px] w-full items-center justify-between rounded-full pl-7 pr-2 text-lg font-medium text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
      <span className="knob flex h-11 w-11 items-center justify-center rounded-full">
        <ArrowUpRight size={18} />
      </span>
    </button>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Chỉ nhận đường dẫn trong hệ này — không để ?next= đẩy người dùng sang trang lạ.
  const raw = params.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  // Mặc định mã qua email: nhiều thầy cô chưa từng đặt mật khẩu cho tài khoản
  // web Khoa, đưa mật khẩu lên trước là đưa họ vào ngõ cụt ngay bước đầu.
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => {
    if (mode === "code") codeRef.current?.focus();
  }, [mode]);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: res.ok, data };
  }

  function enter() {
    // refresh() để layout chạy lại ở máy chủ và đọc được cookie vừa đặt.
    router.replace(next);
    router.refresh();
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch {
      setErr("Không kết nối được máy chủ");
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      const { ok, data } = await post("/ho-tro/api/auth/otp", { email });
      if (!ok) return setErr(data.message ?? "Không gửi được mã");
      setCode("");
      setMode("code");
      setWait(RESEND_S);
    });

  const verify = () =>
    run(async () => {
      const { ok, data } = await post("/ho-tro/api/auth/otp", { email, code });
      if (!ok) {
        setErr(data.message ?? "Mã không đúng");
        setCode("");
        return;
      }
      enter();
    });

  const withPassword = () =>
    run(async () => {
      const { ok, data } = await post("/ho-tro/api/auth/login", { email, password });
      if (!ok) return setErr(data.message ?? "Đăng nhập không thành công");
      enter();
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "email") void sendCode();
    else if (mode === "code") void verify();
    else void withPassword();
  }

  const go = (m: Mode) => {
    setMode(m);
    setErr(null);
    setCode("");
  };

  const emailField = (id: string) => (
    <input
      id={id}
      type="email"
      autoComplete="username"
      required
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="ten@hcmus.edu.vn"
      className="press-d w-full rounded-full border-0 px-5 py-4 text-[var(--on-dark)] outline-none placeholder:text-[var(--on-dark-muted)] focus-visible:ring-[3px] focus-visible:ring-[var(--amber)]"
    />
  );

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-wrap items-end justify-between gap-6 px-5 pt-6 sm:px-9 lg:pt-10">
        <h1 className="text-[clamp(44px,6.4vw,96px)] font-medium leading-[0.98] tracking-[-0.045em]">
          Báo sự cố.
          <br />
          Theo dõi tới khi xong.
        </h1>
        <p className="muted max-w-[22rem] pb-3 text-base font-light leading-relaxed">
          Dùng chung tài khoản với trang quản trị web Khoa — không cần nhớ thêm mật khẩu.
        </p>
      </section>
      <CurveDown />

      <section className="band flex flex-1 flex-wrap items-start gap-8 px-5 pb-12 sm:px-9">
        <ol className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 pt-2">
          {[
            <>
              Gửi phiếu, nhận mã như <span className="font-mono font-semibold text-[var(--amber)]">VL-0042</span>
            </>,
            "Thấy ngay ai nhận, đang ở bước nào",
            "Nhận email khi có trả lời",
          ].map((t, i) => (
            <li key={i} className="flex items-center gap-4 text-lg font-light">
              <span className="press-d flex h-12 w-12 flex-none items-center justify-center rounded-full font-mono text-sm font-semibold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>

        <form
          onSubmit={submit}
          className="raise-d relative z-[2] flex w-full max-w-[460px] lg:-mt-36 flex-[1_1_380px] flex-col gap-5 rounded-[36px] p-7 sm:p-8"
        >
          {mode === "password" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-[var(--on-dark-muted)]">Quản trị viên</span>
                <h2 className="text-2xl font-medium">Đăng nhập bằng mật khẩu</h2>
              </div>
              <label htmlFor="email2" className="sr-only">
                Email
              </label>
              {emailField("email2")}
              <label htmlFor="password" className="sr-only">
                Mật khẩu
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu"
                className="press-d w-full rounded-full border-0 px-5 py-4 text-[var(--on-dark)] outline-none placeholder:text-[var(--on-dark-muted)] focus-visible:ring-[3px] focus-visible:ring-[var(--amber)]"
              />
              {err ? <Err msg={err} /> : null}
              <MainButton disabled={busy}>{busy ? "Đang kiểm tra…" : "Đăng nhập"}</MainButton>
              <button type="button" onClick={() => go("email")} className="tap self-start text-sm text-[var(--on-dark-muted)] hover:text-[var(--on-dark)] hover:underline">
                ← Dùng mã qua email
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-[var(--on-dark-muted)]">Bước {mode === "email" ? 1 : 2} / 2</span>
                <h2 className="text-2xl font-medium">{mode === "email" ? "Nhập email cơ quan" : "Nhập mã trong email"}</h2>
                <p className="text-sm font-light text-[var(--on-dark-muted)]">
                  {mode === "email" ? (
                    "Hệ thống gửi một mã 6 số tới hộp thư của thầy/cô."
                  ) : (
                    <>
                      Đã gửi mã 6 số tới <span className="font-medium text-[var(--on-dark)]">{email}</span>. Dùng một lần, hết hạn sau 10 phút.
                    </>
                  )}
                </p>
              </div>

              {mode === "email" ? (
                <>
                  <label htmlFor="email" className="sr-only">
                    Email cơ quan
                  </label>
                  {emailField("email")}
                </>
              ) : (
                <fieldset>
                  <legend className="sr-only">Mã đăng nhập 6 số</legend>
                  {/* Ô nhập thật phủ lên 6 ô hiển thị: dán mã, tự điền mã từ
                      email/SMS và trình đọc màn hình vẫn chạy bình thường. */}
                  <div className="relative">
                    <div aria-hidden className="grid grid-cols-6 gap-2">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <span
                          key={i}
                          className={
                            "press-d flex h-16 items-center justify-center rounded-[20px] font-mono text-[28px] font-semibold " +
                            (i === code.length ? "ring-2 ring-[var(--amber)]" : "")
                          }
                        >
                          {code[i] ?? ""}
                        </span>
                      ))}
                    </div>
                    <input
                      ref={codeRef}
                      aria-label="Mã đăng nhập 6 số"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setCode(v);
                      }}
                      className="absolute inset-0 h-full w-full cursor-text opacity-0"
                    />
                  </div>
                </fieldset>
              )}

              {err ? <Err msg={err} /> : null}
              <MainButton disabled={busy || (mode === "code" && code.length !== 6)}>
                {busy ? "Đang xử lý…" : mode === "email" ? "Gửi mã" : "Đăng nhập"}
              </MainButton>

              {mode === "code" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <button
                    type="button"
                    disabled={wait > 0 || busy}
                    onClick={() => void sendCode()}
                    className="tap text-[var(--on-dark-muted)] enabled:hover:text-[var(--on-dark)] enabled:hover:underline"
                  >
                    {wait > 0 ? (
                      <>
                        Gửi lại mã sau{" "}
                        <span className="font-mono text-[var(--on-dark)]">
                          00:{String(wait).padStart(2, "0")}
                        </span>
                      </>
                    ) : (
                      "Gửi lại mã"
                    )}
                  </button>
                  <button type="button" onClick={() => go("email")} className="tap text-[var(--amber)] hover:underline">
                    Đổi email
                  </button>
                </div>
              ) : null}

              <div className="press-d flex flex-wrap items-center justify-between gap-2 rounded-full px-5 py-3 text-sm">
                <span className="text-[var(--on-dark-muted)]">Quản trị viên?</span>
                <button type="button" onClick={() => go("password")} className="tap font-medium text-[var(--on-dark)] hover:underline">
                  Đăng nhập bằng mật khẩu ↗
                </button>
              </div>
            </>
          )}
        </form>
      </section>
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <p role="alert" className="rounded-2xl bg-[#f3dcd6] px-4 py-2.5 text-sm text-[#8a2e1e]">
      {msg}
    </p>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
