# Session Progress Log

## Session 2026-08-16 (khuya) — Cứu ổ đĩa máy chủ

**Ổ gốc đầy 100%** làm deploy chết giữa chừng (`OSError: Failure` khi sftp) và cả
ba container `unhealthy`. Nguyên nhân: `/var/lib/docker.img` cấp phát CỨNG 32G
trên ổ 47G trong khi docker chỉ dùng 8,6G — 23G nằm chết; cộng swapfile 4G thì
chỉ còn ~1G dư cho uploads (4,7G), sao lưu và OS. Sao lưu DB tăng 79MB/ngày ×
30 bản là giọt nước tràn ly. Không ai thấy vì mọi chỗ in `df` đều in ổ docker
(29%) chứ không phải ổ gốc.

Đã làm: dump DB tải về máy dev trước → dừng stack + docker daemon → ghi 0 lên
vùng trống trong docker.img → `fallocate --dig-holes` → bật lại. **Ổ gốc 99% →
57% (21G trống)**, dữ liệu nguyên vẹn (1680 post, 2520 layout, 16842 chatbot
chunk, 103 media, 15 user). Kèm theo: dọn 14,85G build cache, KEEP sao lưu
30→10, watchdog canh ổ gốc, deploy dừng sớm khi thiếu chỗ.

⚠ **CÒN LẠI:** `docker.img` không tự co lại, thực chiếm đã bò lên 13G sau khi
bật lại — cần chạy lại dig-holes định kỳ, hoặc chuyển hẳn data-root ra thư mục
thường rồi xoá file loop.

**Caddy đã vào compose.** Trước đây nó tạo ngoài compose nên `up` đầy đủ báo
trùng tên rồi dừng giữa chừng. Bẫy: chứng chỉ Let's Encrypt thật nằm ở volume
tên trần `caddy_data`, còn compose lại tự tạo `hcmus-cms_caddy_data` rỗng — dựng
thẳng là Caddy xin cấp lại chứng chỉ. Đã khai báo external đúng tên. Kiểm bằng
vân tay SHA-256 trước/sau: y nguyên, không xin cấp lại. `docker compose up -d`
trần (không liệt kê service) nay chạy sạch.

**Đã gỡ mìn `db-setup`** (xem mục dưới). `docker compose up -d` đầy đủ nay dựng
được backend, `ChatbotChunk` giữ nguyên 16.842 dòng.

Bối cảnh — **`docker compose up -d` đầy đủ trước đây KHÔNG dựng nổi backend:**
service `db-setup` chạy `npx prisma db push` không có `--accept-data-loss`, mà
push muốn xoá bảng `ChatbotChunk` (16.842 dòng, bảng SQL thô không khai báo
trong schema.prisma) và bỏ giá trị enum `REJECTED` → exit 1 → backend bị chặn.
Lâu nay không lộ vì deploy luôn dùng `--no-deps` cho từng service. Đã đưa
backend lên bằng `docker start`. `REJECTED` hiện KHÔNG có bản ghi nào dùng.

**Cách gỡ:** bỏ `db push` khỏi đường khởi động. Tách làm hai:
- `db-init` (mới, chạy mỗi lần `up`): chỉ chạy migration chatbot — toàn bộ là
  `CREATE EXTENSION/TABLE IF NOT EXISTS` nên chạy lại vô hại. Backend nay chờ
  service này.
- `db-setup` (cũ): chuyển vào profile `setup`, `up` thường bỏ qua. Chỉ chạy tay
  khi dựng mới: `docker compose --profile setup up db-setup`.
Áp cho cả ba file compose (sandbox/deploy/dev). Kiểm trên máy chủ thật: `up` đầy
đủ → backend healthy, ChatbotChunk vẫn 16.842 dòng, site + admin 200.

## Session 2026-08-16 — Song ngữ, header, bảng, ảnh bìa

**Mất bản tiếng Anh.** 142 khối nội dung để `en` trùng khít `vi` trong khi site cũ
có bản dịch thật. `backfill-english-content.ts` lấy lại từ `/en/<slug>.html`:
thân bài 653→686 có bản Anh riêng, tiêu đề 730→766. Còn lại là trang site cũ
vốn không có bản Anh (100 trang 404 ở `/en/`, 43 trang nội dung giống hệt).
Chặn trường hợp `<title>` chỉ còn tên site, nếu không sẽ ghi "Khoa Vật lý -
Vật lý kỹ thuật" làm tiêu đề tiếng Anh cho 15 trang.

**656 layout mất header/footer.** Script di trú ghi `SiteHeader`/`SiteFooter`
trong khi Puck đăng ký `Header`/`Footer` → "No configuration for SiteHeader".
Đã đổi trong DB và sửa 6 script.

**Bảng lệch giữa hai ngôn ngữ.** Trang công khai nhận diện bảng dữ liệu bằng dấu
hiệu trong HTML (`border=`…); nội dung lấy từ trang render của site cũ không có
dấu hiệu đó còn nội dung từ dump thì có. `normalize-table-borders.ts` chỉ vá khi
bản ngôn ngữ KIA có `border=` (23 layout/148 bảng) thay vì vá đại trà (124/1002).

**Mở trang legacy trong trình soạn thảo rồi lưu sẽ hỏng bảng.** Tiptap chuẩn hoá
theo mô hình ProseMirror: thêm ô rỗng cho đủ cột, gắn `class="post-table"`, bỏ
thuộc tính bố cục cũ → trang Giảng viên cơ hữu sinh cột trống, ô nào cũng kẻ
khung, email bẻ giữa từ. Đã lấy lại bản gốc từ origin (nội dung chữ giống 99,7%,
chỉ khác thứ tự 3 giảng viên).

**6 bài mất ảnh bìa**: `coverUrl` là URL tuyệt đối `https://phys.hcmus.edu.vn/
uploads/khoa-vat-ly/…` — thiếu đoạn `/legacy/` nên 404 (ảnh vẫn có trên đĩa).
Đã sửa cả `Post.coverUrl` lẫn bản đã rót vào layout.

## Session 2026-08-08 — Lịch hẹn xuất bản, bảng sửa được trong admin, icon

**Lên lịch không giữ được giờ hẹn.** `syncAttachedLayouts` ghi cả
`publishedPuckData` (bản đang phục vụ web) ngay lúc lưu, nên "Lưu và lên lịch"
đẩy nội dung lên luôn. Nay chỉ ghi bản nháp; bản công khai đổi ở đúng thời điểm
xuất bản. Ba lỗi kèm theo: `publishAttachedLayouts` bỏ qua layout đã xuất bản
(nên "xuất bản ngay" sẽ không đổi gì sau sửa trên); hẹn giờ bản cập nhật cho bài
đang sống làm bài rơi khỏi feed vì lọc theo `status` — nay lọc theo "đã từng
xuất bản + còn layout đang xuất bản" (`PUBLICLY_VISIBLE`); nút "Lưu" luôn gửi
`DRAFT` nên hạ bài đang sống về nháp.
E2E `deploy/e2e-post-schedule.py` chạy trên production: 5/5 PASS.

**Baseline test đỏ sẵn** 21/40 (spec page-layout thiếu ChatbotService/PostService
sau khi hai service này được tiêm vào). Đã sửa → 40/40.

**Bảng trong nội dung.** Thanh công cụ chỉ có nút chèn bảng, không thêm/bớt được
hàng cột. Thêm nhóm nút thao tác bảng + CSS cho tay kéo cột (tính năng đã bật
sẵn nhưng vô hình). Trang công khai nay tôn trọng bề rộng người soạn tự kéo
(`colwidth`). Sửa lỗi chia cột với bảng có tiêu đề GỘP Ô: đếm cột theo tổng
colspan, đo trên hàng không gộp, ghi bề rộng vào `<colgroup>`. Kiểm trực tiếp
trên trang CTĐT ngành công nghệ bán dẫn: 8 cột, ba cột "Lý thuyết/Thực hành/Bài
tập" nay 8.873% mỗi cột thay vì bị bóp vỡ chữ.

**Icon.** `phone`, `call`, `chat`, `edit_note` không có trong `IconMap` nên rơi
về icon lưới mặc định. Đã bổ sung (kèm facebook/instagram/youtube).

**Tệp legacy thiếu.** Link PDF chương trình đào tạo trả JSON 404. Quét toàn bộ
tham chiếu `/uploads/legacy/` của trang đã xuất bản: **244/2271 tệp không có
trên đĩa**. `deploy/fetch-missing-legacy-assets.sh` lấy lại từ origin cũ →
còn 31 (31 tệp đó site cũ cũng 403). Hai bẫy: site cũ trả 200 kèm soft-404 nên
phải kiểm nội dung; tên tệp legacy có dấu ngoặc nên regex trích không được cắt
ở `)`.

**Bảng có sẵn colgroup của Tiptap.** Bảng nào đã từng sửa trong trình soạn thảo
mang sẵn `<colgroup>` (min-width: 25px). Bộ chia cột chèn thêm colgroup của mình
lên trước → bảng 8 cột hoá ra khai báo **16 cột**, trình duyệt chia bề rộng cho
cả 16 nên mọi cột co lại và tiêu đề vẫn rớt chữ trên web dù bề rộng tính đã
đúng. Nay gỡ colgroup cũ rồi mới ghi cái mới; colgroup cũ có `width` thật thì
tôn trọng luôn. Kiểm trên trang 2022: 8/8 bảng còn đúng 1 colgroup.

**Preview khác trang thật.** Khung Preview đổ thẳng HTML ra thẻ `prose`, bỏ qua
khâu chuẩn hoá bảng → hai bên hiện khác hẳn. Nay gọi đúng `LegacyHtmlRender`.
Kèm theo: tiêu đề cột rớt chữ vì bộ chia cột chỉ đo hàng thường, mà tiêu đề lại
nằm ở hàng CÓ ô gộp nên chưa từng được nhìn tới — dựng lưới tiêu đề có
colspan/rowspan và đặt sàn theo độ dài cụm tiêu đề. "Học kỳ" 30px → 98px.

**413 khi lưu layout dài.** Backend chưa từng đặt giới hạn body nên dùng mặc
định 100kb của Express, trong khi 72 layout vượt mức đó (dài nhất 3,1MB) — lưu
trong trình sửa layout trả 413. Nới `useBodyParser` lên 25MB. Kiểm trực tiếp:
trang cử nhân tài năng (426KB) và trang dài nhất (3,0MB) đều PUT trả 200.

**Giảng viên cơ hữu.** Đối chiếu với site cũ: cả hai đúng 122 người, tập email
trùng khít — không ai mất khi di trú. Lệch 7 dòng học hàm/chức danh do Khoa sửa
sau mốc dump; đã lấy lại trang từ origin cũ.

Commits: `573b824`, `589f0ec`, `3156516`, `b536844`, `1d10185`.

## Session 2026-08-03/04 — Soát link chết tới cạn (585 → 21)

Tự động hoá thay cho kiểm tay: `deploy/audit-dead-links.sh` bóc link nội bộ từ
`puckData` của mọi layout đã xuất bản rồi gọi từng đường dẫn **theo redirect**
(`curl -L`), vì bản trước coi 307 là sống nên bỏ sót cả họ 407 môn học.

Đợt này 646 đường dẫn → 21 chết, và cả 21 đều **404 trên chính site cũ** (kiểm bằng
`<title>` qua origin cũ `112.78.11.146` + header Host, do tên miền đã trỏ site mới;
soft-404 của Joomla trả 200 nên phải so tiêu đề chứ không tin mã HTTP hay kích thước).

- Di trú 14 trang bộ môn còn thiếu: `build-missing-dept-pages.ts` (bản đầu chạy theo
  danh sách ID cứng nên chưa bao giờ nhìn tới chúng).
- 13 link môn học map theo `subjects.code` thay vì đoán theo tên — bảng CTĐT trỏ bằng
  slug tiếng Anh hoặc sai mã (vd PHY10613 `digital-logic-design` → `thiet-ke-vi-mach`).
  Link trần không mã thuộc họ PHY100xx đại cương.
