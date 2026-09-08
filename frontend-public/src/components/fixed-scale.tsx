"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// useLayoutEffect chạy TRƯỚC khi vẽ → áp scale ngay lúc hydrate, đỡ giật một nhịp.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Khoá layout ở bề rộng thiết kế 1280 rồi PHÓNG/THU cho vừa màn → trang giống hệt
 * ở mọi cỡ desktop, không dồn cột. Dưới MIN_VW (điện thoại/tablet hẹp) trả về
 * layout co giãn bình thường.
 *
 * Dùng `zoom` chứ KHÔNG dùng `transform: scale`: transform tạo stacking context
 * mới, phá `mix-blend-mode: difference` mà trang nhân sự dùng cho chữ (chữ hết
 * đọc được trên nền đỏ). `zoom` co giãn cả bố cục nên hộp tự cao đúng, không cần
 * tính chiều cao tay, và không phá blend.
 */
const DESIGN = 1280;
const MIN_VW = 1024;
const MAX_ZOOM = 1.6;

export function FixedScale({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useState<number | null>(null);

  useIsoLayoutEffect(() => {
    const apply = () => {
      // Ngưỡng "có phải desktop không" xét theo innerWidth (khớp với breakpoint
      // lg=1024 của Tailwind, tính cả thanh cuộn). Còn TỈ LỆ thu/phóng thì chia
      // theo clientWidth (KHÔNG tính thanh cuộn dọc ~15px) để không dư ra thanh
      // cuộn ngang. Nếu lấy clientWidth cho cả ngưỡng thì cửa sổ 1024 sẽ tụt
      // xuống 1009 < 1024 → rơi về layout co giãn (tên bị xuống 2 hàng).
      if (window.innerWidth < MIN_VW) {
        setZoom(null);
        return;
      }
      const avail = document.documentElement.clientWidth || window.innerWidth;
      setZoom(Math.min(MAX_ZOOM, avail / DESIGN));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const style: CSSProperties | undefined = zoom
    ? ({ width: DESIGN, marginInline: "auto", zoom } as CSSProperties)
    : undefined;

  return <div style={style}>{children}</div>;
}
