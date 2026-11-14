"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { DynamicIcon } from "@/components/admin/icons";
import {
  authApi,
  type ContentStatusValue,
  categoryApi,
  type LocalizedText,
  pageLayoutApi,
  postApi,
  resolveMediaUrl,
  tagApi,
  type UpsertPostBody,
} from "@/lib/api";
import { untranslatedLocales } from "@/lib/i18n";
import { emptyLocalized, type Locale, toLocalized } from "@/lib/localized";
import { toSlug } from "@/lib/utils";
import { MediaPickerModal } from "@/views/admin/widgets-layout/fields/media-picker-modal";
import { MarkdownEditor } from "./markdown-editor";

const STATUS_LABELS: Record<ContentStatusValue, string> = {
  DRAFT: "Nháp",
  PENDING: "Chờ xuất bản",
  SCHEDULED: "Lên lịch",
  PUBLISHED: "Công khai",
};

const localizeCategory = (name: { vi?: string; en?: string } | string) =>
  typeof name === "string" ? name : (name.vi ?? name.en ?? "");

// Bài mới luôn gắn sẵn 2 tag SDG này. Bám theo SLUG chứ không phải tên hiển thị,
// nên đổi tên tag trong quản trị vẫn gắn đúng tag (và đúng ảnh icon của nó).
const DEFAULT_TAG_SLUGS = ["sdg4", "sdg17"];

// Nhớ mẫu dùng lần gần nhất (theo loại bài) ngay trên trình duyệt của người
// dùng. Rẻ hơn hẳn việc dựng bảng "yêu thích" riêng trong CSDL mà hiệu quả
// tương đương: người đăng bài đều đặn thường chỉ dùng một mẫu quen.
const LAST_TEMPLATE_KEY = (kind: "news" | "event") =>
  `hcmus:last-post-template:${kind}`;

const readLastTemplate = (kind: "news" | "event"): string => {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_TEMPLATE_KEY(kind)) ?? "";
  } catch {
    return "";
  }
};

const rememberTemplate = (kind: "news" | "event", id: string): void => {
  if (typeof window === "undefined" || !id) return;
  try {
    window.localStorage.setItem(LAST_TEMPLATE_KEY(kind), id);
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư) — bỏ qua, không ảnh hưởng.
  }
};

// Mẫu DỰ PHÒNG cho mỗi loại bài — dùng khi chưa có layout mẫu nào được đánh dấu
// (hoặc danh sách chưa tải xong), để không ai bị kẹt không tạo được bài.
//
// LƯU Ý HAI KHÁI NIỆM KHÁC NHAU, đừng gộp:
//   - LAYOUT MẪU  = bố cục trình bày của trang public.
//   - DANH MỤC    = bài hiện ở mục nào trên site.
// Chúng trùng tên nhau (đều có "Học bổng", "Tuyển dụng"…) nên rất dễ nhầm là một.
const KIND_TEMPLATE: Record<"news" | "event", string> = {
  news: "cat_tmpl_scientific-information",
  event: "cat_tmpl_event",
};

const parseTagInput = (value: string): string[] => {
  const tokens = value
    .split(/[,\n]/)
    .map((t) => toSlug(t))
    .filter(Boolean);
  return Array.from(new Set(tokens));
};

const addUnique = (list: string[], slug: string) =>
  list.includes(slug) ? list : [...list, slug];

// A tag icon is either an image URL (/uploads or http) or a Material Symbol name.
function TagIcon({ icon }: { icon?: string | null }) {
  if (!icon) return null;
  if (/^(https?:|\/uploads)/.test(icon)) {
    // biome-ignore lint/performance/noImgElement: external tag icon, not a Next asset
    return (
      <img
        src={resolveMediaUrl(icon)}
        alt=""
        className="w-3.5 h-3.5 object-contain rounded-sm"
      />
    );
  }
  return <DynamicIcon name={icon} className="w-3.5 h-3.5" />;
}