- `build-post-dump-pages.ts`: lấy HTML thẳng từ origin cũ cho trang tạo **sau** mốc
  dump 14/06/2026 (2 trang danh mục công bố 2026 + 1 bài tuyển dụng 03/2021 mà dump
  ghi `deleted=1` nhưng site cũ vẫn phục vụ — nên khôi phục để đúng hiện trạng).
- `proxy.ts`: tra bảng redirect **trước** khi bỏ qua đường dẫn có phần mở rộng — 51
  redirect `.html` trước đó im lặng không chạy.
- `legacy-redirects.json`: 397 → 517. Ba redirect `vat-ly-dia-cau/category/*` từng
  trỏ vào `vat-ly-dia-cau/tin-tuc` (trang không tồn tại) → đổi về trang bộ môn.

21 link còn lại là link chết sẵn trong nội dung cũ (danh sách học bổng HB-20xx,
danh sách sinh viên, hai trang nhân sự, vài trang bộ môn `.html` không có trong bất kỳ
bảng nào của dump). Không tạo trang giả để "chữa" chúng.

Commits: `58712ec`, `44a5601`, `3599aff`, `73ed069`, `e118508`.

## Session 2026-07-09 — KLTN full draft (thesis/, theo email GVHD)

Viết trọn bộ bản thảo KLTN vào `thesis/*.md` theo góp ý GVHD: Mở đầu, C1–C4, Kết luận,
TLTK (15 nguồn IEEE). C3 đổi tên "Thiết kế và hiện thực hệ thống"; C4 thêm mục 4.2
Kiểm thử chức năng (CRUD/phân quyền/xuất bản/di trú). Số liệu thật: 40/40 unit test
(vitest, 09/07), pnpm audit 51 vulns (3 critical), số liệu di trú từ nhật ký script.
CWV/Lighthouse/Observatory/SSL Labs để placeholder 【CHƯA ĐO】chờ domain. Việc còn lại
+ 11 hình cần chèn: xem `thesis/README.md`. Không đụng mã nguồn ứng dụng.

## Current State

**Last Updated:** 2026-06-28
**Active Feature:** feat-013 — Legacy migration (header dropdowns + section pages)

## Session 2026-07-05 — Department-scoped permissions (feat-015, DONE incl. P4)

**P4 (department-prefixed URLs) — done:**
- `re-slug-department-layouts.ts`: 388 bộ-môn post-layouts re-slugged `tin-tuc/<x>` →
  `<dept-slug>/tin-tuc/<x>` (1152 faculty-wide kept flat); emits
  `frontend-public/src/lib/legacy-redirects.json` (397 entries).
- `seed-department-landing-pages.ts`: 9 landing pages at `/<dept-slug>` cloned from the
  published homepage, stamped with departmentId (editable by that dept's admin).
- `frontend-public/src/proxy.ts` (Next 16 uses proxy.ts as middleware): 308-redirects old
  flat URLs → new dept-prefixed URLs from the map.
- Verified: `/vi/tin-tuc/<x>` → 308 → `/vi/vat-ly-ung-dung/tin-tuc/<x>`; new URL 200;
  `/vi/vat-ly-ung-dung` landing 200. Commit for P4 below.

---



Per-department admins may only see/CRUD their own department's content.

- **P0** `merge-departments.ts`: merged duplicate "Vật lý Tin học" depts → canonical
  slug `vat-ly-tin-hoc`; faculty dept `dept_legacy_1` slug `/` → `khoa`.
- **P1**: `departmentId` on Post/Media/PageLayout (via `prisma db push`) + added to the
  **JWT payload** (login/refresh/google sign sites). `backfill-content-departments.ts`
  stamped **1587 posts** (from legacy `posts.deptid` via `legacyId`) + **1540 layouts**
  (from source post). Faculty-wide = `dept_legacy_1`; 1233 posts are faculty, rest per-bộ-môn.
- **P2** backend scoping: `shared/helpers.ts` → `departmentScopeWhere` (list/read),
  `mediaScopeWhere` (media reads allow shared faculty/null), `canAccessDepartment` (mutations),
  `FACULTY_DEPT_ID`. Threaded `departmentId` (via `@ActiveUser('departmentId')`) through
  post + media services/controllers; page-layout gatekeepers (`assertOwnership`,
  `findAllForAdmin`, `findByIdForAdmin`) resolve the user's dept via a repo lookup (no
  controller churn). **40 backend unit tests pass** (helpers.spec + updated page-layout specs).
- **P3** frontend: `departmentId` exposed in Post/Media responses + client types;
  `lib/department.ts canMutateDepartment`; media detail modal hides Xóa/Lưu on shared
  faculty assets. Post/layout lists need no gating (server-scoped).
- **Verified via API**: `vlud_admin` JWT dept=dept_legacy_6; `/posts` → 32 (all VLUD);
  own post 200 / cross-dept VLLT post 404; `/media` shows shared assets.
- **Rules**: SUPER_ADMIN=all; faculty admin (dept_legacy_1)=faculty+untagged; bộ-môn admin=own.
- **⚠ Operational**: existing admins must **re-login** to get `departmentId` in their JWT.
- **REMAINING P4** (separable): re-slug bộ-môn layouts → `<dept-slug>/tin-tuc/<x>`,
  create `/<dept-slug>` landing pages, add redirects from old `tin-tuc/…` URLs.
- Commits: `af54a4a` (P0–P2), `4545646` (P3). Legacy MariaDB restarted for backfill.

## Session 2026-07-04 — Admin onboarding tour + Help center (feat-014, DONE)

New teachers get guided onboarding; a Help center stays available afterwards.

- **Library:** `driver.js@1.6` (framework-agnostic — safe on React 19.2/Next 16; API
  validated via context7 MCP). Installed in the admin workspace.
- **Backend:** added `User.tourCompletedAt DateTime?`. NOTE: applied via
  `prisma db push` (the project's convention — `docker-compose` db-setup uses
  `db push`; `prisma migrate dev` wanted to RESET due to pre-existing migration
  drift, so push was the safe choice — data intact, 1649 layouts preserved).
  Exposed/accepted through the existing `PATCH /auth/profile`
  (`UserResSchema` + `UpdateProfileBodySchema` + `auth.repo` type). `authApi.completeTour()`.
- **Frontend:** `lib/tour/driver.ts` (driver wrapper, `waitForElement`,
  `runOverview`, `runWalkthrough` with route-nav + portal-wait), `lib/tour/content.ts`
  (bilingual OVERVIEW_STEPS / WALKTHROUGHS / FAQ). `components/admin/onboarding-tour.tsx`
  (auto-runs on first login when `tourCompletedAt==null`, persists on finish/cancel)
  + `components/admin/help-center.tsx` (floating Help button → Sheet with Interact/Doc
  tabs + VI/EN toggle), mounted in `app/admin/layout.tsx`. `data-tour` anchors added to
  the sidebar nav, New-layout button, create-layout modal, Puck save menu
  (`save-primary`/`save-schedule`/`save-publish`), media upload zone, post-save. Sidebar
  force-expands during the tour via a `tour:sidebar` CustomEvent. driver.js dark theme in `globals.css`.
- **Verified:** admin `tsc` clean + `next build` OK; Playwright (seeded admin login) →
  auto-tour highlights Dashboard (VN popover "Bảng điều khiển", 1/7) → close → Help
  button + completion toast → Help panel Interact (4 walkthroughs + "replay tab tour") +
  Doc (searchable FAQ). No console errors.
- **Note:** `db push` did NOT create a migration file (consistent with project). The
  prod `docker-compose` db-setup (`prisma db push`) applies the column on deploy.

## Session 2026-06-28 (cont. 2) — Full legacy page FRAME + perf review

User asked for the full legacy page frame on all 29 section pages, and to avoid N+1
queries (BE+FE) per Next.js/NestJS best practices.

**Frame** (new `components/legacy-page.tsx`):
- `PageHero`: full-width bgimage banner with dark overlay, centered uppercase title +
  subtitle (from pageslang.excerpt), and a "Trang chủ / <title>" breadcrumb bar.
- `LegacyPageBody`: 2-column layout — faithful content (reuses `LegacyHtmlRender`) on
  the left, sidebar on the right with "Danh mục" links + live "Tin mới nhất" list.
- `build-legacy-pages.ts` now assembles the tree directly: `SiteHeader` + `PageHero` +
  `LegacyPageBody` + `SiteFooter` (no more post template). This also **fixed the
  duplicate-image bug** (dropped `PostCoverImage`, which had duplicated the body's lead
  image) and removed the wrong "Tin tức" breadcrumb. Hero bg = page.bgimage→image.

**Perf / N+1 review (Next.js best-practices skill):**
- BE `listLatestPublic`: single `findMany` + `include` (no N+1). ✓
- `LegacyPageBody` sidebar news: module-level dedup + 60s TTL cache (`fetchLatestNews`)
  so the 29 pages don't each refetch (`client-swr-dedup`).
- `site-syndication.tsx`: `SiteHeader` + `SiteFooter` both fetched `trang-chu` per page
  (2 identical requests/render) — added module-level dedup + 30s TTL cache to `fetchHome`.
- `build-legacy-pages`: `pages.find` in loop → `Map` lookup (`js-index-maps`).

Verified (Playwright, legacy-vs-new): dao-tao-dai-hoc / muc-tieu / nang-luc now show
hero + breadcrumb + 2-col content + Danh mục/Tin mới nhất sidebar + footer, matching
legacy; muc-tieu no longer duplicates the group photo. tsc clean (admin/public/backend).

## Session 2026-06-28 (cont.) — Section-page rendering FIDELITY fix

User flagged that migrated pages didn't match legacy 1-to-1 (missing body images,
missing table gridlines, lost red headers / blue links / bullet lists). Root cause:
the section pages reused the post template's `PostBody`, whose aggressive normalising
reset (`color: inherit !important`, `background: transparent !important`) + Tailwind
preflight (strips list markers + cell borders) **destroys** the legacy inline styling.
Body `<img>` also never went through `resolveMediaUrl`, so they 404'd off the public origin.

**Fixes:**
- New Puck component **`LegacyHtml`** (`components/post-placeholders.tsx`, registered in
  `puck-config.tsx`): faithful renderer that preserves legacy inline styles and only
  (a) resolves `/uploads/*` media via `resolveMediaUrl`, (b) makes media responsive,
  (c) restores `ul/ol` markers and bordered-table (`[border]`/`.MsoTableGrid`) gridlines.
  Renders localized `{vi,en}` body.
- `build-legacy-pages.ts`: after `injectPostIntoPuckData`, swap the `PostBody` node for
  `LegacyHtml` (localized vi+en) and drop post-only chrome (`PostReaderTools`,
  `PostTagList`, `PostEventInfo`).
- `PostBody` itself also now rewrites relative `/uploads/*` img/iframe srcs via
  `resolveMediaUrl` (fixes body images for the ~1600 migrated posts too).
- `download-page-media.ts`: decode each path segment with `decodeURIComponent` (not
  `decodeURI`) so filenames with `&`/`%26` etc. land on disk exactly as express.static
  decodes the request URL (was 404ing `Tầm_nhìn_&_Sứ_mệnh.png`).

**Verified** (Playwright, legacy-vs-new): `nang-luc-dao-tao` table gridlines, `dao-tao-dai-hoc`
red headers + blue bulleted links, `giang-vien-co-huu` faculty photo grid, `tam-nhin---su-mang`
content images — all now match legacy. tsc clean (admin/public/backend).

**Still differs from legacy (site-frame chrome, not page content):** legacy pages have a
hero banner with the title overlaid + a right sidebar ("Danh mục" + "Tin mới nhất"); the
new pages use the post-article frame (title + cover banner, single column, no sidebar).
The post-style breadcrumb still reads "Trang chủ / Tin tức". These can be added if wanted.

## Session 2026-06-28 — Legacy header dropdowns + missing section pages (feat-013, DONE)

