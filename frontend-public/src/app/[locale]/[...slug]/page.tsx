import { PuckRenderer } from "@admin/views/admin/widgets-layout/puck-renderer";
import type { Metadata } from "next";
import { FixedScale } from "@/components/fixed-scale";
import { notFound } from "next/navigation";
import { breadcrumbListSchema, JsonLd } from "@/components/JsonLd";
import { VisitorTracker } from "@/components/visitor-tracker";
import {
  getLayoutBySlug,
  getStaticPageBySlug,
  resolveMediaUrl,
} from "@/lib/api";
import {
  buildCanonical,
  buildLanguageAlternates,
  buildOgImage,
  FACULTY_EN,
  FACULTY_VI,
  getBaseUrl,
  UNIVERSITY_EN,
  UNIVERSITY_VI,
} from "@/lib/seo";

export const revalidate = 3600;

type PageProps = {
  params: Promise<{ slug: string[]; locale?: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;
  const slugPath = slug.join("/");
  const isEn = locale === "en";
  try {
    const layout = await getLayoutBySlug(slugPath);
    if (!layout.isPublished) return {};
    // Tên trang lưu một chuỗi (tiếng Việt); phần đuôi/mô tả đổi theo ngôn ngữ đang xem.
    const titleText = isEn
      ? `${layout.name} | ${FACULTY_EN}`
      : `${layout.name} | ${FACULTY_VI}`;
    const description =
      layout.description ??
      (isEn
        ? `${layout.name} - ${FACULTY_EN}, ${UNIVERSITY_EN}`
        : `${layout.name} - ${FACULTY_VI}, ${UNIVERSITY_VI}`);
    const canonical = buildCanonical(`/${slugPath}`);
    // FB/Twitter thumbnail: prefer the post's own cover image (nếu trang này
    // gắn với một bài viết có ảnh bìa) để share ra đúng ảnh + tên bài, thay vì
    // tấm card chung "Khoa Vật lý". Fallback về card tạo động khi không có cover.
    const coverUrl = layout.sourcePost?.coverUrl
      ? resolveMediaUrl(layout.sourcePost.coverUrl)
      : "";
    const ogImages = coverUrl
      ? [{ url: coverUrl, alt: layout.sourcePost?.coverAlt || titleText }]
      : [
          {
            url: buildOgImage({
              slug: slugPath,
              title: layout.name,
              subtitle: description,
            }),
            width: 1200,
            height: 630,
            alt: titleText,
          },
        ];
    return {
      title: { absolute: titleText },
      description,
      alternates: {
        canonical,
        languages: buildLanguageAlternates(`/${slugPath}`),
      },
      openGraph: {
        title: titleText,
        description,
        type: "article",
        url: canonical,
        locale: isEn ? "en_US" : "vi_VN",
        images: ogImages,
      },
      twitter: {
        card: "summary_large_image",
        title: titleText,
        description,
        images: ogImages.map((i) => i.url),
      },
      robots: { index: true, follow: true },
    };
  } catch {
    // No layout → maybe a standalone StaticPage lives at this slug.
    try {
      const page = await getStaticPageBySlug(slugPath);
      return {
        title: { absolute: page.title },
        alternates: { canonical: buildCanonical(`/${slugPath}`) },
        robots: { index: true, follow: true },
      };
    } catch {
      return {};
    }
  }
}

export default async function PublicLayoutPage({ params }: PageProps) {
  const { slug } = await params;
  const slugPath = slug.join("/");
  try {
    const layout = await getLayoutBySlug(slugPath);
    if (!layout.isPublished) notFound();
    const base = getBaseUrl().replace(/\/$/, "");
    const crumbs = [
      { name: "Trang chủ", url: `${base}/` },
      { name: layout.name, url: `${base}/${slugPath}` },
    ];
    const puck = layout.publishedPuckData ?? layout.puckData;
    // Trang nhân sự = layout có khối StaffProfileEditorial. Khoá layout cố định +
    // scale cho desktop (mục 2 yêu cầu), các trang khác giữ nguyên co giãn.
    const laTrangNhanSu = JSON.stringify(puck ?? "").includes(
      "StaffProfileEditorial",
    );
    return (
      <>
        <JsonLd schema={breadcrumbListSchema(crumbs)} />
        <VisitorTracker slug={slugPath} />
        {laTrangNhanSu ? (
          <FixedScale>
            <PuckRenderer puckData={puck} />
          </FixedScale>
        ) : (
          <PuckRenderer puckData={puck} />
        )}
      </>
    );
  } catch {
    // No published layout at this slug → fall back to a standalone StaticPage
    // (event microsite like /iceba2023). 'iframe' isolates a full HTML document;
    // 'embed' injects a fragment inside the site shell.
    try {
      const page = await getStaticPageBySlug(slugPath);
      // Folder microsite uploaded as a .zip → iframe the served entry so its
      // relative assets (css/js/images) resolve against the extracted folder.
      if (page.bundlePath) {
        return (
          <>
            <VisitorTracker slug={slugPath} />
            <iframe
              src={resolveMediaUrl(page.bundlePath)}
              title={page.title}
              style={{
                width: "100%",
                height: "100vh",
                border: "0",
                display: "block",
              }}
            />
          </>
        );
      }
      if (page.renderMode === "embed") {
        return (
          <>
            <VisitorTracker slug={slugPath} />
            <div dangerouslySetInnerHTML={{ __html: page.html }} />
          </>
        );
      }
      return (
        <>
          <VisitorTracker slug={slugPath} />
          <iframe
            srcDoc={page.html}
            title={page.title}
            style={{
              width: "100%",
              height: "100vh",
              border: "0",
              display: "block",
            }}
          />
        </>
      );
    } catch {
      notFound();
    }
  }
}