const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function PostComposerView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const idParam = searchParams.get("id");

  const [postId, setPostId] = useState<string | null>(idParam);
  const [lang, setLang] = useState<Locale>("vi");
  const [title, setTitle] = useState<LocalizedText>(emptyLocalized());
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [excerpt, setExcerpt] = useState<LocalizedText>(emptyLocalized());
  const [body, setBody] = useState<LocalizedText>(emptyLocalized());
  const [status, setStatus] = useState<ContentStatusValue>("DRAFT");
  const [tagSlugs, setTagSlugs] = useState<string[]>(DEFAULT_TAG_SLUGS);
  const [tagDraft, setTagDraft] = useState("");
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [coverAlt, setCoverAlt] = useState("");
  const [eventStartAt, setEventStartAt] = useState("");
  const [eventEndAt, setEventEndAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  // Ngày đăng tuỳ chỉnh (lùi về quá khứ) — chỉ Super Admin.
  const [publishedAt, setPublishedAt] = useState("");
  // Loại bài chốt ngay ở modal trước khi vào soạn — từ đó suy ra layout mẫu.
  const [kind, setKind] = useState<"news" | "event" | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  // Ba bước tạo bài: (1) chọn danh mục → (2) chọn bố cục → (3) điền nội dung.
  // Bước 2 TỰ BỎ QUA khi chỉ có một bố cục — bắt bấm khi không có gì để chọn
  // chỉ làm phiền.
  const [pickStep, setPickStep] = useState<"category" | "layout">("category");
  // Dữ liệu cho holder của layout. Chỉ hỏi khi bố cục đã chọn CÓ holder đó.
  const [gallery, setGallery] = useState<{ src: string; alt: string }[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
  // Lý do Khoa trả bài về — chỉ có khi bài vừa bị trả.
  const [reviewNote, setReviewNote] = useState<string | null>(null);

  // Layout mẫu quyết định BỐ CỤC của trang public sinh ra cho bài. Trước đây bị
  // ép cứng một mẫu cho mỗi loại bài, nên khoa có dựng thêm mẫu khác cũng không
  // chọn được. Danh sách do backend lọc sẵn theo quyền/bộ môn.
  const [templateId, setTemplateId] = useState<string>("");
  const templatesQuery = useQuery({
    queryKey: ["POST_TEMPLATES"],
    queryFn: () => pageLayoutApi.postTemplates(),
  });
  // Bài sự kiện chỉ hợp với mẫu thuộc danh mục "event"; tin tức lấy phần còn lại.
  const kindTemplates = (templatesQuery.data ?? []).filter((tpl) =>
    kind === "event"
      ? tpl.category?.slug === "event"
      : tpl.category?.slug !== "event",
  );

  const categoriesQuery = useQuery({
    queryKey: ["CATEGORIES"],
    queryFn: categoryApi.list,
  });
  const { data: profile } = useQuery({
    queryKey: ["PROFILE"],
    queryFn: authApi.getProfile,
  });
  const isSuperAdmin = profile?.role === "SUPER_ADMIN";
  // Tài khoản của đơn vị bật kiểm duyệt thì "đăng" = GỬI DUYỆT. Cờ này backend
  // tính sẵn bằng ĐÚNG luật nó dùng để chặn, nên giao diện không thể lệch.
  const mustReview = profile?.mustSubmitForReview ?? false;
  // Danh mục CHỌN ĐƯỢC: bỏ "Sự kiện" ra khỏi danh sách tick vì với bài sự kiện
  // nó luôn được gắn ngầm, còn bài tin tức thì không thuộc về nó.
  const pickableCategories = (categoriesQuery.data ?? []).filter(
    (c) => c.slug !== "event",
  );
  const eventCategoryId = (categoriesQuery.data ?? []).find(
    (c) => c.slug === "event",
  )?.id;

  /**
   * Danh mục gửi lên backend. Backend THAY THẾ hoàn toàn danh mục của layout mẫu
   * bằng danh sách này, nên bài sự kiện phải tự kèm "Sự kiện" — thiếu là bài rơi
   * khỏi bộ lọc Sự kiện. Đặt nó ĐẦU danh sách để breadcrumb vẫn là Sự kiện.
   */
  const finalCategoryIds = (): string[] =>
    kind === "event" && eventCategoryId
      ? [eventCategoryId, ...categoryIds.filter((id) => id !== eventCategoryId)]
      : categoryIds;

  // Existing tags (with icons) so the author can pick instead of typing slugs.
  const tagsQuery = useQuery({ queryKey: ["TAGS"], queryFn: tagApi.list });
  const allTags = tagsQuery.data ?? [];
  const tagBySlug = (s: string) => allTags.find((tg) => tg.slug === s);
  const toggleTag = (slug: string) =>
    setTagSlugs((prev) =>
      prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug],
    );
  // Tag picker dropdown: 2 tabs (image-icon tags vs text tags) + search.
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagPickerTab, setTagPickerTab] = useState<"image" | "text">("image");
  const [tagPickerSearch, setTagPickerSearch] = useState("");
  const isImgIcon = (icon?: string | null): boolean =>
    !!icon && /^(https?:|\/uploads)/.test(icon);
  const pickerTags = allTags.filter((tg) => {
    const inTab =
      tagPickerTab === "image" ? isImgIcon(tg.icon) : !isImgIcon(tg.icon);
    if (!inTab) return false;
    const q = tagPickerSearch.trim().toLowerCase();
    return (
      !q ||
      tg.name.toLowerCase().includes(q) ||
      tg.slug.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    setPostId(idParam);
  }, [idParam]);

  // "Tạo bài đăng mới" trỏ về CÙNG route với trình soạn bài (/admin/posts), nên
  // đi từ trang sửa bài sang tạo mới KHÔNG dựng lại component — trước đây chỉ
  // `postId` được xoá, còn tiêu đề/nội dung/tags/danh mục/ảnh bìa của bài cũ vẫn
  // nằm nguyên trong form, và khối "Layouts đã gắn" vẫn hiện layout của bài cũ.
  // Rất dễ vô tình đăng đè nội dung bài khác.
  useEffect(() => {
    if (postId) return;
    setTitle(emptyLocalized());
    setSlug("");
    setSlugTouched(false);
    setExcerpt(emptyLocalized());
    setBody(emptyLocalized());
    setStatus("DRAFT");
    setTagSlugs(DEFAULT_TAG_SLUGS);
    setTagDraft("");
    setCoverMediaId(null);
    setCoverUrl("");
    setCoverAlt("");
    setEventStartAt("");
    setEventEndAt("");
    setEventLocation("");
    setScheduledAt("");
    setPublishedAt("");
    setCategoryIds([]);
    setKind(null);
    setTemplateId("");
    setPickStep("category");
    setGallery([]);
    setVideoUrl("");
    setReviewNote(null);
  }, [postId]);

  // Mặc định về đúng mẫu cũ đang dùng cho loại bài đó; không có thì lấy mẫu đầu.
  useEffect(() => {
    if (!kind || !kindTemplates.length) return;
    const stillValid = kindTemplates.some((tpl) => tpl.id === templateId);
    if (stillValid) return;
    const has = (id: string) => !!id && kindTemplates.some((t) => t.id === id);
    const remembered = readLastTemplate(kind);
    setTemplateId(
      has(remembered)
        ? remembered
        : has(KIND_TEMPLATE[kind])
          ? KIND_TEMPLATE[kind]
          : kindTemplates[0].id,
    );
  }, [kind, kindTemplates, templateId]);

  const postQuery = useQuery({
    queryKey: ["POSTS", postId],
    queryFn: () => postApi.getById(postId!),
    enabled: !!postId,
  });

  useEffect(() => {
    const data = postQuery.data;
    if (!data) return;
    setTitle(toLocalized(data.title));
    setSlug(data.slug);
    setSlugTouched(true);
    setExcerpt(toLocalized(data.excerpt));
    setBody(toLocalized(data.body));
    setStatus(data.status);
    setTagSlugs(data.tags.map((t) => t.slug));
    setCoverMediaId(data.coverMediaId);
    setCoverUrl(data.coverUrl ?? "");
    setCoverAlt(data.coverAlt ?? "");
    setEventStartAt(toLocalInput(data.eventStartAt));
    setEventEndAt(toLocalInput(data.eventEndAt));
    setEventLocation(data.eventLocation ?? "");
    setScheduledAt(toLocalInput(data.scheduledAt));
    setPublishedAt(toLocalInput(data.publishedAt));
    setReviewNote(data.reviewNote ?? null);
    setGallery(data.gallery ?? []);
    setVideoUrl(data.videoUrl ?? "");
    setKind(data.eventStartAt ? "event" : "news");
    // Điền sẵn danh mục của trang đang gắn, để mở bài cũ ra sửa không phải chọn
    // lại từ đầu (bấm vào một danh mục vẫn là bỏ nó khỏi bài như bình thường).
    const linked = data.layouts?.[0]?.categoryLinks;
    if (linked?.length) setCategoryIds(linked.map((l) => l.categoryId));
  }, [postQuery.data]);

  // Cảnh báo THIẾU BẢN TIẾNG ANH. Trước đây cảnh báo này chỉ có ở trình sửa
  // layout, còn trình soạn bài thì không — người viết gõ xong tiếng Việt là bấm
  // xuất bản, trang /en lặng lẽ hiển thị nguyên văn tiếng Việt.
  // Chỉ báo khi ô đó ĐÃ có tiếng Việt (chưa nhập gì thì không có gì để dịch).
  const missingEnFields = [
    { label: "Tiêu đề", missing: untranslatedLocales(title).includes("en") },
    { label: "Tóm tắt", missing: untranslatedLocales(excerpt).includes("en") },
    {
      label: "Nội dung",
      missing: untranslatedLocales(body, true).includes("en"),
    },
  ]
    .filter((f) => f.missing)
    .map((f) => f.label);

  const commitTagDraft = () => {
    const parsed = parseTagInput(tagDraft);
    if (!parsed.length) return;
    setTagSlugs((prev) => parsed.reduce(addUnique, prev));
    setTagDraft("");
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTagDraft();
      return;
    }
    if (event.key === "Backspace" && !tagDraft && tagSlugs.length) {
      event.preventDefault();
      setTagSlugs((prev) => prev.slice(0, -1));
    }
  };

  const removeTag = (slugToRemove: string) =>
    setTagSlugs((prev) => prev.filter((t) => t !== slugToRemove));

  const handleTitleChange = (value: string) => {
    setTitle((prev) => ({ ...prev, [lang]: value }));
    if (!slugTouched && lang === "vi") setSlug(toSlug(value));
  };

  const isLocalizedEmpty = (l: LocalizedText) => !l.vi && !l.en;

  // nextStatus: trạng thái do NÚT lưu quyết định. Không truyền thì giữ nguyên
  // trạng thái hiện tại (dùng cho "xuất bản ngay" — backend sẽ tự kéo bài sang
  // PUBLISHED khi layout được publish).
  const buildPayload = (nextStatus?: ContentStatusValue): UpsertPostBody => {
    const pendingDraft = parseTagInput(tagDraft);
    const finalTagSlugs = pendingDraft.reduce(addUnique, tagSlugs);
    const trimmed: LocalizedText = {
      vi: (title.vi ?? "").trim(),
      en: (title.en ?? "").trim() || undefined,
    };
    const effectiveStatus = nextStatus ?? status;
    return {
      title: trimmed,
      slug: toSlug(slug || trimmed.vi),
      body: isLocalizedEmpty(body) ? null : body,
      excerpt: isLocalizedEmpty(excerpt) ? null : excerpt,
      status: effectiveStatus,
      scheduledAt:
        effectiveStatus === "SCHEDULED" && scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null,
      // Lùi ngày đăng: chỉ gửi khi là Super Admin và có nhập (backend cũng chặn).
      publishedAt:
        isSuperAdmin && publishedAt
          ? new Date(publishedAt).toISOString()
          : undefined,
      coverMediaId: coverMediaId ?? null,
      coverUrl: coverUrl || null,
      coverAlt: coverAlt || null,
      tagSlugs: finalTagSlugs,
      eventStartAt: eventStartAt ? new Date(eventStartAt).toISOString() : null,
      eventEndAt: eventEndAt ? new Date(eventEndAt).toISOString() : null,
      eventLocation: eventLocation || null,
      gallery,
      videoUrl: videoUrl || null,
    };
  };

  const saveMutation = useMutation({
    mutationKey: ["POSTS", postId ?? "NEW", "SAVE"],
    mutationFn: async (payload: UpsertPostBody) =>
      postId ? postApi.update(postId, payload) : postApi.create(payload),
    onSuccess: (data) => {
      toast.success(postId ? "Đã cập nhật bài đăng" : "Đã lưu draft");
      queryClient.invalidateQueries({ queryKey: ["POSTS"] });
      queryClient.invalidateQueries({ queryKey: ["PAGE_LAYOUTS"] });
      // The backend re-injects the new content into every attached layout, so the
      // single-layout editor cache must be refreshed too (else it looks unsynced).
      queryClient.invalidateQueries({ queryKey: ["PAGE_LAYOUT"] });
      if (!postId) {
        setPostId(data.id);
        router.replace(`/admin/posts?id=${data.id}`);
      }
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không thể lưu bài đăng");
    },
  });

  const cloneMutation = useMutation({
    mutationKey: ["POSTS", postId ?? "NEW", "CLONE_INTO_LAYOUT"],
    mutationFn: async (body: {
      postId: string;
      templateLayoutId: string;
      categoryIds?: string[];
    }) => {
      const { postId: id, ...rest } = body;
      return [await postApi.cloneIntoLayout(id, rest)];
    },
    onSuccess: () => {
      // KHÔNG đá người dùng sang trình sửa layout nữa: giờ họ xuất bản ngay được
      // từ đây, nhảy trang giữa chừng chỉ làm mất mạch soạn bài.
      queryClient.invalidateQueries({ queryKey: ["POSTS"] });
      queryClient.invalidateQueries({ queryKey: ["PAGE_LAYOUTS"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không thể tạo layout");
    },
  });

  // Ba hành động lưu, thay cho việc phải sang trình sửa layout mới publish được.
  // Trạng thái bài do NÚT quyết định, không còn ô chọn tay.
  const publishMutation = useMutation({
    mutationKey: ["POSTS", "PUBLISH_LAYOUTS"],
    mutationFn: (input: { id: string; scheduledAt?: string | null }) =>
      postApi.publishLayouts(input.id, input.scheduledAt ?? null),
    onSuccess: (res) => {
      if (res.submittedForReview) {
        toast.success("Đã gửi Khoa duyệt. Bài sẽ lên web sau khi được duyệt.");
        void queryClient.invalidateQueries({ queryKey: ["POSTS"] });
        return;
      }
      if (!res.ok && res.reason === "no-layout") {
        toast.warn("Bài chưa có trang public — tạo layout trước đã");
        return;
      }
      if (res.skipped?.length) {
        toast.warn(
          `Đã xuất bản, nhưng bỏ qua ${res.skipped.length} trang vì trùng đường dẫn`,
        );
      } else {
        toast.success(
          res.scheduled
            ? "Đã lên lịch xuất bản"
            : "Đã xuất bản lên trang công khai",
        );
      }
      queryClient.invalidateQueries({ queryKey: ["POSTS"] });
      queryClient.invalidateQueries({ queryKey: ["PAGE_LAYOUTS"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Không thể xuất bản");
    },
  });

  const requireTitle = () => {
    if (title.vi.trim()) return true;
    toast.warn("Nhập tiêu đề tiếng Việt trước khi lưu");
    return false;
  };

  // Cả ba nút lưu đều tự lo trang public: người dùng không phải bấm thêm một nút
  // "tạo layout" nữa — chọn danh mục xong bấm lưu là đủ. Bài đã có trang thì chỉ
  // cập nhật danh mục cho trang đó chứ không tạo thêm trang mới.
  const ensureLayout = async (id: string) => {
    if (kind === "news" && categoryIds.length === 0) {
      toast.warn("Chọn ít nhất một danh mục");
      return false;
    }
    await cloneMutation.mutateAsync({
      postId: id,
      templateLayoutId: templateId || KIND_TEMPLATE[kind ?? "news"],
      categoryIds: finalCategoryIds(),
    });
    return true;
  };

  // Lưu → ghi nội dung + tạo/cập nhật trang nhưng KHÔNG đổi trạng thái xuất bản.
  // Bài mới thì là Nháp; bài đã xuất bản/đã hẹn thì GIỮ NGUYÊN trạng thái đó —
  // trước đây luôn gửi "DRAFT" nên bấm Lưu trên bài đang sống là hạ nó về nháp,
  // bài rơi khỏi feed công khai trong khi trang của nó vẫn còn.
  const saveDraft = async () => {
    if (!requireTitle()) return;
    const saved = await saveMutation.mutateAsync(
      buildPayload(postId ? undefined : "DRAFT"),
    );
    const id = postId ?? saved?.id;
    if (id) await ensureLayout(id);
  };

  // Lưu và xuất bản ngay → ghi nội dung, đảm bảo có trang, rồi publish trang đó.
  const savePublishNow = async () => {
    if (!requireTitle()) return;
    const saved = await saveMutation.mutateAsync(buildPayload());
    const id = postId ?? saved?.id;
    if (!id) return;
    if (!(await ensureLayout(id))) return;
    publishMutation.mutate({ id });
  };

  // Lưu và lên lịch → mở hộp chọn thời gian, xác nhận ở confirmSchedule.
  const saveAndSchedule = () => {
    if (!requireTitle()) return;
    setScheduleModalOpen(true);
  };

  const confirmSchedule = () => {
    if (!scheduledAt) {
      toast.warn("Chọn thời gian xuất bản");
      return;
    }
    const at = new Date(scheduledAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      toast.error("Thời gian xuất bản phải ở tương lai");
      return;
    }
    setScheduleModalOpen(false);
    void (async () => {
      const saved = await saveMutation.mutateAsync(buildPayload("SCHEDULED"));
      const id = postId ?? saved?.id;
      if (!id) return;
      if (!(await ensureLayout(id))) return;
      publishMutation.mutate({ id, scheduledAt: at.toISOString() });
    })();
  };

  const busy = saveMutation.isPending || publishMutation.isPending;
  const previewCover = resolveMediaUrl(coverUrl);
  const attachedLayouts = postQuery.data?.layouts ?? [];

  /**
   * Chọn mẫu ở hộp thoại đầu vào = chốt luôn cả ba thứ: loại bài, layout, và
   * danh mục. Trước đây hỏi ba lần ở ba chỗ, mà "Sự kiện" lại xuất hiện ở cả
   * bước loại bài lẫn bước mẫu nên người dùng tưởng bị hỏi trùng.
   */
  /**
   * Hộp thoại đầu vào hỏi DANH MỤC, không hỏi layout mẫu.
   *
   * Lý do: kiểm dữ liệu thật cho thấy cả 7 "layout mẫu" có cấu trúc GIỐNG HỆT
   * nhau (Header → Container[PostReaderTools, PostHeader, PostTagList,
   * PostCoverImage, PostBody, PostEventInfo, Spacer] → Footer). Chúng chỉ khác
   * tên và danh mục — tức là nhãn danh mục đội lốt layout. Bắt người dùng "chọn
   * mẫu" trong khi mọi mẫu cho ra cùng một trang là gây nhầm lẫn vô ích.
   *
   * Loại bài suy từ danh mục: "event" → bài sự kiện (hiện ô thời gian, đường dẫn
   * /su-kien do post.eventStartAt quyết định), còn lại → tin tức.
   */
  const pickCategory = (
    cat: { id: string; slug: string } | null,
    asEvent: boolean,
  ) => {
    const nextKind = asEvent ? "event" : "news";
    setKind(nextKind);
    // Bài sự kiện: "Sự kiện" tự được kèm ở finalCategoryIds, nên ở đây chỉ giữ
    // danh mục PHỤ (Câu lạc bộ, Học bổng…) nếu người dùng chọn kèm.
    setCategoryIds(cat && cat.slug !== "event" ? [cat.id] : []);
    // Bố cục: lấy mẫu hợp với loại bài; không có thì để trống, lúc lưu dùng mẫu
    // dự phòng.
    const list = templatesFor(asEvent);
    const remembered = readLastTemplate(nextKind);
    const preset =
      remembered && list.some((t) => t.id === remembered)
        ? remembered
        : (list[0]?.id ?? "");
    setTemplateId(preset);
    // Nhiều hơn một bố cục thì mới hỏi; còn lại vào thẳng bước điền nội dung.
    setPickStep(list.length > 1 ? "layout" : "category");
  };

  /** Holder của bố cục đang chọn — quyết định hiện ô nhập nào. */
  const activeHolders =
    (templatesQuery.data ?? []).find((t) => t.id === templateId)?.holders ?? [];
  // Bài cũ đã có dữ liệu thì vẫn hiện ô để sửa/xoá, kể cả khi bố cục đổi.
  const showGallery =
    activeHolders.includes("PostGallery") || gallery.length > 0;
  const showVideo = activeHolders.includes("PostVideo") || !!videoUrl;

  const templatesFor = (asEvent: boolean) =>
    (templatesQuery.data ?? []).filter((t) =>
      asEvent ? t.category?.slug === "event" : t.category?.slug !== "event",
    );

  const pickLayout = (id: string) => {
    setTemplateId(id);
    if (kind) rememberTemplate(kind, id);
    setPickStep("category");
  };

  const eventCategory = (categoriesQuery.data ?? []).find(
    (c) => c.slug === "event",
  );
  const newsCategoryChoices = (categoriesQuery.data ?? []).filter(
    (c) => c.slug !== "event",
  );

  // Bài MỚI chưa chọn loại: chỉ hiện hộp thoại, KHÔNG dựng trình soạn phía sau.
  // Để editor hiện mờ sau lớp phủ dễ khiến người dùng tưởng đã vào soạn được rồi.
  if (!postId && (!kind || pickStep === "layout")) {
    return (
      <div className="flex items-center justify-center h-full px-4 bg-slate-50 dark:bg-[#111827]">
        <div className="bg-white dark:bg-[#1a2436] rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6">
          <p className="text-[11px] font-semibold tracking-wider uppercase text-blue-600 dark:text-blue-400 mb-1">
            {pickStep === "layout" ? "Bước 2 / 3" : "Bước 1 / 3"}
          </p>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
            {pickStep === "layout"
              ? "Dùng bố cục nào?"
              : "Bài này thuộc mục nào?"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
            {pickStep === "layout" ? (
              <>
                Bố cục quyết định <b>cách trình bày</b> trang, không ảnh hưởng
                bài nằm ở mục nào. Đổi lại được khi soạn.
              </>
            ) : (
              <>
                Chọn <b>mục</b> mà bài sẽ nằm vào. Thêm mục khác hoặc đổi bố cục
                đều làm được ở bước soạn nội dung.
              </>
            )}
          </p>

          {pickStep === "layout" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {templatesFor(kind === "event").map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => pickLayout(tpl.id)}
                    className={
                      "px-3 py-2 text-sm rounded-lg border text-slate-800 dark:text-slate-100 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-[#202c44] " +
                      (tpl.id === templateId
                        ? "border-blue-500 bg-blue-50/60 dark:bg-[#202c44]"
                        : "border-slate-200 dark:border-slate-700")
                    }
                  >
                    {tpl.name.replace(/^Layout mẫu\s*[—-]\s*/, "")}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setKind(null);
                  setPickStep("category");
                }}
                className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
              >
                ← Chọn lại mục
              </button>
            </div>
          ) : newsCategoryChoices.length || eventCategory ? (
            <div className="space-y-4 max-h-[55vh] overflow-y-auto">
              {newsCategoryChoices.length ? (
                <div>
                  <p className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 mb-2">
                    Tin tức
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {newsCategoryChoices.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => pickCategory(cat, false)}
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-[#202c44] text-slate-800 dark:text-slate-100"
                      >
                        {localizeCategory(cat.name)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {eventCategory ? (
                <div>
                  <p className="text-[10px] font-semibold tracking-wider uppercase text-slate-400 mb-2">
                    Sự kiện{" "}
                    <span className="font-normal normal-case tracking-normal">
                      — cần điền thời gian, địa điểm
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => pickCategory(null, true)}
                      className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-[#202c44] text-slate-800 dark:text-slate-100"
                    >
                      Sự kiện chung
                    </button>
                    {/* Sự kiện của một mục cụ thể: bài nằm ở CẢ "Sự kiện" lẫn
                        mục đó (vd hội thảo của CLB hiện ở cả hai nơi). */}
                    {newsCategoryChoices.map((cat) => (
                      <button
                        key={`ev-${cat.id}`}
                        type="button"
                        onClick={() => pickCategory(cat, true)}
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-[#202c44] text-slate-800 dark:text-slate-100"
                      >
                        {localizeCategory(cat.name)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            /* Chưa có mẫu nào được đánh dấu (hoặc đang tải): quay về hai lựa
               chọn cũ để không ai bị kẹt không tạo được bài. */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setKind("news")}
                className="text-left p-4 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-[#202c44]"
              >
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  Tin tức
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Hiện ở trang chủ và trang /tin-tuc.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setKind("event")}
                className="text-left p-4 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-[#202c44]"
              >
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  Sự kiện
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Hiện ở mục Sự kiện sắp tới, đường dẫn /su-kien.
                </span>
              </button>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <Link
              href="/admin/posts/list"
              className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline"
            >
              Huỷ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1a2436] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/posts/list"
            aria-label="Quay lại danh sách bài đăng"
            title="Quay lại danh sách bài đăng"
            className="p-2 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-[#202c44]"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-content-1000 dark:text-slate-100">
              {postId ? "Chỉnh sửa bài đăng" : "Tạo bài đăng mới"}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {kind === "event"
                ? "Bài sự kiện — hiện ở mục Sự kiện sắp tới, đường dẫn /su-kien."
                : "Bài tin tức — chọn danh mục rồi lưu; trang public tạo và cập nhật tự động."}
            </p>
          </div>
        </div>
      </header>

      {/* max-w + mx-auto: trên màn rộng, ô nhập kéo dài gần 2000px vừa khó đọc
          vừa trống trải. Giới hạn bề rộng rồi canh giữa, gọn hơn nhiều.
          px nhỏ hơn ở màn hẹp để không phí chỗ trên điện thoại. */}
      <div className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 space-y-4">
        {/* Trạng thái nằm ngang hàng với tab ngôn ngữ để nhường trọn hàng dưới
            cho tiêu đề — trước đây nó chiếm 1/3 hàng tiêu đề khá phí chỗ. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1a2436] p-1 text-xs font-medium">
            {(["vi", "en"] as Locale[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={
                  "px-3 py-1.5 rounded-md transition-colors " +
                  (lang === l
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#202c44]")
                }
              >
                {l === "vi" ? "Tiếng Việt" : "English"}
                {l === "en" && missingEnFields.length ? (
                  <span
                    className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            ))}
          </div>
          {missingEnFields.length ? (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-md px-2 py-1">
              Chưa có bản tiếng Anh: <b>{missingEnFields.join(", ")}</b> — trang
              /en sẽ hiển thị nội dung tiếng Việt.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            {/* Trạng thái KHÔNG còn chọn tay: nó do nút lưu quyết định (Lưu = Nháp,
                Lưu và lên lịch = Lên lịch, Lưu và xuất bản ngay = Công khai). Bày
                ra ô chọn chỉ khiến người dùng đặt một trạng thái mà hệ thống lại
                ghi đè theo trạng thái layout. */}
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Trạng thái bài đăng
            </span>
            <span
              className={
                "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium " +
                (status === "PUBLISHED"
                  ? "bg-emerald-100 text-emerald-700"
                  : status === "SCHEDULED"
                    ? "bg-amber-100 text-amber-700"
                    : status === "PENDING"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-slate-100 text-slate-700")
              }
              title="Trạng thái tự đặt theo nút bạn bấm ở dưới cùng"
            >
              {STATUS_LABELS[status]}
            </span>
          </div>
        </div>

        <section>
          <div>
            <label
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
              htmlFor="post-title"
            >
              Tiêu đề ({lang === "vi" ? "VI" : "EN"})
              {lang === "vi" ? (
                <span className="text-rose-500 ml-1">*</span>
              ) : null}
            </label>
            <input
              id="post-title"
              value={title[lang] ?? ""}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
              placeholder={
                lang === "vi"
                  ? "Ví dụ: Thông báo đăng ký học phần HK2"
                  : "e.g. HK2 course registration announcement"
              }
            />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div>
            <label
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
              htmlFor="post-slug"
            >
              Slug
            </label>
            <input
              id="post-slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 font-mono"
              placeholder="tin-tuc-thong-bao-..."
            />
          </div>
          {/* Không còn chọn Danh mục ở đây: danh mục đi theo LAYOUT mà bài được
              rót vào (chọn "Layout mẫu — Câu lạc bộ" thì bài nằm ở danh mục Câu
              lạc bộ). Nhờ vậy một bài rót vào nhiều layout sẽ hiện dưới nhiều
              danh mục, thay vì bị ép về đúng một danh mục như trước.
              Ô trống đó nay dành cho Tags — đỡ được một hàng. */}
          <div>
            <label
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
              htmlFor="post-tags"
            >
              Tags (chọn bên dưới, hoặc gõ tag mới rồi Enter)
            </label>
            <div className="flex flex-wrap items-center gap-1 w-full min-h-[38px] px-2 py-1.5 text-sm border border-slate-200 dark:border-slate-800 rounded-lg focus-within:ring-2 focus-within:ring-blue-200 bg-white dark:bg-[#1a2436]">
              {tagSlugs.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-medium"
                >
                  <TagIcon icon={tagBySlug(tag)?.icon} />#
                  {tagBySlug(tag)?.name ?? tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-blue-500 hover:text-blue-700"
                    aria-label={`Xoá tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="post-tags"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={commitTagDraft}
                className="flex-1 min-w-[120px] px-1 py-0.5 text-sm outline-none bg-transparent"
                placeholder={tagSlugs.length ? "" : "tag mới…"}
              />
            </div>
            {allTags.length > 0 && (
              <div className="relative mt-2">
                <button
                  type="button"
                  onClick={() => setTagPickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-300"
                >
                  + Chọn tag có sẵn
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {tagPickerOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Đóng"
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setTagPickerOpen(false)}
                    />
                    <div className="absolute left-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a2436] shadow-lg">
                      <div className="flex border-b border-slate-100 dark:border-slate-800">
                        {(["image", "text"] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setTagPickerTab(tab)}
                            className={`flex-1 px-3 py-2 text-xs font-medium ${
                              tagPickerTab === tab
                                ? "text-blue-600 border-b-2 border-blue-600"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {tab === "image" ? "Tag ảnh" : "Tag chữ"}
                          </button>
                        ))}
                      </div>
                      <div className="p-2">
                        <input
                          value={tagPickerSearch}
                          onChange={(e) => setTagPickerSearch(e.target.value)}
                          placeholder="Tìm tag…"
                          className="w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded outline-none bg-transparent"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto py-1">
                        {pickerTags.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-slate-400">
                            Không có tag.
                          </p>
                        ) : (
                          pickerTags.map((tg) => {
                            const active = tagSlugs.includes(tg.slug);
                            return (
                              <button
                                key={tg.slug}
                                type="button"
                                onClick={() => toggleTag(tg.slug)}
                                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-slate-50 dark:hover:bg-[#202c44] ${
                                  active
                                    ? "text-blue-600 font-medium"
                                    : "text-slate-700 dark:text-slate-200"
                                }`}
                              >
                                <TagIcon icon={tg.icon} />
                                <span className="flex-1 truncate">
                                  {tg.name}
                                </span>
                                {active && (
                                  <span className="text-blue-600">✓</span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Ảnh bìa + Tóm tắt xếp cạnh nhau: cả hai đều thấp, để mỗi thứ một
            hàng thì form dài không cần thiết. */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Ảnh bìa
            </label>
            <div className="flex flex-wrap items-start gap-3">
              <input
                value={coverUrl}
                onChange={(e) => {
                  setCoverUrl(e.target.value);
                  setCoverMediaId(null);
                }}
                placeholder="URL ảnh hoặc chọn từ thư viện"
                className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 truncate"
              />
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Chọn từ thư viện
              </button>
              {coverUrl ? (
                <input
                  value={coverAlt}
                  onChange={(e) => setCoverAlt(e.target.value)}
                  placeholder="Alt text"
                  className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 truncate"
                />
              ) : null}
            </div>
            {previewCover ? (
              <div className="mt-3 max-w-sm rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#121a2b]">
                {/** biome-ignore lint/performance/noImgElement: preview only */}
                <img
                  src={previewCover}
                  alt={coverAlt || title.vi}
                  className="w-full h-auto object-cover"
                />
              </div>
            ) : null}
          </div>

          <div>
            <label
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
              htmlFor="post-excerpt"
            >
              Tóm tắt ({lang === "vi" ? "VI" : "EN"}) — hiển thị ở danh sách
            </label>
            <textarea
              id="post-excerpt"
              value={excerpt[lang] ?? ""}
              onChange={(e) =>
                setExcerpt((prev) => ({ ...prev, [lang]: e.target.value }))
              }
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Tóm tắt ngắn 1-2 câu"
            />
          </div>
        </section>

        {reviewNote ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Khoa đã trả bài này về để chỉnh sửa
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-300 mt-1 whitespace-pre-line">
              {reviewNote}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              Sửa xong bấm “Lưu và gửi duyệt” để gửi lại.
            </p>
          </div>
        ) : null}

        {/* Ô nhập cho HOLDER: chỉ hiện khi bố cục đã chọn có khối tương ứng.
            Bố cục nào không có thì không hỏi — nội dung bám theo bố cục. */}
        {showGallery || showVideo ? (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {showGallery ? (
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Thư viện ảnh{" "}
                  <span className="font-normal text-slate-400">
                    ({gallery.length} ảnh)
                  </span>
                </span>
                <div className="flex flex-wrap gap-2 mb-2">
                  {gallery.map((img, i) => (
                    <span
                      key={`${img.src}-${i}`}
                      className="relative w-16 h-12 rounded overflow-hidden border border-slate-200 dark:border-slate-700"
                    >
                      {/* biome-ignore lint/performance/noImgElement: preview nhỏ */}
                      <img
                        src={resolveMediaUrl(img.src)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setGallery((prev) => prev.filter((_, k) => k !== i))
                        }
                        aria-label="Bỏ ảnh này"
                        className="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white text-[10px] leading-4 text-center"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setGalleryPickerOpen(true)}
                  className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Thêm ảnh từ thư viện
                </button>
              </div>
            ) : null}

            {showVideo ? (
              <div>
                <label
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
                  htmlFor="post-video"
                >
                  Video
                </label>
                <input
                  id="post-video"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="Dán link YouTube, Google Drive, OneDrive…"
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  File trên Drive/OneDrive nhớ đặt quyền{" "}
                  <b>ai có link đều xem được</b>, nếu không người ngoài thấy ô
                  trống.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <section>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
            Nội dung bài đăng ({lang === "vi" ? "VI" : "EN"})
          </label>
          <MarkdownEditor
            value={body[lang] ?? ""}
            onChange={(next) => setBody((prev) => ({ ...prev, [lang]: next }))}
          />
        </section>

        {/* Chỉ bài SỰ KIỆN mới cần thời gian/địa điểm. Trước đây khối này luôn
            hiện nên chọn "Tin tức" xong vẫn thấy ô nhập sự kiện, rất khó hiểu. */}
        {kind === "event" ? (
          <section className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-white dark:bg-[#1a2436]">
            <h2 className="text-sm font-semibold text-content-1000 dark:text-slate-100 mb-3">
              Thông tin sự kiện
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
                  htmlFor="event-start"
                >
                  Bắt đầu
                </label>
                <input
                  id="event-start"
                  type="datetime-local"
                  value={eventStartAt}
                  onChange={(e) => setEventStartAt(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
                  htmlFor="event-end"
                >
                  Kết thúc
                </label>
                <input
                  id="event-end"
                  type="datetime-local"
                  value={eventEndAt}
                  onChange={(e) => setEventEndAt(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
                  htmlFor="event-location"
                >
                  Địa điểm
                </label>
                <input
                  id="event-location"
                  value={eventLocation}
                  onChange={(e) => setEventLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Ví dụ: Cơ sở Nguyễn Văn Cừ"
                />
              </div>
            </div>
          </section>
        ) : null}

        {isSuperAdmin ? (
          <section className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-white dark:bg-[#1a2436]">
            <label
              htmlFor="publishedAt"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
            >
              Ngày đăng{" "}
              <span className="font-normal text-slate-400">
                (Super Admin — có thể lùi về quá khứ)
              </span>
            </label>
            <input
              id="publishedAt"
              type="datetime-local"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              Bỏ trống = dùng thời điểm xuất bản thực tế. Điền ngày quá khứ để
              bài hiển thị như đã đăng vào ngày đó (áp dụng khi bài ở trạng thái
              đã xuất bản).
            </p>
          </section>
        ) : null}

        <section className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-white dark:bg-[#1a2436]">
          <h2 className="text-sm font-semibold text-content-1000 dark:text-slate-100 mb-3">
            Layout public
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Chọn danh mục rồi bấm một trong ba nút lưu ở dưới cùng — trang
            public được tạo và cập nhật tự động, không cần thao tác riêng. Một
            bài chỉ có MỘT trang (một đường dẫn), nhưng nằm được dưới nhiều danh
            mục.
          </p>

          {kindTemplates.length ? (
            <div className="mb-4">
              <label
                className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1.5"
                htmlFor="post-template"
              >
                Bố cục trang{" "}
                <span className="font-normal normal-case text-slate-400">
                  — chỉ đổi cách trình bày
                </span>
              </label>
              <select
                id="post-template"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  if (kind) rememberTemplate(kind, e.target.value);
                }}
                disabled={attachedLayouts.length > 0}
                className="w-full max-w-md px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-[#1a2436] outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
              >
                {kindTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {attachedLayouts.length
                  ? "Bài đã có trang public nên không đổi được bố cục — xoá trang rồi tạo lại nếu cần."
                  : "KHÔNG liên quan tới việc bài nằm ở mục nào — mục do phần Danh mục bên dưới quyết định."}
              </p>
            </div>
          ) : null}

          {attachedLayouts.length ? (
            <div className="mb-4">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-2">
                Layouts đã gắn
              </p>
              <div className="flex flex-wrap gap-2">
                {attachedLayouts.map((layout) => (
                  <LayoutBadge key={layout.id} layout={layout} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Không còn chọn "layout mẫu" nữa: loại bài (tin tức / sự kiện) đã chốt
              ở modal đầu vào và quyết định luôn layout. Người dùng chỉ còn chọn
              DANH MỤC, và chọn được nhiều — một bài, một URL, nhiều bộ lọc. */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              Danh mục{" "}
              <span className="font-normal text-slate-400">
                — quyết định bài hiện ở mục nào (chọn được nhiều)
              </span>
            </span>
            {kind === "event" ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Bài sự kiện luôn có sẵn danh mục <b>Sự kiện</b>; tick thêm bên
                dưới nếu muốn bài hiện ở cả những mục khác.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {pickableCategories.map((c) => {
                const on = categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setCategoryIds((prev) =>
                        prev.includes(c.id)
                          ? prev.filter((x) => x !== c.id)
                          : [...prev, c.id],
                      )
                    }
                    className={
                      "px-2.5 py-1 text-xs font-medium rounded-md border " +
                      (on
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white dark:bg-[#1a2436] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-[#202c44]")
                    }
                  >
                    {localizeCategory(c.name)}
                  </button>
                );
              })}
            </div>
            {/* Chỉ nhắc khi TẠO MỚI. Lúc sửa bài, bỏ hết danh mục là hành động
                  có ý thức, không phải quên chọn — nhắc lại chỉ gây nhiễu. */}
            {!postId && kind === "news" && categoryIds.length === 0 ? (
              <p className="text-[11px] text-amber-600">
                Chọn ít nhất một danh mục để bài hiện đúng chỗ.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {/* Save/publish action moved to a sticky bottom bar (was in the top header). */}
      <div className="sticky bottom-0 z-10 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#1a2436]/95 backdrop-blur px-6 py-3 flex justify-end gap-2 flex-wrap">
        {/* Ba hành động thay cho một nút "Lưu draft": trước đây muốn bài lên web
            phải lưu ở đây rồi chuyển sang trình sửa layout mới bấm publish được. */}
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={busy}
          data-tour="post-save"
          className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-[#202c44] disabled:opacity-50"
        >
          {saveMutation.isPending ? "Đang lưu…" : "Lưu"}
        </button>
        <button
          type="button"
          onClick={saveAndSchedule}
          disabled={busy}
          className="px-4 py-2 text-sm font-semibold text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 disabled:opacity-50"
        >
          Lưu và lên lịch
        </button>
        <button
          type="button"
          onClick={() => void savePublishNow()}
          disabled={busy}
          className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {publishMutation.isPending
            ? mustReview
              ? "Đang gửi…"
              : "Đang xuất bản…"
            : mustReview
              ? "Lưu và gửi duyệt"
              : "Lưu và xuất bản ngay"}
        </button>
      </div>

      {pickerOpen ? (
        <MediaPickerModal
          onSelect={(url) => {
            setCoverUrl(url);
            setCoverMediaId(null);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {galleryPickerOpen ? (
        <MediaPickerModal
          onSelect={(url) => {
            // Chọn xong đóng luôn (modal dùng chung), bấm lại để thêm ảnh nữa.
            setGallery((prev) =>
              prev.some((g) => g.src === url)
                ? prev
                : [...prev, { src: url, alt: "" }],
            );
          }}
          onClose={() => setGalleryPickerOpen(false)}
        />
      ) : null}

      {scheduleModalOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setScheduleModalOpen(false);
          }}
        >
          <div className="bg-white dark:bg-[#1a2436] rounded-xl shadow-xl w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
              Lên lịch xuất bản
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Cron worker chuyển trạng thái sang PUBLISHED và đồng bộ lại các
              layout đã đính kèm khi đến thời điểm.
            </p>
            <label
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
              htmlFor="post-scheduled-at"
            >
              Thời gian xuất bản
            </label>
            <input
              id="post-scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 bg-white dark:bg-[#1a2436]"
              // biome-ignore lint/a11y/noAutofocus: modal entry point
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-[#202c44]"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmSchedule}
                disabled={saveMutation.isPending}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saveMutation.isPending ? "Đang lưu…" : "Xác nhận lên lịch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type LayoutBadgeProps = {
  layout: {
    id: string;
    name: string;
    slug: string;
    isPublished: boolean;
    scheduledAt: string | null;
  };
};

const layoutBadgeStyle = (layout: LayoutBadgeProps["layout"]): string => {
  if (layout.isPublished)
    return "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100";
  if (layout.scheduledAt)
    return "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100";
  return "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100";
};

const layoutBadgeLabel = (layout: LayoutBadgeProps["layout"]): string => {
  if (layout.isPublished) return "Published";
  if (layout.scheduledAt) return "Scheduled";
  return "Draft";
};

function LayoutBadge({ layout }: LayoutBadgeProps) {
  return (
    <Link
      href={`/admin/widgets-layout?edit=${layout.id}`}
      className={
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors " +
        layoutBadgeStyle(layout)
      }
      title={`Mở ${layout.name}`}
    >
      <span>{layout.name}</span>
      <span className="text-[10px] uppercase tracking-wide opacity-70">
        {layoutBadgeLabel(layout)}
      </span>
    </Link>
  );
}