**Goal:** mimic the legacy site (phys.hcmus.edu.vn) header nav 1-to-1 on the public
site, and build the section pages each dropdown links to (most were never migrated).

### What was done

1. **Recovered the real legacy header** from the SQL dump (`menus` + `menuslang`,
   filtered `deptid=1, locationid=1, deleted=0, status=1`) — 9 top items + 36 dropdown
   links, VI/EN labels, matches the live site exactly.
2. **Navbar** (`build-legacy-header.ts`): wrote the tree into the homepage (`trang-chu`)
   `Navbar.menuItems`. `SiteHeader`/`SiteFooter` are **syndicated** (fetch `trang-chu`
   at runtime), so this one write propagates the nav to every layout. Exports
   `MENU_ITEMS`, now reused by `seed-homepage-layout.ts` so a fresh seed reproduces it.
3. **Section pages** (`build-legacy-pages.ts`): built **29** PageLayouts (28 missing +
   republished the pre-existing unpublished `viec-lam-nganh-vat-ly`) from legacy
   `pages`/`pageslang`, via the post template (`SiteHeader` + Container + `SiteFooter`)
   using `injectPostIntoPuckData` — reproduces each legacy page (banner + title + HTML
   body) 1-to-1. Slugs = legacy slugs (so navbar links match). Update-or-create by slug.
4. **Media** (`download-page-media.ts`): fetched 180/187 page assets to
   `uploads/legacy/` (2 are broken on the legacy server itself).
5. **Helpers**: `legacy-html.ts` (entity decode + `<img>`/`<iframe>` `/uploads`→
   `/uploads/legacy` rewrite + script/iframe sanitize), `flush-cache.ts` (deletes the
   NestJS `CacheInterceptor` keys in Redis namespace `hcmus-physics` after direct-DB
   writes — wired into both build scripts).

### Verification (all green)

- Playwright screenshot of `/vi`: all 9 legacy top items; "Đào tạo" dropdown lists its
  7 children. EN locale switches labels. No JS console errors.
- All **30** internal nav links resolve to a published PageLayout; 9 external/#/home
  links as expected.
- `gioi-thieu` etc. render header + banner (cover via `resolveMediaUrl`, loads in dev)
  + legacy content + footer.
- `tsc --noEmit` clean. Added `@redis/client@5.12.1` to backend deps (used by flush-cache).

### How to re-run (legacy MariaDB on :3309, db `legacy`, root/root)

```
pnpm --filter backend exec tsx --env-file=.env initialScript/migrate-legacy/build-legacy-header.ts
pnpm --filter backend exec tsx --env-file=.env initialScript/migrate-legacy/build-legacy-pages.ts
pnpm --filter backend exec tsx --env-file=.env initialScript/migrate-legacy/download-page-media.ts
# then revalidate the public site (token in frontend-public/.env):
curl -XPOST localhost:3002/api/revalidate -H "x-revalidate-token: $TOKEN" \
  -H 'content-type: application/json' -d '{"tags":["sitemap","page:trang-chu"]}'
```

### Known limitations / residual risks

- **Inline body images 404 in localhost dev** — pre-existing, site-wide: body HTML is
  rendered raw (not via `resolveMediaUrl`), so relative `/uploads/legacy/...` resolves
  against :3002 not the backend. Identical to all ~1600 migrated post pages; serves in
  prod behind the `/uploads` reverse proxy. (Optional future fix: a `/uploads/:path*`
  rewrite in `frontend-public/next.config.ts` → backend.)
- Section pages use the **post-article template**, so the breadcrumb shows
  "Trang chủ / Tin tức / Chuyên mục" — slightly article-flavored for a static page.
  Acceptable for v1; a dedicated page template could remove it.
