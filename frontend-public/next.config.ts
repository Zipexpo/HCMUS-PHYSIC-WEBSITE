import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    resolveAlias: {
      "@admin": path.resolve(__dirname, "../frontend/src"),
    },
  },
  images: {
    formats: ["image/webp"],
    // Perf: the sandbox is a weak 4GB CPU box, so every extra srcset variant is an
    // extra (slow) on-demand optimization. Trim Next's default 8+8 sizes down to the
    // breakpoints our components actually emit (verified by scanning rendered pages),
    // and cache optimized images for a year so a given size is only ever generated
    // once. Combined with pre-warming this makes repeat loads ~13ms instead of ~1s cold.
    // NOTE: 1080 is the single most-used width (post covers + legacy body images via
    // next/image `sizes`); dropping it 400s ~130 images/page — keep it in the list.
    deviceSizes: [640, 828, 1080, 1200, 1920],
    imageSizes: [96, 256, 384],
    minimumCacheTTL: 31536000,
    // Next 16 defaults to qualities:[75] and returns 400 for any other q —
    // legacy body images request q=70 and hero slides q=65.
    qualities: [65, 70, 75],
    // Next 16 also refuses to optimize images fetched from loopback/private IPs.
    // Lift that guard only where the optimizer legitimately fetches a private
    // origin: local builds (API on localhost) and compose deployments that bake an
    // in-network fetch origin. remotePatterns still restricts the reachable hosts.
    dangerouslyAllowLocalIP:
      Boolean(process.env.NEXT_PUBLIC_IMAGE_FETCH_ORIGIN) ||
      (process.env.NEXT_PUBLIC_API_URL ?? "").includes("localhost"),
    remotePatterns: [
      {
        protocol: "http",
        hostname: "103.88.122.23",
        port: "3001",
        pathname: "/uploads/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3001",
        pathname: "/uploads/**",
      },
      // In-compose hostname the optimizer fetches media through on the sandbox
      // (containers cannot hairpin to the host's public IP). Never used by browsers.
      {
        protocol: "http",
        hostname: "backend",
        port: "3001",
        pathname: "/uploads/**",
      },
      {
        protocol: "https",
        hostname: "phys.hcmus.edu.vn",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "hcmus.edu.vn",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.hcmus.edu.vn",
        pathname: "/**",
      },
    ],
    unoptimized: process.env.NEXT_PUBLIC_IMAGES_UNOPTIMIZED === "true",
  },
};

export default nextConfig;
