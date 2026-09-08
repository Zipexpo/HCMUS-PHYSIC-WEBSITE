"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// useLayoutEffect chạy TRƯỚC khi vẽ → áp scale ngay lúc hydrate, đỡ giật một nhịp
// từ bố cục co giãn sang bố cục khoá. Trên máy chủ không có nên lùi về useEffect.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Khoá layout ở một bề rộng thiết kế cố định rồi PHÓNG/THU cả khối cho vừa màn —
 * nên trang trông GIỐNG HỆT ở mọi cỡ desktop (chỉ to/nhỏ), không dồn cột lại khi
 * kéo cửa sổ. Dưới `MIN_VW` (điện thoại/máy tính bảng hẹp) thì trả về layout co
 * giãn bình thường, không đụng tới.
 *
 * Vì sao ngưỡng 1024: khối trang nhân sự (StaffProfileEditorial) chỉ đổi bố cục ở
 * mốc `lg` (1024) trở xuống; từ 1024 lên là ổn định. Ép nội dung vào hộp 1280 khi
 * viewport ≥ 1024 nên media query luôn ở trạng thái `lg` → đúng bố cục desktop,
 * rồi transform co cho vừa. Không đổi kích thước thật của ảnh/chữ trong DOM nên
 * không vỡ chữ; chỉ là một phép biến hình hiển thị.
 */
const DESIGN = 1280;
const MIN_VW = 1024;
const MAX_SCALE = 1.6;

export function FixedScale({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; height: number } | null>(null);

  useIsoLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const apply = () => {
      const vw = window.innerWidth;
      if (vw < MIN_VW) {
        setBox(null);
        return;
      }
      const scale = Math.min(MAX_SCALE, vw / DESIGN);
      setBox({ scale, height: el.offsetHeight * scale });
    };
    apply();
    window.addEventListener("resize", apply);
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", apply);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      style={
        box
          ? {
              height: box.height,
              overflow: "hidden",
              display: "flex",
              justifyContent: "center",
            }
          : undefined
      }
    >
      <div
        ref={inner}
        style={
          box
            ? {
                width: DESIGN,
                flex: "0 0 auto",
                transform: `scale(${box.scale})`,
                transformOrigin: "top center",
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