- 3 pages have thin text (images/PDF only): `tam-nhin---su-mang`, `to-chuc-nhan-su`
  (org-chart images), `quy-che-hoc-tap` (embedded PDF — iframe src rewritten to local
  so it isn't stripped by PostBodyRender).
- `cat:46` "Câu lạc bộ" (tag merged away in feat-013 category-merge) → links to legacy
  `https://phys.hcmus.edu.vn/cau-lac-bo`.
- Direct-DB writes bypass the service's cache.clear() + public ISR — scripts now flush
  Redis; the public site still needs a tag revalidate (or 1h ISR) to refresh page HTML.

---

## feat-013 plan

Site cũ: PHP custom CMS trên MariaDB 10.6 (dump `phys_db_1781370050.sql.gz`, 5MB gz / 70MB raw). 46 bảng, multi-language (vi+en) qua pattern `xxx + xxxlang`.

### Counts (theo AUTO_INCREMENT)

- posts: ~1944, postslang: ~3411
- categories: ~50, categorieslang: ~101
- pages: ~? , pageslang: ~?
- staffs: ~130
- depts: ~10
- users: ~11
- language: 2 (VI=1, EN=2)

### Decisions chốt với user

1. **Category → relation** (FK) thay vì enum. New `Category` model với `name: Json` localized.
2. **Post i18n → JSON localized** cho `title/body/excerpt` `{vi, en}`.
3. **Media → bulk download** từ `https://phys.hcmus.edu.vn/uploads/...` về sandbox local. Fail-soft trên 404.
4. **No server access** cho legacy box → chỉ dump SQL + HTTP fetch ảnh.

### Phases

| Phase | Status | Description |
|---|---|---|
| P0 Schema design | done | decisions locked above |
| P1 Prisma schema | **done** | migration `20260613171157_categories_and_post_i18n` applied. Category table seeded with 5 defaults (cat_default_*). Post.title/body/excerpt converted text→jsonb via `jsonb_build_object('vi', <old>)`. Existing 67 posts kept, all backfilled to `cat_default_educational`. UserPreference.categories: PostCategory[] → text[]. PostCategory enum dropped. |
| P1 Backend adapt | **done** | post.model.ts: LocalizedTextSchema + UpsertPostBodySchema uses categoryId + title/body/excerpt as Localized. post.service: `asLocalized` + `viOf` helpers; create/update use categoryId + JSONB writes; serialize emits Localized objects; cloneIntoLayout/syncAttachedLayouts now load Category by id to get slug+name; viOf(post.title) for slug + injectPayload. New CategoryModule (controller/service/dto/model) wired into AppModule. `pnpm exec nest build` clean. |
| P2 Frontend adapt | **done** | api.ts: LocalizedText / CategoryRef / Category types added; PostRecord, UpsertPostBody, PostPublicCard now LocalizedText + categoryId; `categoryApi` (list/getById/create/update/remove) added. New `lib/localized.ts` helper (localize/toLocalized/emptyLocalized). `lib/post-categories.ts` rewritten: static color map by slug + buildCategoryOptions(categories, locale). Consumers updated: post-list-view (fetch categoryApi, categoryLabel + localize(title,'vi')), post-composer-view (VI/EN tab switch for title/body/excerpt, categoryId dropdown from categoryApi), news-feed (post.category.slug + post.category.name + categoryColor()), dashboard-view (localize(post.title,'vi')), scheduled-modal (categoryId in payload). frontend-public/lib/api.ts re-export updated. `npx tsc --noEmit` clean for both admin + public. Biome lint admin: 196 warnings (all pre-existing). Backend lint: 0 errors / 83 warnings (all pre-existing). |
| P3 Migration script | **done** | `backend/initialScript/migrate-legacy/run.ts` boots a temp MariaDB 10.6 (Docker), restores the dump, then upserts depts→users→categories→posts into Postgres. Idempotent via `legacyId` (+ id prefix `dept_legacy_*`, `legacy_user_*`, `cat_legacy_*`, `post_legacy_*`). Slug + email collisions dedupe via chooseSlug + counter suffix. Result on current local: 10 departments, 11 legacy users, 45 legacy categories (+ 5 defaults = 50), 1637 legacy posts (+ 67 prior = 1704). Title/body/excerpt stored as `{vi, en}` JSONB. Run instructions in `backend/initialScript/migrate-legacy/README.md`. |
| P4 Media downloader | **done** | `backend/initialScript/migrate-legacy/download-media.ts` scans every migrated post (coverUrl + body[vi/en] `<img src=>`) + categories and downloads everything under `https://phys.hcmus.edu.vn/uploads/...` into `backend/uploads/legacy/`. 6-concurrent fetch loop. Run on current local: 1909 unique paths → 1870 ok, 36 failed (legacy 404s), 3 skipped (already on disk). Total disk: 3.9GB. Then `rewrite-media-urls.ts` rewrote all post.coverUrl, post.body img src, category.image, user.avatarUrl from `/uploads/X` → `/uploads/legacy/X` so the local Nest static-file middleware (`src/main.ts` line 37) serves them. 1636 posts + 7 categories updated. |
| P5 Validation + push | **done** | All five phases committed to `wip/feat-013-legacy-migration`. Backend `pnpm exec nest build` clean. Admin + public `npx tsc --noEmit` clean (modulo `auth-client.ts` which references `better-auth/react`, a pre-existing import from the initial bootstrap commit `7086ace`, unrelated to feat-013). 1704 posts visible via Prisma, 1870 media files under `backend/uploads/legacy/`. Branch pushed: `wip/feat-013-legacy-migration` (commits `e3d8214` P1, `b6361b9` P2, `e568b9e` P3+P4). Ready for review + merge into main. |

## What still needs the user

1. **Real-server QA** before promoting to prod. Boot `pnpm dev`, open `/admin/posts/list`, confirm:
   - Mine tab shows your local-only posts.
   - Published tab shows the 1637 legacy posts.
   - Post composer opens an existing legacy post → title/body show in VI tab, switch to EN tab → English content visible, cover image renders from `/uploads/legacy/...`.
   - News-feed widget shows category color badges (from `categoryColor(slug)`).
2. **Sandbox deploy** (CentOS 7.9, 103.88.121.212:63379, user vlkt) — not attempted this session. The 3.9GB media folder must ship alongside (rsync after build).
3. **SMTP setup** for OTP forgot-password — still deferred from earlier session.
4. **Merge `wip/feat-013-legacy-migration` → main** when QA passes.

## Resume checklist (next session)

1. **Frontend is mid-refactor — fix compile errors first.** `cd frontend && npx tsc --noEmit` will surface the remaining call sites:
   - `src/lib/api.ts` — update PostRecord, UpsertPostBody, PostPublicCard to use LocalizedText + categoryId; add `categoryApi.list/create/update/remove` block.
   - `src/lib/post-categories.ts` — replace static enum-based mapping with dynamic Category fetching helper, OR delete and use Category from API.
   - `src/views/admin/posts/post-list-view.tsx` — categoryLabelVi import + filter + display.
   - `src/views/admin/posts/post-composer-view.tsx` — category select fetches from /categories; title/body/excerpt become 2-tab (VI/EN) inputs.
   - `src/views/admin/dashboard/dashboard-view.tsx` — `post.title` is object; use a localize helper.
   - `src/views/admin/widgets-layout/components/news-feed.tsx` — `post.category` string → category.slug; `CATEGORY_LABELS[post.category]` lookup needs Category data.
2. Add `frontend/src/lib/localized.ts` helper: `localize(value: LocalizedText | string | null, locale: 'vi'|'en'): string`.
3. After FE compiles, write migration script (P3).
4. Test login still works (BE wasn't touched in a breaking way that hits auth, but verify).
5. Spot-check existing 67 posts render — they now have `title: { vi: <original> }`, no `en`. UI must handle absent `en`.

### Touched files estimate

- **Backend** (~10 files): schema.prisma + migration, post.model/dto/service/repo/controller, new category/* module
- **Frontend** (~8 files): lib/localized.ts (new), post-list/post-composer/post-detail/public render, post-categories.ts (dynamic)
- **Migration scripts** (~7 files): all new under backend/initialScript/migrate-legacy/

### Breaking nature

Schema change is BREAKING for any code that reads `post.title` as string. All call sites must use `localized(post.title, locale)` helper. Compile-checked at each phase before moving forward.

## Sandbox info (for deploy phase, after migration)

- IP: 103.88.121.212, OS CentOS 7.9, SSH port 63379, user vlkt
- 4 vCPU / 4 GB RAM / 50 GB disk
- SSH reachability TBD (host unreachable from current WSL — user to test)
- No domain assigned yet → temporary HTTP via IP

## Recent commits (last session)

- da3e399 fix(sidebar): theme switch — slide knob between fixed icons
- ca81539 feat(admin): hover-expand sidebar, theme switch redesign, puck cleanup
- 94ca4ef fix(avatar): use next/image with unoptimized; preload LCP sidebar avatar
- 422f564 fix(settings): department as free-text + resolveMediaUrl on avatars
- ee07a67 feat(settings): /admin/settings profile + change password
- (earlier feat-010 to feat-012 unchanged)

## Active rules

- All toasts Vietnamese only (no Anh-Việt mix). Replace "Password" → "Mật khẩu".
- Verification gate: `pnpm build` (not just vitest) before push — vitest swc skips TS strict.
- One feature at a time per CLAUDE.md harness rule.

## Session 2026-07-10 — Sandbox deployment (Docker, IP-only, no domain)

Deployed the full stack to the teacher-provided sandbox **103.88.121.212** (CentOS 7.9),
Docker via `docker-compose.prod.yml`. SSH: port 63379, user vlkt (scripted with paramiko —
`sshpass` unavailable). Migrated DB transferred dev→box (pg_dump `hcmus-physic` → restore into
box `hcmus_physics`); **1654 posts / 1658 layouts / 10 depts / 15 users / 70 media** verified on box.

### LIVE now (externally reachable over the public IP)
- **Admin  → http://103.88.121.212:3000** ✅ (307→/admin, 200, login works; API on :3001).
- **API    → http://103.88.121.212:3001** ✅ (`/page-layouts/slug/trang-chu` = 200).
- **DB + Redis** ✅ healthy, data in named volumes (survives `down`, NOT `down -v`).
- **Public → http://103.88.121.212:3002/vi** ✅ 200, renders full content + synced Header/Footer.

> **UPDATE 2026-07-10 (later):** deployment is now COMPLETE — all 4 tiers live externally.
> Public was fixed by building the image off-box (dev machine, 820G) and shipping it via
> `docker save | gzip | scp | docker load` (the box's `vfs` driver can't build public without
> exhausting disk). Also fixed the SEO base URL: `NEXT_PUBLIC_SITE_URL` is now a build arg
> (`frontend-public/Dockerfile` + compose), set to `http://103.88.121.212:3002` on the sandbox
> so canonical/OG/JSON-LD use the IP not localhost. Compose file renamed
> `docker-compose.prod.yml → docker-compose.sandbox.yml` (repo + box + thesis ref) since it
> carries a sandbox-specific `seccomp:unconfined` workaround; the eventual prod file is a sibling
> with the domain in `.env` and no seccomp line. **No CI/CD deploy exists** (`.github/workflows/ci.yml`
> is CI-only: lint/build/test + image smoke-build, no SSH/registry/deploy) — the sandbox is deployed
> manually via the image-ship above.
>
> **Puck component rename SiteHeader→Header, SiteFooter→Footer** (user request): renamed the Puck
> registry keys + exports/labels in `puck-config.tsx` + `components/site-syndication.tsx`, migrated
> the stored `puckData`/`publishedPuckData` type strings in **both** dev DB and box DB via
> `backend/initialScript/migrate-legacy/rename-header-footer-puck-types.sql` (1639/1638 rows;
> idempotent + reversible), then rebuilt+shipped admin & public images. Verified live: `/vi` renders
> nav + footer, no "chưa cấu hình" fallback. `multer` add now synced into `pnpm-lock.yaml`
> (CI `--frozen-lockfile` safe).

### 4 real fixes made this session (all in git working tree, UNCOMMITTED on wip/feat-013-legacy-migration)
1. `docker-compose.prod.yml` — `security_opt: seccomp:unconfined` on every service.
   CentOS 7 ships **libseccomp 2.3.1 (2015)**; Docker's default profile returns EPERM for
   syscalls it doesn't know → postgres initdb failed "could not write ...: Operation not permitted".
2. `docker-compose.prod.yml` — mount `./backend/.env:/app/.env:ro` on backend.
   `backend/src/shared/config/config.ts:8` hard-requires a physical `.env` file (else `process.exit(1)`);
   compose `env_file` only injects vars, not a file.
3. `backend/package.json` — added `"multer": "^2.1.1"` to **dependencies**.
   `media.controller.ts:14` imports `diskStorage` from multer; it was only hoisted transitively in
   the monorepo, so the isolated backend Docker build was missing it (`MODULE_NOT_FOUND`).
   ⚠️ pnpm-lock.yaml NOT regenerated locally (backend Dockerfile uses `--no-frozen-lockfile`, so box
   build was fine). Run `pnpm install` at repo root before committing to sync the lockfile.
4. `frontend-public/src/lib/api.ts` + `src/app/sitemap.ts` — SSR now uses `INTERNAL_API_URL`
   (server-only runtime var, set to `http://backend:3001` in compose `public` service); browser keeps
   `NEXT_PUBLIC_API_URL` (public IP); `resolveMediaUrl` ALWAYS uses the public URL.
   Reason: box is behind provider NAT with **no hairpin** — a container cannot reach its own public IP,
   so SSR fetch to `103.88.121.212:3001` timed out → every SSR page 404'd. (extra_hosts can't fix it:
   the value is an IP literal, which the resolver never looks up in /etc/hosts.)

### ✅ RESOLVED (see UPDATE note above) — rebuild + redeploy `public` with fix #4
The public image rebuild on the box **fails on disk**: the `vfs` storage driver (forced because XFS
has `ftype=0` → overlay2 unsupported) balloons disk; the public build (frontend + frontend-public
workspaces) exhausts the 47G disk mid-build ("no space left on device"). Build cache was pruned;
disk currently 79% (11G free).

**Recommended resume (avoids building on the cramped box):** build the public image off-box and ship it —
```
# on a dev machine with the repo + Docker (needs local backend :3001 for the
# sitemap prerender; --network=host so the build can reach Google Fonts + localhost):
docker build --network=host -f frontend-public/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://103.88.121.212:3001 \
  --build-arg NEXT_PUBLIC_SITE_URL=http://103.88.121.212:3002 \
  --build-arg INTERNAL_API_URL=http://localhost:3001 \
  --build-arg NEXT_PUBLIC_IMAGE_FETCH_ORIGIN=http://backend:3001 \
  -t hcmus-cms-public:latest .
docker save hcmus-cms-public:latest | gzip > public.tar.gz     # ~200MB
# transfer to box (scp -P 63379 / paramiko), then on box:
docker load < public.tar.gz
cd ~/hcmus-cms && docker compose -f docker-compose.prod.yml up -d --no-deps public
curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/vi   # expect 200
```
Alternative (bigger job): move /var/lib/docker onto an ext4 loopback so Docker can use overlay2, then
building on-box works normally. Deferred.

### Deferred / notes
- **Media not synced**: 3.9 GB `backend/uploads/legacy` not transferred → body `<img>`/PDFs will 404
  until synced (rsync over the SSH port). Text/layout/data all present.
- **Dept admins must re-login** so their JWT carries `departmentId` (feat-015).
- Box `.env` has a now-unused `API_HAIRPIN_HOST=103.88.121.212` line (leftover from an abandoned
  extra_hosts attempt) — harmless, can delete.
- Scratchpad SSH helpers: `ssh.py "<cmd>" <timeout>`, `upload.py <local> <remote>` (creds hardcoded).

## Session 2026-07-15 — Phụ lục KLTN + phát hiện & sửa lỗi optimizer 400 + khôi phục media sandbox

### Phụ lục (yêu cầu hiện hành của Phương)
- `thesis/07-phu-luc.md` MỚI, theo văn phong quyển mẫu 2213595 ("PHỤ LỤC A: TÊN HOA", tiểu mục "Phụ lục A – 1: …"):
  A = lược đồ CSDL đầy đủ (33 thực thể + 43 quan hệ FK, sinh từ schema.prisma);
  B = 4 màn hình (B-1 danh sách bài đã xuất bản 1607, B-2 quản lý 12 tài khoản bộ môn /admin/admins,
  B-3 bài viết công khai, B-4 trang chủ EN) — `thesis/figures/phuluc-b*.png`;
  C = 5 bước triển khai + bảng nhóm biến cấu hình (không lộ giá trị).
- `merge_kltn.py`: FIG_MAP nhận HÌNH B.n, regex placeholder mở rộng chữ cái, splice phụ lục sau heading
  PHỤ LỤC của template (giữ sectPr cuối mức body). Kết quả: 1142 đoạn, 22 bảng, 5 sectPr, 15 ảnh nhúng.
- 3.3.2 giờ trỏ "Phụ lục A". Login screenshot: dùng Enter thay click (nút bị animation che).

### PHÁT HIỆN QUAN TRỌNG: số V6 của trang bài viết là artifact lần hai
- Nhật ký V6 cho thấy 4/8 ảnh trang bài viết bị **400** từ `/_next/image`: Next 16 mặc định
  `images.qualities=[75]`, mọi q=70 (thân bài)/q=65 (hero) bị từ chối; NGOÀI RA Next 16 chặn optimizer
  fetch từ IP loopback (cần `dangerouslyAllowLocalIP` khi đo local với API localhost).
- Fix code: `qualities:[65,70,75]` (cả 2 next.config), `dangerouslyAllowLocalIP` chỉ khi
  NEXT_PUBLIC_API_URL chứa localhost (public), ảnh bìa PostCoverImage cũng qua optimizer (nó là LCP).
- Đo lại 15/07 (bài viết, trung vị 6 lượt, load-gated): **Perf 68 | LCP 4,21 | TBT 215 | CLS 0,270 | 0,9MB**
  (V6 công bố: 58/6,05/301/1,8MB). 3 trang kia giữ số V6 (phép đo đó không có ảnh lỗi).
  Thesis C4 (Bảng 4.6/4.7 + prose giải trình trung thực), C5 đã cập nhật; benchmark ở `benchmark/v7/`
  (v7b-article + v8-* + v8-final-median.json). Máy đo WSL2 nhiễu tải → script gate loadavg <2.5.

### Sandbox: kho media từng bị MẤT SẠCH (container không mount volume)
- `/app/uploads` trống trên box → mọi ảnh media/legacy 404 (ảnh screenshot B-3 vỡ là do vậy).
- Đã SFTP 517MB uploads.tar (paramiko), giải nén vào ~/hcmus-cms/backend/uploads, thêm bind mount
  `./backend/uploads:/app/uploads` (compose sandbox cả 2 phía), thêm `uploads` vào backend/.dockerignore
  (thiếu nó, context build phồng 542MB làm vfs cạn đĩa — một lần build fail "no space").
  Recreate backend KHÔNG --build → media 200 ✓. KHÔNG chạy `docker compose down -v` trên box.
- Đang ship image public mới (đã build off-box, docker save|gzip|scp|load) để sandbox có fix qualities;
  sau đó chụp lại phuluc-b3.

### Còn lại phiên sau nếu dở dang
- Nếu B-3 chưa chụp lại: bài usactalk trên sandbox sau khi public mới lên.
- Commit cuối gồm: thesis md + 07-phu-luc + figures + merge_kltn + next.config×2 + post-placeholders
  + docker-compose.sandbox + .dockerignore + benchmark/v7 + progress.md.

### Bổ sung 15/07 (đêm): lỗi font toàn site + giữ docx của Phương
- Phương phát hiện ảnh B-3 "lỗi font" → truy ra lỗi THẬT của site: shared.css khai
  `--font-sans: var(--font-sans)` (tự tham chiếu → rỗng) và áp font-sans ở <html> trong khi
  biến --font-geist-* nằm trên <body> → cả admin + public hiển thị Times New Roman với mọi
  người dùng từ trước đến nay. Fix: map --font-geist-sans + chuyển font-sans xuống body.
  Ship lại CẢ HAI image (admin build off-box giống public). Chụp lại 7 ảnh (3.7–3.9, B-1..B-4).
- Quy trình docx: Phương yêu cầu giữ nguyên bản họ đang có → lấy Downloads hiện tại làm TPL
  (diff body chỉ là Word evaluate mục lục, không có sửa tay); regen + copy lại. Lighthouse
  không đo lại: font woff2 vốn đã được tải trong các lần đo (chỉ không được áp), LCP là ảnh.

## Session 2026-07-15 (tối) — Chuẩn bị demo Thứ 6 17/07

### Đã xong
- **Media sandbox: phủ 100%** — 3162/3162 file khớp local↔box (diff C-locale, 0 thiếu 0 thừa);
  spot-check URL legacy (dấu, khoảng trắng, NFC) đều 200. KHÔNG cần sửa DB cho media thường
  (toàn đường dẫn tương đối /uploads/...).
- **2 tài khoản demo/e2e** (đều verify đăng nhập + đúng quyền qua Playwright):
  - SUPER_ADMIN mới: `demo.superadmin@hcmus.edu.vn` / `Demo@Ab9trMxtjwno` (INSERT trực tiếp, bcrypt cost 10, id demo_superadmin_2026)
  - Bộ môn VLUD (e2e): `vlud_admin@hcmus.edu.vn` / `E2e@Ad8OJT6BmLSx` (reset hash; dept_legacy_6)
  - Lưu ý acc mới: tab "Bài của tôi" = 0 là ĐÚNG (chưa viết bài); tab "Đã xuất bản" đủ 1607.
    Tour onboarding sẽ tự chạy lần đăng nhập đầu (feature) — biết trước để khỏi bối rối khi demo.
- **QA sweep**: public 7 trang (5 sạch tuyệt đối; trang chủ vi/en + landing bộ môn dính đúng 2 ảnh
  vỡ — xem Pending); admin 8 màn hình với acc mới: 0 lỗi console, 0 ảnh vỡ, 0 HTTP fail;
  log backend/public 24h sạch; đĩa 18GB trống, RAM ổn, containers Up.
- **Mirror hotlink đã dựng sẵn** (chưa kích hoạt): 281/283 file tải từ phys.hcmus.edu.vn (2 file 403
  ngay tại nguồn) → 408MB đã nằm ở `~/hcmus-cms/backend/uploads/legacy-mirror` trên box;
  map JSON + script rewrite (`~/rewrite-mirror.js`, `~/mirror-map.json`) đã ở trên box;
  backup 3 bảng: `~/backup-pre-mirror-20260715.sql.gz`.

### PENDING — cần Phương duyệt (auto-mode chặn thao tác ghi lên box)
1. **Rewrite 281 hotlink → /uploads/legacy-mirror/...** trong PageLayout/Post/Media (docker exec node
   /tmp/rewrite-mirror.js). Lý do: hero trang chủ đang phụ thuộc site cũ lúc demo.
2. **Sửa 2 cover chết** (di trú map thiếu — file thật CÓ trên đĩa):
   - `/uploads/legacy/vat-ly-tin-hoc/Nghe%20nghiep/image001.png` → `/uploads/legacy/khoa-vat-ly/TUI_LA_NGU/TIN_TUYỂN_DỤNG/TMA.jpg` (bài TMA internship)
   - `/uploads/legacy/vat-ly-tin-hoc/H%E1%BB%99i%20th%E1%BA%A3o/1351.jpg` → `/uploads/legacy/khoa-vat-ly/Hoi thao Nganh moi/1351.JPG` (đúng bài hội thảo đó)
   Ảnh hưởng: Post.coverUrl 2 bài + snapshot trong 23 layout (trang chủ + landing bộ môn).
3. **Cổng 80 → public** (compose thêm "80:3002" + firewall-cmd add-port 80) để demo gõ IP trần.
Sau khi chạy 1–3: flush Redis (docker exec hcmus-cms-redis-1 redis-cli FLUSHALL), verify lại 3 trang.

### Rollback
`gunzip -c ~/backup-pre-mirror-20260715.sql.gz | docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_physics`

### CHECKLIST DEMO THỨ 6 (17/07) — cập nhật 15/07 tối
**URL:**
- Gõ trần `http://103.88.121.212` → tự về /login (còn token 7 ngày thì vào thẳng /admin)
- Public: `http://103.88.121.212:3002/vi` | Admin: `:3000` | API: `:3001`
**Tài khoản:** demo.superadmin@hcmus.edu.vn / Demo@Ab9trMxtjwno (toàn quyền) · vlud_admin@hcmus.edu.vn / E2e@Ad8OJT6BmLSx (bộ môn VLUD — demo phân quyền)
**Lưu ý:** lần đăng nhập ĐẦU của demo.superadmin sẽ bật tour onboarding (đăng nhập trước 1 lần nếu không muốn hiện lúc demo). Refresh token 7 ngày → login trước Thứ 6 là auto-vào.
**Đã làm hôm nay:** media 100% (3162 file); 281 hotlink site cũ → mirror trên box (backup: ~/backup-pre-mirror-20260715.sql.gz); 2 cover chết map lại file thật; cổng 80 → admin; CORS thêm origin trần; widget components resolve /uploads qua media-src.ts (fix ảnh tương đối + optimizer nội bộ backend:3001).
**Khôi phục nhanh nếu box restart:** `cd ~/hcmus-cms && docker compose -f docker-compose.sandbox.yml up -d`
**Rollback DB:** `gunzip -c ~/backup-pre-mirror-20260715.sql.gz | docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_physics`

## Session 2026-07-16 (đêm) — 11 mục mismatch trước demo: XONG HẾT, sandbox sạch
1✓ Editor ảnh: absolutize khi nạp/relativize khi lưu (markdown-editor.tsx); img rỗng còn lại là artifact của tiptap-extension-resize-image (vô hình, không phải bug). 2✓ Back arrow trái tiêu đề composer. 3✓ View live đọc NEXT_PUBLIC_SITE_URL (Dockerfile+compose arg; PROD chỉ đổi env). 4✓ favicon (app/icon.png huy hiệu) + title/og đổi theo locale. 5a✓ withLocale cho mọi href navigation + hero/content CTA. 5b✓ bài body rỗng ẩn khỏi 3 query public (Prisma.DbNull) + notice khi vào thẳng; đã check site cũ không public bài đó. 6✓ 2 card xám = bài rỗng (tự ẩn); script backfill-covers 0 ứng viên thật. 7✓ copy fallback execCommand (HTTP), FB sharer mở tab. 8✓ sidebar Danh mục = categoryApi. 9✓ search overlay sống (debounce /posts/public/list) + prune-dead-nav.js gỡ menu chết (nha-tuyen-dung, cuu-sinh-vien, lien-he…); map /bo-mon/*→slug thật, /nhan-su/*→doi-ngu, /nghien-cuu→nghien-cuu-khoa-hoc. 10✓ hoc-bong: Header/Footer đồng bộ, widget ScholarshipList (search+phân trang, category hoc-bong), bỏ SubscribeBanner email, giữ TagNotificationBar; publish. 11✓ sweep: 0 link chết, 0 ảnh vỡ, 0 console error (8 trang + crawl 25 link vi/en).
- QUAN TRỌNG: **self-host fonts** (public/fonts + fonts.css cả 2 app, bỏ next/font/google) vì mạng Google đứt làm build fail liên tục; proxy.ts phải exclude /fonts. Backend Dockerfile heap 3GB (nest build OOM 2GB).
- Scripts trên box: /tmp trong container backend (backfill-covers, prune-dead-nav, revamp-hoc-bong). Seed SCHOLARSHIP_PUCK_DATA trong repo CHƯA cập nhật theo layout mới (làm sau, sandbox là nguồn hiện hành).

## Session 2026-07-16 (khuya) — chuông thông báo in-app + CD (GHCR auto-deploy)
- **Chuông thông báo** (`notification-bell.tsx`, gắn trong Navbar desktop lg+ và mobile bar):
  theo dõi chủ đề = category thật; localStorage `notif:subs` {slug: watermark}. Vào web đối
  chiếu bài mới hơn watermark → badge + tự bung 1 lần/phiên (sessionStorage `notif:autoPopped`).
  Bài di trú trùng timestamp → khi theo dõi hiện thẳng top-3 mới nhất, watermark = ngày mới nhất
  (bài đăng SAU đó mới báo). Verify sandbox: theo dõi "Tuyển dụng" → badge 3 + 3 bài. Prop
  `showNotificationBell` mặc định bật (Header đồng bộ không cần đổi DB).
- **ScholarshipList** đổi sang lọc theo keyword "học bổng" (category hoc-bong/scholarship rỗng do
  di trú gán rải) → ~83 bài. Seed hero học bổng đã localize.
- **CD** (`.github/workflows/deploy.yml` + `docker-compose.deploy.yml` + `deploy/CD.md`): push main →
  build 3 ảnh ở runner → GHCR → SSH box pull+up+`db push`+flush → smoke test /vi. db-setup CHỈ db push
  (không re-seed → không ghi đè nội dung live). Enabler: `sitemap.ts` timeout 8s (hết treo build),
  root `.dockerignore` bỏ thesis/benchmark/docs, font đã self-host. CHƯA active — cần đặt secrets/vars
  + GHCR pull token + deploy SSH key + merge lên main (xem deploy/CD.md). Chạy trên nhánh wip hiện tại.

## Session 2026-07-16 (chiều) — sửa chồng layout + thiết kế lại thông báo học bổng
- **Chồng nội dung** trang legacy 2 cột (vd tuyen-sinh-dai-hoc "ADMISSION TARGETS"): bảng rộng
  đè sidebar → thêm `overflow-x-auto` vào `<main>` trong legacy-page.tsx. Verify: main.right 944 <
  aside.left 976, hết overlap, bảng cuộn ngang trong cột.
- **List học bổng trống**: layout live để categorySlug='hoc-bong' (chuyên mục rỗng — bài học bổng
  di trú nằm rải chuyên mục khác). Chuyển ScholarshipList sang lọc theo **keyword "học bổng"** (~83 bài).
- **Thiết kế lại (theo yêu cầu)**: ScholarshipList = **infinite scroll** (IntersectionObserver, bỏ phân
  trang; verify 9→45 khi cuộn) + **chuông góc trên phải** cạnh ô tìm kiếm; bấm → **toast** "Đã cài đặt
  nhận thông báo của \"Học bổng\" — sẽ nhắc bạn khi có đợt mới" (bấm lại để tắt). Bỏ TagNotificationBar
  faded khỏi layout hoc-bong.
- **Mô hình thông báo hợp nhất** `notif-subs.ts` (NOTIF_TOPICS: 4 category + "Học bổng"=keyword;
  read/writeSubs localStorage `notif:subs`) — chuông header và chuông trang học bổng đọc/ghi CHUNG,
  theo dõi ở đâu cũng báo. notification-bell.tsx viết lại theo TOPICS cố định (không fetch /categories).
- Layout hoc-bong live cập nhật qua ship-hoc-bong-v2.js (content: Header,HeroFullScreen,ScholarshipList,Footer).
  Seed đồng bộ. Docx Hình 3.9 đã thay ảnh trang chủ mới (có chuông) ở phiên trước.

## 26/07/2026 — Slide bảo vệ v3 + sửa spec phân quyền
- Slide bảo vệ 17 trang (Downloads/KLTN_SLIDES_TRANHOAIPHUONG.pptx) theo góp ý cô: thêm ảnh minh họa (web cũ, staff accounts), screenshot test thật, TLTK, viết gọn, framing "vì sao thay hệ cũ đang chạy".
- `backend/src/shared/helpers.spec.ts`: cập nhật 3 kỳ vọng theo hành vi mới isFacultyWide (gộp vai trò văn phòng khoa vào faculty-wide) → vitest 40/40 pass. Thay đổi nằm trên branch wip/feat-013-legacy-migration, chưa commit.

## 01/08/2026 — Dứt điểm handoff còn lại (#65, #69, #70, #74, #110, #111, ProfileCard)

Làm theo `HANDOFF-remaining-fixes.md` (đã xoá sau phiên này); commit `eed89d7`.

- **#65 — Xóa vĩnh viễn**: thêm `DELETE /posts/:id/purge` (`post.controller.ts`) →
  `PostService.purge()` chỉ nhận bài ĐÃ ở thùng rác (`deletedAt != null`), scope theo
  phòng ban giống `restore`, xoá cứng post + pageLayout + postTag trong 1 transaction
  (theo mẫu `purgeExpiredTrash`), rồi `cache.clear()` + revalidate. FE: `postApi.purge`
  và nút đỏ có xác nhận trong tab thùng rác (`post-list-view.tsx`).
- **#69 — ICEBA 2023/2024**: handoff ghi sai đường dẫn — `/vi/iceba2023` trả 200 nhưng
  đó là **soft-404 của Joomla** (giống hệt `/vi/khong-ton-tai-abcxyz`). Trang thật nằm ở
  `/ICEBA2023/` và `/ICEBA2024/` (viết HOA, top-level), là **SPA Create React App**.
  Mirror qua `asset-manifest.json` (liệt kê đủ mọi asset): 141 + 174 file, **0 thiếu**.
  Đóng gói rồi tạo StaticPage qua đúng API (`POST /static-pages` → `/:id/bundle` →
  publish). Đã verify: `/ICEBA2023`, `/ICEBA2024` trả 200 đúng title, và index.html +
  main.js + main.css + media trong bundle đều 200. `/ICEBA2025/` trên site cũ là 404 thật
  → giữ nguyên như quyết định trước đó (2025 & 2026 để nguyên).
- **#74 — ảnh LaTeX vỡ**: 3 ảnh phương trình hotlink từ mathworks.com. Đã kiểm chứng
  **403 cứng** cả từ box lẫn từ máy local → không load được và cũng **không mirror được**.
  Alt còn giữ LaTeX gốc nên `replaceBrokenMathImages()` dựng lại tại chỗ bằng chữ nghiêng
  + dấu phụ Unicode (`$\widehat{d}(n)$` → *d̂(n)*), không thêm thư viện toán. Chỉ áp dụng
  cho `<img>` vừa trỏ host NGOÀI vừa có alt dạng `$…$`. Toàn DB chỉ 1 trang dính.
- **#70 — thụt đầu dòng**: nguyên nhân là chuỗi `&nbsp;` ngay sau `<p>` (có khi trong span
  lồng). Trình duyệt vẽ ra khoảng thụt, Tiptap thì bỏ → web ≠ editor, **và chỉ cần ai đó
  mở trang bằng chế độ trực quan rồi lưu là thụt biến mất vĩnh viễn**. Theo quyết định của
  Phương: bỏ thụt ở web cho khớp editor (`LEADING_NBSP_RE`). Lookahead chừa đoạn đệm
  `<p>&nbsp;</p>` để không mất khoảng cách dọc.
- **#111 — MSSV xuống 2 dòng**: `markNumericCells()` đánh dấu `data-num` cho ô CHỈ chứa
  dãy 4-12 chữ số; CSS cho ô đó `overflow-wrap: normal` (thà tràn nhẹ còn hơn bẻ đôi số).
  Ô chữ (tên đề tài, họ tên) vẫn wrap như cũ.
- **ProfileCard**: `onError` → nhớ ĐÚNG url hỏng (không dùng cờ boolean) nên đổi ảnh khác
  là tự thử lại, khỏi cần effect reset. Ảnh 404 rơi về ô placeholder thay vì khung trắng to.

### Punch-list bàn giao cho khoa (không sửa bằng mã được)
- **#110 — 2 ảnh có tên in sẵn** (Phương quyết định để khoa gửi ảnh mới, KHÔNG tự cắt):
  `/uploads/vat-ly-dien-tu/Nhân Sự/thayHuy.png` ("TS. Hồ Thanh Huy") và
  `/uploads/vat-ly-dien-tu/Nhân Sự/thayHien.png` ("ThS. Phạm Xuân Hiển").
  11 ảnh VLĐT còn lại đã soát: sạch. (Nếu đổi ý, cắt 60px dưới là hết trùng tên.)
- **34 asset mất thật** trên tổng 3247 tham chiếu (98,9% còn nguyên) — site cũ cũng không
  còn. Danh sách đầy đủ: chạy lại `missing_assets.sh` hoặc xem tóm tắt: 13 ảnh
  `CTSV/SHCD cuoi khoa`, 5 ảnh `Tan sinh vien 2020`, 11 ảnh vat-ly-tin-hoc
  (Hội thảo/Nghề nghiệp/Tin giáo vụ/PPT bảng điểm), 2 PDF (Viettel tuyển dụng 05/2025,
  Danh_sach_khoa_luan_K18_HĐ_SV), 3 ảnh lẻ.

### Lưu ý môi trường
- `pnpm run lint` (backend eslint) **OOM ở heap 2GB mặc định** khi stack docker boompay-api
  đang chạy (~4,2GB). Chạy được với `NODE_OPTIONS=--max-old-space-size=5120`. Các lỗi
  prettier còn lại nằm trong mã CŨ (`cloneIntoLayout`, `purgeExpiredTrash`…), không phải
  mã mới; `tsc --noEmit` của frontend sạch.
- Box **không hairpin được domain của chính nó** — test public phải gọi `localhost:3002`,
  không gọi `https://phys.hcmus.edu.vn` từ trong box (curl treo/trả 000).
- Box chỉ có python2 và **không có `zip`**; đóng gói bundle bằng `adm-zip` trong container
  backend (`docker cp` vào/ra).

---

## 2026-08-22 — feat-017: API hồ sơ khoa học (backend)

### Kiến trúc đã chốt (sau 3 lần chỉnh với Phương)
Web Khoa **giữ toàn bộ dữ liệu công bố** và trả ra qua API bảo mật. App
`profile.phys.hcmus.edu.vn` là **source riêng, stack tự chọn**, không có CSDL riêng —
nhờ vậy không phải nằm trong pnpm workspace, không phải mirror `lib/api` + `lib/i18n`.
**ACADsoom là KHÁCH của API này**, không phải nguồn: nó nhận dữ kiện rồi tự quy đổi giờ
bằng `nv2Hours.js` sẵn có (đúng nguyên tắc nó tự đặt cho PHYsoom — hệ nguồn không tự quy đổi).

Chi tiết: `docs/ho-so-khoa-hoc.md`.

### Quyết định nghiệp vụ ảnh hưởng tới mã
- **Q1–Q4 tác giả tự chọn.** Không nạp bảng xếp hạng SCImago/WoS/CORE. `catalogCode = null`
  nghĩa là chưa phân loại, và **API tích hợp không trả bài đó** → không lọt vào KPI. Luật
  "không chỉnh thì không được tính" là ràng buộc dữ liệu, không phải lời nhắc trên giao diện.
- **Một bài dùng chung cho cả nhóm.** Gom theo DOI: khai lại DOI đã có thì KHÔNG tạo bản thứ
  hai, chỉ gắn thêm người gọi. Nếu để mỗi người một dòng thì trang nhân sự hiện ba bản và
  thống kê Khoa đếm ba lần.
- **Xác nhận tác giả.** Người tự khai → CONFIRMED ngay. Người bị đồng nghiệp gắn tên → PENDING
  cho tới khi chính họ bấm đồng ý. Không ai xác nhận thay người khác được.
- **Khớp tên không đoán bừa.** Ba mức: ORCID → dạng tên đã đăng ký → giống lỏng. Cả ba đều chỉ
  là GỢI Ý. Rút từ đợt tự động trích email của trang nhân sự: suy đoán sai trên dữ liệu thật
  tốn công sửa hơn hẳn để người dùng tự chọn.

### Bản vá bảo mật đi kèm — BẮT BUỘC deploy trước khi tạo tài khoản LECTURER
`src/shared/guards/roles.guard.ts` có hai chỗ sẽ thành lỗ hổng ngay khi thêm vai trò ngoài:
1. `if (!requiredRoles) return true;` — route không ghi `@Roles` cho qua **mọi** tài khoản đã
   đăng nhập. Hàng trăm route quản trị chưa từng gắn `@Roles`.
2. `isFacultyWide` xét `!user.departmentId` mà không xét vai trò → giảng viên không gắn bộ môn
   **thừa hưởng quyền toàn Khoa**, thoả mọi cổng `@Roles(SuperAdmin)`.

Đã vá: mặc định chặn mọi vai trò ngoài `ADMIN_ROLES`, và `isFacultyWide` phải là admin trước.
Hôm nay chưa phải lỗ hổng (chỉ có ADMIN/SUPER_ADMIN, và đó là chủ ý cho admin văn phòng khoa),
nhưng là mìn đã cài sẵn. 12 test trong `roles.guard.spec.ts` khoá lại cả hai hành vi.

### Kiểm chứng đã chạy (cục bộ)
- `tsc --noEmit -p tsconfig.build.json` — sạch (đường build thật)
- `eslint src/scholar/**` — 0 lỗi, 2 cảnh báo (đúng mức của guard sẵn có đọc `request`)
- `vitest run` — **82/82 qua, 7 file**: 12 test RolesGuard, 17 test bộ đọc .bib/.ris/CSL-JSON,
  12 test khớp tên tiếng Việt, cộng 41 test cũ vẫn xanh
- `prisma generate` chạy lại sau khi thêm model

### CHƯA làm
- Migration **chưa chạy trên box**: `backend/prisma/migrations/20260822_scholar_profile/migration.sql`
  (cộng thêm + idempotent; có `ALTER TYPE "Role" ADD VALUE 'LECTURER'`)
- Chưa có giao diện app; chưa có adapter bên ACADsoom; chưa có holder Puck `StaffPublications`
- Chưa đặt `ACADSOOM_SYNC_SECRET` và `CROSSREF_MAILTO` trong env của backend
- Chưa có DNS cho `profile.phys.hcmus.edu.vn` (IT phải tạo bản ghi A về 103.88.121.212)

### Còn tồn đọng từ trước (chưa đụng tới phiên này)
- Đợt deploy gộp: gallery lightbox + nút "Thông tin layout"
- `set-department-category.ts cau-lac-bo Club` và `... doan-hoi doan-hoi-sinh-vien`
- ~8 liên kết mailto gắn cờ "cần xem tay"

### Đã deploy 2026-08-22
Backend lên box (`build-deploy.sh be`) và migration đã chạy: 4 bảng + enum `Role` có `LECTURER`.
Thứ tự đúng — backend đã vá guard lên TRƯỚC khi CSDL biết tới `LECTURER`, nên không có
khoảng hở nào.

Kiểm chứng từ ngoài: `/be/scholar/me` → 401 (route lạ trả 404, nên 401 chứng minh route có
thật); `/be/integration/publications` → 503 đúng thông điệp thiếu khoá; `/be/categories` và
`/be/posts/public/{latest,list,upcoming-events}` → 200 có dữ liệu; trang chủ → 200.

**Lưu ý cho phiên sau:** `docker build` lấy từ THƯ MỤC LÀM VIỆC chứ không lấy từ git, nên
mã chưa commit vẫn deploy được. Đã xảy ra lần này. Nhớ commit ngay sau khi deploy, không thì
box chạy thứ không có trong lịch sử.

### Bẫy triển khai đã vấp (2026-08-22)
- **Sửa `backend/.env` → phải RECREATE container**, không phải `restart`. Biến môi
  trường gán lúc TẠO container; `restart` chỉ khởi động lại tiến trình với env cũ.
  `docker compose -f docker-compose.sandbox.yml up -d --no-deps --no-build --force-recreate backend`
- **Thêm script mới vào `initialScript/` → phải `docker cp` hoặc build lại image.**
  `push-full.ps1` chép mã lên BOX, nhưng `initialScript/` được nướng vào image lúc
  build chứ không mount volume, nên container vẫn giữ bản cũ.
  Thứ tự đúng: recreate trước, `docker cp` sau (recreate là mất file vừa cp vào).
- **`deploy/build-deploy.sh` chạy trên máy Windows (Git Bash), KHÔNG chạy trên box.**
  Nó build image bằng Docker ở máy rồi sftp lên. PowerShell không chạy được `.sh` —
  gõ trong PowerShell thì nó trả prompt về, im lặng, không báo gì.
- **Trang chưa dựng bao giờ có thể 502 ở lần mở đầu tiên** (Next render ~39s, Caddy
  hết kiên nhẫn trước). Gọi lại thì 0,2s. Không phải sự cố.

### Nguồn nhân sự: PHYsoom, không phải trang web
Trang nhân sự trên web Khoa chỉ là bản chép lại và thiếu email của hơn nửa số người
(42/108 khi đọc CSDL, 69 người khi cào trang thật). PHYsoom có đủ **136 người**, tất
cả đều có MSCB, qua `/api/integration/members?client=physprofile`.
Đã cấp `PHYSPROFILE_SSO_SECRET`, `PHYSPROFILE_SYNC_SECRET`, `PHYSPROFILE_ORIGIN` và
thêm `physprofile` vào `SSO_CLIENTS` trên PHYsoom (chỉ biến môi trường, không sửa mã).

**Tên client SSO không được có gạch ngang** — PHYsoom chặn ở
`CLIENT_NAME = /^[a-z][a-z0-9]{1,31}$/` vì tên đi thẳng vào tên biến môi trường.
Repo và tên miền vẫn là `phys-profile`; định danh SSO là `physprofile`.

### Bẫy proxy: content-encoding (2026-08-22)
App `phys-profile` trên Vercel proxy `/be/*` sang backend qua route handler. Mọi lời
gọi từ TRÌNH DUYỆT đều `Failed to fetch`, trong khi curl và gọi thẳng box đều xanh.

Nguyên nhân: trình duyệt gửi `accept-encoding: gzip` → backend nén phản hồi → `fetch`
trong route handler **tự giải nén** thân → nhưng header `content-encoding: gzip` bị
chép nguyên sang phản hồi trả về. Trình duyệt thấy nhãn "đã nén" trên thân không nén
→ giải mã thất bại, chỉ báo `Failed to fetch` không kèm lý do.

**Viết proxy thì phải bỏ `content-encoding` (và `content-length`) khỏi phản hồi.**

Vì sao dò lâu: curl không gửi `accept-encoding` nên backend trả về không nén, và gọi
thẳng box thì không qua proxy — cả hai phép thử đều xanh. Trước khi tìm ra, đã đi
nhầm sang nghi tường lửa (iptables sạch: `-P INPUT ACCEPT`, không luật INPUT nào),
nghi DNS (chỉ có A, không AAAA), nghi nguồn tra cứu chậm (Crossref/OpenAlex/DataCite
đều < 2s từ box). Bằng chứng đã đủ để nghi proxy sớm hơn.

Cũng trong lúc dò: `rewrites()` của Next KHÔNG dùng được cho đích ngoài ở đây —
bộ định tuyến biên Vercel bắt tay TLS với phys.hcmus.edu.vn thất bại
(`ROUTER_EXTERNAL_TARGET_HANDSHAKE_ERROR`, hkg1), trong khi `fetch` từ hàm máy chủ
(iad1) tới đúng địa chỉ đó trả 200 trong 1 giây. Nên proxy phải là route handler.

### Báo thay đổi cho app khác: webhook + quét lại (2026-08-22)
Yêu cầu ban đầu là **MQTT**. Đã bỏ, vì lý do kỹ thuật chứ không phải tiện tay: ACADsoom
và PHYsoom chạy serverless trên Vercel, mỗi hàm chỉ sống theo một request nên **không
giữ nổi kết nối để subscribe**. Dựng broker lên sẽ không có ai nghe. (Đã lỡ thêm gói
`mqtt` vào `backend/package.json` rồi gỡ ra — hiện không thêm phụ thuộc mới nào; bộ
phát chỉ dùng `node:crypto` và `fetch` có sẵn.)

**Và webhook một mình KHÔNG đảm bảo đồng bộ.** Gói tin mất được: bên nhận đang deploy,
hàm nguội quá 8 giây, mạng rớt, hoặc backend khởi động lại giữa lúc gửi. Thử lại chỉ
giảm xác suất, không khử. Nên chia hai việc:

- **Webhook = cú hích cho nhanh.** `EventBusService` POST tới `EVENT_WEBHOOKS`, thử lại
  3 lần (0s → 2s → 15s), ký HMAC-SHA256 bằng `EVENT_WEBHOOK_SECRET`. Gặp 4xx dừng ngay
  (lỗi cấu hình). Hỏng hẳn thì bỏ, ghi nhật ký một lần. Gói tin **mỏng** — loại, id,
  `userIds` — không kèm nội dung, vì đường này không phân quyền theo người dùng và
  payload dày sẽ lệch với CSDL ngay lần cập nhật sau.
- **`?since=` = chỗ bảo đảm.** `/integration/publications` và `/integration/projects`
  nhận `since` + `limit`, trả phần đã đổi từ mốc đó kèm `nextSince` / `hasMore`, và
  **kèm cả bản ghi đã hết hiệu lực** (`removed: true` khi xoá bài / rút phân loại / rút
  xác nhận). Không trả mấy cái đó thì bên nhận không có đường nào biết mà bỏ đi. Bên
  nhận gọi khi có webhook VÀ theo lịch → mất hết webhook thì lần quét sau vá lại.

Hai chỗ dễ sai đã xử lý trong `integration-cursor.ts`: mốc đổi của một dòng là
`max(updatedAt của dòng, updatedAt của bài)` — sửa quartile không đụng dòng tác giả, đọc
sai mốc là bỏ sót; và **không cắt trang giữa chừng một mốc thời gian** — cắt thì `gte`
đưa lần quét sau về đúng chỗ cũ và không bao giờ tiến, còn nhích mốc lên 1ms thì mất
phần còn lại. Lấy trọn mốc rồi mới dừng.

Đã nối `emit()` vào: tạo/sửa/xoá công bố, phản hồi xác nhận, sửa hồ sơ, tạo/sửa/xoá đề
tài, lưu + sinh lại trang nhân sự. Kiểm chứng: tsc sạch, eslint 0 lỗi (đã sửa luôn 3
lỗi `no-base-to-string` có sẵn ở `staff-page.service.ts` — `String(p.photo ?? '')` có
thể ra `[object Object]`), vitest 103/103 (9 tệp, +8 test cho bộ cắt trang).

### Sự cố 2026-08-22 13:34 UTC: ổ docker đầy → Postgres vòng lặp PANIC
Sau khi deploy backend, **toàn bộ trang có dữ liệu trả 500**. Không phải do mã nguồn.

`/var/lib/docker` (loopback 32G RIÊNG) **đầy 100%, 0 byte**. Postgres không ghi nổi
`pg_logical/replorigin_checkpoint.tmp` → `PANIC` → postmaster khởi động lại → recovery
→ PANIC, lặp khoảng 2 lần/giây trong 5 phút. Mọi truy vấn nhận `57P03`.

Dọn: `docker image prune -f` chỉ đòi lại **966MB** (ảnh dùng chung tầng nên số
"reclaimable 10.6GB" là ảo). Thứ thật sự ôm chỗ là **cache dựng ảnh 9.67GB** —
`image prune` KHÔNG đụng tới nó. `docker builder prune -f --keep-storage 2GB` đòi lại
**16.36GB**, ổ về 38%, Postgres tự phục hồi trong vài giây, không mất dữ liệu.

Hai chỗ đã vá để không lặp lại:

1. `deploy-sandbox.py` trước đây **chỉ kiểm tra ổ gốc `/`**. Hôm đó `/` còn 2.2G nên
   kiểm tra cho qua, trong khi loopback đã cạn — `docker load` ghi vào loopback chứ
   không ghi vào `/`. Nay đòi `/var/lib/docker` còn ít nhất `max(3× gói, 4000MB)` và
   dừng kèm hướng dẫn dọn. Bước dọn sau deploy cũng thêm `builder prune`.
2. Healthcheck của db là `pg_isready -U physics` **thiếu `-d`**, nên nó nối vào CSDL
   trùng tên user (`physics`, không tồn tại) → một dòng `FATAL` mỗi 5 giây, ~17k
   dòng/ngày. Vẫn báo "healthy" nên không ai để ý, nhưng lúc sự cố thật thì đống rác
   đó che mất dòng log cần đọc. Đã thêm `-d ${POSTGRES_DB}`.

**Áp dụng healthcheck mới cần dựng lại container db** — chưa làm, để lần bảo trì có
kế hoạch, không đụng vào lúc vừa phục hồi.

### Lỗi migration: sửa tệp đã chạy rồi (2026-08-22)
Màn Đề tài đổ lỗi `column ProjectMember.showOnWeb does not exist` dù tệp migration
trong kho mã có dòng `ALTER TABLE ... ADD COLUMN "showOnWeb"`.

Nguyên nhân: dòng đó được **nối thêm vào `20260822c_research_project` sau khi
migration này đã chạy trên box** (commit `dda5cf6`, trong khi `20260822c` chạy ở
`65a85fd`). Migration đã áp dụng thì phần thêm vào không bao giờ được chạy — nó được
ghi nhận "đã xong" theo tên nên bị bỏ qua; nếu có đối chiếu checksum thì còn tệ hơn,
lần chạy sau báo lỗi "đã bị sửa sau khi áp dụng".

**Quy tắc: migration đã chạy là bất biến. Thêm gì thì tạo tệp mới.** Đã tách ra
`20260822d_project_show_on_web/migration.sql` và trả `20260822c` về đúng nội dung lúc
chạy. Chạy `20260822d` trên box là màn Đề tài hết lỗi (cộng thêm, chạy lại được).

### Gỡ Ollama (2026-08-22)
Chatbot đã chuyển sang Gemini cho **cả embedding lẫn câu trả lời**
(`backend/src/chatbot/{embedding,llm}.service.ts` chỉ đọc `GEMINI_API_KEY`).
Kiểm chứng: quét cả kho mã, `ollama` chỉ còn xuất hiện ở hai tệp compose và một
dòng chú thích trong `embedding.service.ts` nói chính nó đã bị bỏ. Không mã nào
đọc `OLLAMA_URL`.

Nhưng dịch vụ vẫn chạy nhiều tuần sau đó, giữ **4.77GB ảnh + 672MB model** trong
ổ docker 32G, cộng `OLLAMA_KEEP_ALIVE: -1` (giữ model trong RAM vĩnh viễn) trên
box 3.7GB RAM. Đây là một phần lý do ổ đầy.

Đã gỡ khỏi cả `docker-compose.yml` và `docker-compose.sandbox.yml`: service,
`depends_on`, biến `OLLAMA_URL`/`OLLAMA_MODEL`/`HF_CACHE_DIR`, và khai báo volume
`ollama_models`/`hf_cache`. **Gỡ khai báo volume KHÔNG xoá dữ liệu trên box** —
volume thành mồ côi, phải `docker volume rm` tay.

### Kết quả dọn ổ (2026-08-22, không gián đoạn dịch vụ)

| | trước | sau |
|---|---|---|
| `/` | 45G/47G — **96%** | 26G/47G — **54%** |
| `/var/lib/docker` | 32G/32G — **100%** | 6.1G/32G — **21%** |
| `docker.img` chiếm trên `/` | 31G | 12G |

Ba việc, không cái nào cần dừng dịch vụ:

1. **`fstrim`** — đây mới là mấu chốt. Ổ docker là tệp loopback nằm trên `/`, và tệp
   đó **chỉ phình, không co**: dọn bên trong thì `df /var/lib/docker` đẹp lên nhưng `/`
   không nhúc nhích. Box này có hỗ trợ discard trên loop
   (`/sys/block/loop0/queue/discard_max_bytes` = 4294966784, CentOS 7.9 / 3.10) nên
   `fstrim` đục lỗ được vào tệp và **trả 19G về cho `/`**.
2. **Cron hằng tuần** `/etc/cron.d/fstrim-docker` (3h sáng Chủ nhật) để cái ratchet đó
   không quay lại. Dùng cron thay vì cờ `discard` trong fstab vì trim ngay mỗi lần xoá
   có thể làm chậm I/O trên nhân 3.10 cũ.
3. **Gỡ Ollama** — 4.77GB ảnh + 672MB model + container + volume.

**KHÔNG chuyển `data-root` ra khỏi loopback.** Đã cân nhắc và bỏ: cần 12G trống trên
`/` mới bắt đầu chép được (mà chỗ trống đó đang bị chính loopback giữ), `pgdata` và
`caddy_data` chứng chỉ Let's Encrypt thật nằm trong cây đó, overlay2 phải chép bằng
`rsync -aHAX` mới giữ được hardlink, và phải tắt toàn bộ web. `fstrim` xoá luôn lý do
phải làm việc đó.

Compose mới đã đẩy lên box (giữ bản cũ ở `docker-compose.sandbox.yml.bak-20260822`),
`docker compose config` hợp lệ, 6 dịch vụ vẫn healthy, trang công khai 200 suốt.
Healthcheck `pg_isready -d` mới sẽ có hiệu lực ở lần dựng lại container db kế tiếp.

### Kênh tích hợp: trả SỐ tác giả chính, không phải cờ (2026-08-22)
ACADsoom báo qua `docs/yeu-cau-web-khoa.md` (repo acadsoom) rằng Cách 2 của Phụ lục 2
chia phần tác giả chính là `1/3 ÷ số tác giả chính thuộc Trường`. Mẫu số đó **không suy
ra được từ `mainAuthorAtSchool: boolean`**, nên ACADsoom buộc phải đoán bằng 1 — bài có
**hai** tác giả chính cùng thuộc Trường thì mỗi người nhận 1/3 thay vì 1/6: **cộng gấp
đôi**, và tổng phần chia cho Trường vượt 100%.

Đã thêm `mainAuthorsAtSchool` (số đếm) vào `/integration/publications`, **không thêm
cột**: đếm tại chỗ từ danh sách tác giả đã xác nhận. `recount()` vốn đã giữ đúng dữ
liệu cần; thêm cột chỉ tạo thêm một chỗ để lệch. Cột `mainAuthorAtSchool` cũ giữ nguyên
để không phá bên đang dùng.

Kèm mục 3 của tài liệu: trả `authorIndex` / `isFirst` / `isCorresponding` / `isLast` của
chính người được hỏi. Không ảnh hưởng công thức — Phụ lục 2 chỉ phân biệt tác giả chính
với đồng tác giả — nhưng khi số giờ ra không như mong đợi, ACADsoom cần chỉ được rằng
sai nằm ở dữ liệu vị trí tác giả chứ không phải ở phép tính.

CHƯA làm — mục 2 của tài liệu: **Bảng 3, 65/106 mã** (hội đồng đánh giá đề tài, giải
thưởng, tổ chức hội nghị, hướng dẫn người học…). Đây là một thực thể MỚI, không dùng lại
`projects` được: ngồi hội đồng thẩm định đề tài của người khác thì không có kinh phí,
không có số tháng, và người ngồi hội đồng không phải thành viên đề tài. Cần bàn phạm vi
trước khi làm.

### Bảng 3 — Hoạt động KHCN khác (2026-08-23)
65 trên tổng 106 mã Phụ lục 2 trước nay không có đường nào vào ACADsoom; giảng viên
phải khai tay. Nay có `ScienceActivity` + API + màn khai báo.

**Vì sao là thực thể mới chứ không dùng lại `ResearchProject`:** ngồi hội đồng thẩm
định đề tài của người khác thì không có kinh phí, không có số tháng thực hiện, và
người ngồi hội đồng không phải thành viên đề tài. Nhét chung là bịa ra ba trường vô
nghĩa và làm hỏng phép tính theo kinh phí của Bảng 2.

**Vì sao KHÔNG dùng chung giữa nhiều người như `Publication`:** Bảng 3 tính giờ CỐ
ĐỊNH CHO MỘT NGƯỜI, không chia theo số tác giả. Hai người cùng ngồi một hội đồng là
hai bản ghi độc lập, mỗi người hưởng trọn phần của mình — nên không có mời, không có
hàng chờ xác nhận, không có `totalAuthors` / `schoolAuthors` / `sharePercent`.

`catalogCode` **bắt buộc**, khác `Publication`: bài báo tra tự động về nên có giai
đoạn "chưa phân loại", còn ở đây người khai chọn mã ngay từ danh sách. `level` và
`role` chỉ để đối soát — mã đã gói sẵn cả cấp lẫn vai trò.

Danh mục 65 mã trong `phys-profile/src/lib/catalog.ts` **trích thẳng bằng script** từ
`acadsoom/src/lib/nv2Catalog.js` — bảng đã đối chiếu tay với bản scan PL2 ngày
22/8/2026. Gõ lại tay là mời một mã lệch vào, mà mã lệch thì ACADsoom quy đổi sai giờ.

Migration `20260823_science_activity` — cộng thêm, chạy lại được. CHƯA chạy trên box.

## 2026-08-23 — Bảng 3, đề tài theo Phụ lục 2, giao diện mới, hình thức công tác

**Bảng 3 — Hoạt động KHCN khác.** 65/106 mã trước nay không có đường vào ACADsoom.
Thêm `ScienceActivity` + API + `/integration/activities` + màn `/hoat-dong`, và bên
ACADsoom `layHoatDong` + `hoatDongSangDauVao`. Migration `20260823_science_activity`
ĐÃ CHẠY. Danh mục 65 mã trích **bằng script** từ `acadsoom/src/lib/nv2Catalog.js` —
gõ tay là mời một mã lệch vào, mà mã lệch thì quy đổi sai giờ.

**Đề tài — đối chiếu PL2 tr. 2.6–2.8.** Phát hiện Bảng 2 khác Bảng 1: Bảng 1 có Cách 1
và Cách 2, Bảng 2 **chỉ có Cách 1** (chủ nhiệm nộp phương án chia). Và tỷ lệ là của
TOÀN BỘ nhiệm vụ — phần rơi vào từng năm tính riêng theo số tháng (tr. 2.7), hai trục
độc lập. Đã vá bốn chỗ: ràng buộc tổng ≤100%, suy số tháng từ hai mốc, thêm
`decisionNo`, và **mở ô tỷ lệ ra giao diện** — trước đó trường quyết định cả phép chia
giờ mà giảng viên không nhập được. Migration `20260823b_project_decision_no` ĐÃ CHẠY.

**Giao diện mới.** Dựng từ Claude Design (dự án 12ff5f81): 8 màn máy tính + 7 màn điện
thoại, cộng bản tối. Hai tệp thiết kế cấu trúc giống hệt nhau nên cặp sáng→tối rút bằng
đối chiếu 830 màu **theo vị trí** (47 cặp). Xem `memory/phys-profile-design-system.md`.

**Hình thức công tác.** PHYsoom KHÔNG có trường này — payload đúng bảy trường. Nhưng
`rank` là ngạch viên chức nên suy được: **95 người có ngạch → cơ hữu** (đã chạy, kiểm
chứng bằng `SELECT affiliationType, count(*)`). 40 hồ sơ còn trống là CỐ Ý: trống ngạch
là thiếu dữ liệu, không phải bằng chứng thỉnh giảng. Bộ môn thì vốn đã đồng bộ từ 22/8
vào `User.departmentId`, chỉ là chưa API nào trả ra — nay `/scholar/me` trả kèm.

**Còn treo:** `import-page-dois.ts --apply` (99/113 DOI, hiện mới 3 công bố trong hệ
thống); ACADsoom chưa kéo Bảng 3 vào NV2 vì cần rà lại cách `mucBTheoMa` ghép 65 mã
sang đầu mục mục B khi có dữ liệu thật; một hồ sơ khoa học không khớp danh sách PHYsoom.

## 2026-09-20 — Bật đường đẩy sự kiện sang ACADsoom: vá một chỗ sót, còn lại là cấu hình

ACADsoom đang tốn hạn mức "Active CPU" của Vercel (gói miễn phí 4 giờ/tháng cho
CẢ team, ngày 20/9 đã dùng 100%, vượt nữa thì Vercel tạm dừng mọi project) vì
phải **quét mò**: cron mỗi đêm + kéo lại mỗi lần giảng viên mở màn NV2. Bus sự
kiện dựng từ 22/8 chính là lời giải, nhưng chưa bật.

**Rà lại toàn bộ đường ghi NCKH.** 16 chỗ đã phát sự kiện. Đối chiếu từng hàm
ghi CSDL trong `scholar.service.ts` / `project.service.ts` / `activity.service.ts`
(kể cả các helper riêng như `ganStaged`, `recount`, `attachSelf`) thì **chỉ một
chỗ sót**: `ProjectService.respond` — trả lời lời mời vào đề tài. Đường công bố
(`respondToClaim`) và hoạt động khoa học (`respondClaim`) đều phát ở chỗ tương
đương; riêng đề tài thì không.

Chỗ sót này đắt hơn vẻ ngoài: trước khi xác nhận, người được mời **chưa được
tính giờ nào** của đề tài (`assertShareFits` chỉ cộng người đã CONFIRMED), nên
đúng lúc số của họ vừa đổi thật thì bên nhận lại không được báo — phải chờ tới
lượt quét theo lịch. Đã thêm `bus.emit('project.changed', …)` ngay sau lượt cập
nhật, kèm 3 test trong `project-claim.spec.ts`: phát khi chấp nhận, phát khi từ
chối, và **không** phát lại khi bấm lại trên dòng đã trả lời (`respond` trả
nguyên trạng cho cú bấm đúp, không nên biến nó thành lượt quét thừa).

Kiểm chứng: `vitest run` 213/213 (15 tệp), `tsc --noEmit -p tsconfig.build.json`
sạch, `eslint` hai tệp 0 lỗi (7 cảnh báo có sẵn). *Không* chạy `pnpm run lint` —
script đó kèm `--fix` nên sẽ ghi đè hàng loạt tệp đang sửa dở.

**Việc còn lại KHÔNG phải mã, mà là biến môi trường** (chưa đặt ở cả hai đầu):

```
# box web Khoa
EVENT_WEBHOOKS=https://acadsoom.vercel.app/api/webhook/webkhoa
EVENT_WEBHOOK_SECRET=<chuỗi ngẫu nhiên đủ dài>
# Vercel của ACADsoom — cùng giá trị, khác tên biến
WEBKHOA_EVENT_SECRET=<đúng chuỗi đó>
```

Chưa đặt thì mọi thứ im lặng đúng như thiết kế: `EVENT_WEBHOOKS` rỗng là bộ phát
thoát ngay, còn bên nhận trả 503 thay vì mở toang cho cả Internet bắt nó quét cả
Khoa. Bên nhận (`acadsoom/src/app/api/webhook/webkhoa/route.js`) đã có từ 22/8 và
tự lo phần khó: bỏ qua sự kiện không liên quan bằng 200 (4xx sẽ làm bộ phát ngừng
thử lại), và giành lượt quét bằng **một lệnh cập nhật nguyên tử** nên 10 webhook
của một lần lưu liền tay chỉ thành một lượt quét.

**Trạng thái kho lúc ghi dòng này:** cây làm việc đã có sẵn ~828 dòng sửa dở của
việc khác (OCR minh chứng đề tài: `project-doc.service.ts`, `project-doc-parse.ts`,
`schema.prisma`, `scholar.controller.ts`…) từ phiên trước, **không** thuộc mục
này. Thay đổi của mục này chỉ gồm `project.service.ts` (một lệnh emit + chú
thích) và `project-claim.spec.ts` (3 test) — chưa commit, để khỏi gộp chung với
việc đang dở kia.
