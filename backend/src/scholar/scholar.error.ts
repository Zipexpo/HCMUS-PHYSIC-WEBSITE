import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const ProfileNotFoundException = new NotFoundException([
  { field: 'userId', error: 'Chưa có hồ sơ khoa học cho tài khoản này' },
]);

export const PublicationNotFoundException = new NotFoundException([
  { field: 'id', error: 'Không tìm thấy công trình' },
]);

export const OrcidTakenException = new ConflictException([
  { field: 'orcid', error: 'ORCID này đã gắn với một tài khoản khác' },
]);

export const NotAnAuthorException = new ForbiddenException([
  {
    field: 'id',
    error: 'Chỉ tác giả đã xác nhận của công trình mới được sửa',
  },
]);

export const NoClaimException = new NotFoundException([
  {
    field: 'id',
    error: 'Không có lời mời xác nhận nào cho bạn ở công trình này',
  },
]);

export const NoOrcidException = new UnprocessableEntityException([
  {
    field: 'orcid',
    error: 'Hãy khai ORCID trong hồ sơ trước khi nhập hàng loạt',
  },
]);

export const CannotResolveException = new UnprocessableEntityException([
  {
    field: 'input',
    error:
      'Không nhận ra DOI, arXiv ID hay ISBN trong nội dung đã dán. Kiểm tra lại hoặc nhập tay.',
  },
]);

/**
 * Phụ lục 2 (tr. 2.5): người đứng ra khai giờ cho nhóm phải là First,
 * Corresponding hoặc Last Author. Chặn ngay ở tầng nhập liệu chứ không để tới
 * lúc người duyệt mới phát hiện.
 */
export const NotEligibleRepresentativeException =
  new UnprocessableEntityException([
    {
      field: 'sharePercent',
      error:
        'Chỉ First Author, Corresponding Author hoặc Last Author mới được khai tỷ lệ chia giờ cho nhóm',
    },
  ]);

/**
 * Cách 1 do ĐẠI DIỆN nhóm khai cho cả nhóm (Khoa chốt 10/10/2026) — đồng tác giả
 * không phải tác giả chính chỉ XEM tỷ lệ của mình, không tự đổi được.
 */
export const ShareSetByRepresentativeException =
  new UnprocessableEntityException([
    {
      field: 'sharePercent',
      error:
        'Tỷ lệ chia giờ (Cách 1) do người đại diện nhóm — First, Corresponding hoặc Last Author — khai cho cả nhóm. Nhờ người đó sửa tỷ lệ của bạn.',
    },
  ]);

/** Tổng tỷ lệ Cách 1 của cả nhóm (trong Khoa + ngoài) không được vượt 100%. */
export const TotalShareExceededException = new UnprocessableEntityException([
  {
    field: 'sharePercent',
    error: 'Tổng tỷ lệ chia giờ của cả nhóm (Cách 1) vượt 100%.',
  },
]);

export const TooFewAuthorsException = new UnprocessableEntityException([
  {
    field: 'totalAuthors',
    error: 'Tổng số tác giả phải lớn hơn hoặc bằng số tác giả thuộc Trường',
  },
]);

/**
 * Bỏ vai trò THEO VỊ TRÍ — người đứng đầu danh sách tác giả là tác giả đầu, người
 * đứng cuối là tác giả cuối: sự thật in trên bài, không phải lựa chọn, và Phụ lục
 * 2 tr. 2.5 tính cả hai là tác giả chính. Xem `chotVaiTroTheoViTri`.
 */
export const PositionalRoleException = (moTa: string) =>
  new UnprocessableEntityException([
    {
      field: 'memberUpdates',
      error:
        `${moTa} nên không bỏ được vai trò này: người đứng đầu danh sách tác ` +
        'giả là tác giả đầu, người đứng cuối là tác giả cuối, và Phụ lục 2 tính ' +
        'cả hai là tác giả chính. Nếu tên đang đứng SAI HÀNG thì sửa hàng (vị ' +
        'trí) của người đó, đừng bỏ vai trò.',
    },
  ]);

export const NoStaffPageException = new NotFoundException([
  {
    field: 'staffPageSlug',
    error:
      'Hồ sơ của bạn chưa nối với trang nhân sự nào. Điền địa chỉ trang ở mục Lý lịch khoa học.',
  },
]);

export const StaffBlockNotFoundException = new UnprocessableEntityException([
  {
    field: 'staffPageSlug',
    error:
      'Trang nhân sự này không có khối hồ sơ để sửa — nhờ quản trị dựng lại trang.',
  },
]);

/**
 * Trang có NHIỀU khối hồ sơ — vd `staffPageSlug` bị trỏ nhầm vào trang danh sách
 * cả bộ môn. Trước đây hàm định vị lấy khối ĐẦU TIÊN, nghĩa là người này sẽ sửa
 * ảnh và tiểu sử của người đứng đầu danh sách mà không hề biết. Thà chặn.
 */
export const StaffBlockAmbiguousException = new UnprocessableEntityException([
  {
    field: 'staffPageSlug',
    error:
      'Trang nhân sự này chứa nhiều hồ sơ (có thể là trang danh sách cả bộ môn), ' +
      'nên không xác định được khối nào là của bạn. Nhờ quản trị trỏ hồ sơ sang ' +
      'đúng trang riêng của bạn — sửa ở đây sẽ đụng vào hồ sơ người khác.',
  },
]);

export const PhotoRequiredException = new UnprocessableEntityException([
  {
    field: 'file',
    error: 'Cần chọn một tệp ảnh (JPG, PNG, WebP), tối đa 8 MB',
  },
]);

export const ProjectNotFoundException = new NotFoundException([
  { field: 'id', error: 'Không tìm thấy đề tài' },
]);

export const NotAProjectMemberException = new ForbiddenException([
  {
    field: 'id',
    error: 'Chỉ thành viên đã xác nhận của đề tài mới được sửa',
  },
]);

export const ActivityNotFoundException = new NotFoundException([
  { field: 'id', error: 'Không tìm thấy hoạt động khoa học' },
]);

export const EvidenceNotFoundException = new NotFoundException([
  { field: 'evidenceId', error: 'Không tìm thấy tệp minh chứng của đề tài' },
]);

/**
 * Token minh chứng gửi lên khi lưu đề tài không còn / không phải của người này.
 * Tệp tải qua parse-documents chỉ giữ tạm; quá hạn thì bị dọn.
 */
export const StagedDocNotFoundException = new UnprocessableEntityException([
  {
    field: 'attachDocuments',
    error:
      'Tệp đính kèm không còn khả dụng — có thể đã quá hạn giữ tạm. Tải lại ' +
      'hợp đồng / thuyết minh rồi lưu lại.',
  },
]);

/** Mốc kết thúc của đề tài trước mốc bắt đầu — xem soatMocDeTai. */
export const ProjectDatesReversedException = new UnprocessableEntityException([
  {
    field: 'endYear',
    error:
      'Ngày kết thúc đề tài đang trước ngày bắt đầu — kiểm lại tháng/năm (thường ' +
      'là gõ nhầm năm). Đủ hai mốc thì số tháng thực hiện được tính từ mốc, không ' +
      'nhập tay.',
  },
]);

/** Danh sách nhân sự của đề tài không có chủ nhiệm — xem project-roles.ts. */
export const ProjectNeedsLeadException = new UnprocessableEntityException([
  {
    field: 'members',
    error:
      'Danh sách nhân sự của đề tài phải có Chủ nhiệm. Chọn vai trò Chủ nhiệm ' +
      'cho đúng người chủ nhiệm đề tài — kể cả khi đó là cộng sự ngoài Khoa.',
  },
]);

/**
 * Mã đề tài đã thuộc về một đề tài khác chưa xoá — xem `chanTrungMa` trong
 * project.service.ts. Mỗi bản khai là một khoản NV2 bên ACADsoom, nên khai lại
 * một đề tài đã có là cộng giờ thêm một lần.
 */
export const ProjectCodeTakenException = (
  ma: string,
  ten: string,
  chuNhiem: string | null,
) =>
  new UnprocessableEntityException([
    {
      field: 'code',
      error:
        `Đề tài mã ${ma} đã có trên hệ thống: «${ten}»` +
        (chuNhiem ? `, chủ nhiệm ${chuNhiem}` : '') +
        '. Mỗi bản khai là một lần cộng giờ, nên đừng khai thêm bản mới. Đã có ' +
        'tên trong đề tài đó thì mở nó ở mục Đề tài để sửa (thêm thành viên, ' +
        'minh chứng…); chưa có tên thì nhờ chủ nhiệm mời vào.',
    },
  ]);

/** Chủ nhiệm duy nhất rút tên khỏi đề tài còn người khác — xem remove(). */
export const LastLeadLeavingException = new UnprocessableEntityException([
  {
    field: 'id',
    error:
      'Bạn đang là Chủ nhiệm duy nhất của đề tài nên chưa rút tên được — danh ' +
      'sách nhân sự phải luôn có Chủ nhiệm. Chuyển vai Chủ nhiệm cho đúng người ' +
      '(Sửa → Nhân sự đề tài) rồi hãy rút tên.',
  },
]);

/**
 * Đặt đề tài sang KẾT THÚC mà chưa có minh chứng nghiệm thu. Hợp đồng + thuyết
 * minh chỉ chứng cho đề tài ĐANG thực hiện; muốn kết thúc phải kèm biên bản
 * nghiệm thu / thanh lý — xem chốt chặn trong project.service.ts.
 */
export const ProjectNeedsAcceptanceException = new UnprocessableEntityException(
  [
    {
      field: 'status',
      error:
        'Đề tài chỉ chuyển sang "Đã kết thúc" khi đã có minh chứng nghiệm thu ' +
        '(biên bản nghiệm thu / thanh lý). Tải minh chứng nghiệm thu lên đề tài ' +
        'rồi mới đổi trạng thái.',
    },
  ],
);

/**
 * Đặt KẾT THÚC / KHÔNG HOÀN THÀNH mà không nói tháng nào.
 *
 * Không phải thủ tục giấy tờ: mốc này quyết định năm học nào được cộng phần
 * tháng còn lại. Thiếu nó thì đề tài nghiệm thu sớm vẫn bị chia đều tới hạn cũ,
 * tức giờ của người ta nằm lại ở một năm học mà đề tài đã đóng.
 */
export const ProjectNeedsFinishMonthException =
  new UnprocessableEntityException([
    {
      field: 'finishedMonth',
      error:
        'Cho biết tháng/năm nghiệm thu (hoặc tháng khai không hoàn thành). ' +
        'Mốc này quyết định năm học nào được tính phần thời gian còn lại của đề tài.',
    },
  ]);

/** Tổng tỷ lệ chia của đề tài vượt 100% — xem `assertShareFits`. */
export const ShareOverflowException = (daChia: number, them: number) =>
  new UnprocessableEntityException([
    {
      field: 'mySharePercent',
      error:
        `Các thành viên đã xác nhận đang giữ ${daChia}% của đề tài, ` +
        `thêm ${them}% nữa là vượt 100%. Phụ lục 2 chia số giờ của nhiệm vụ ` +
        `một lần cho cả đề tài, không phải mỗi năm một bộ tỷ lệ.`,
    },
  ]);

export const NotProjectLeadException = new ForbiddenException([
  {
    field: 'id',
    error:
      'Chỉ chủ nhiệm đề tài mới sửa được — hoặc người khai đề tài, khi đề tài ' +
      'chưa có chủ nhiệm nào xác nhận. Phụ lục 2 đặt trách nhiệm nộp phương án ' +
      'chia giờ ở chủ nhiệm — nhờ chủ nhiệm sửa, hoặc báo nếu vai trò ghi sai.',
  },
]);

// ── Nhận diện tác giả lúc khai (5/10/2026) ─────────────────────────────────
// Mỗi chốt dưới đây ứng với một lỗi ĐÃ GẶP trên dữ liệu thật — xem soat-tac-gia.ts.

/**
 * Số tác giả khác số hàng trong danh sách tác giả. Ca thật: form cũ xoá hàng
 * khỏi bảng nhưng vẫn gửi danh sách gốc → T tụt (3 trên danh sách 4–5 người) mà
 * mỗi người được hưởng phần lớn hơn, và hàng của người khai trỏ sang tên người
 * khác. Phys-profile mới gửi danh sách ĐÚNG như bảng nên hai số luôn bằng nhau.
 */
export const SoTacGiaLechException = (soTacGia: number, soHang: number) =>
  new UnprocessableEntityException([
    {
      field: 'totalAuthors',
      error:
        `Số tác giả (${soTacGia}) khác số hàng trong danh sách tác giả (${soHang}). ` +
        'Thường là trang đang mở là bản cũ — tải lại trang (Ctrl+F5) rồi lưu lại.',
    },
  ]);

export const HangNgoaiDanhSachException = (hang: number, soHang: number) =>
  new UnprocessableEntityException([
    {
      field: 'authorIndex',
      error: `Hàng ${hang + 1} không có trong danh sách ${soHang} tác giả của bài.`,
    },
  ]);

/** Hai tài khoản cùng nhận MỘT hàng tác giả (ca thật: 2 người cùng hàng 3/6). */
export const HangDaCoNguoiException = (
  hang: number,
  tenHang: string,
  nguoi: string,
) =>
  new ConflictException([
    {
      field: 'authorIndex',
      error:
        `Hàng ${hang + 1}${tenHang ? ` («${tenHang}»)` : ''} đã có ${nguoi} nhận. ` +
        'Mỗi hàng tác giả là một người — chọn đúng hàng có tên của mình; nếu ' +
        `${nguoi} nhận nhầm hàng thì báo người đó hoặc Khoa sửa.`,
    },
  ]);

/** Tick "Last Author" ở hàng không phải hàng cuối (ca thật: 15 dòng như vậy). */
export const LastSaiViTriException = (ten: string, hang: number, soHang: number) =>
  new UnprocessableEntityException([
    {
      field: 'isLast',
      error:
        `${ten} đứng hàng ${hang + 1}/${soHang}, không phải hàng cuối — Last Author ` +
        'là người đứng CUỐI danh sách tác giả (Phụ lục 2 tr. 2.5). Danh sách sai ' +
        'thứ tự thì sửa thứ tự, đừng tick Last.',
    },
  ]);

/**
 * Khai tay MỘT tác giả mà chưa xác nhận. Ca thật: bài 3 tác giả khai tay "1 tác
 * giả" → hưởng trọn 3.000 giờ thay vì 1.000.
 */
export const MotTacGiaChuaXacNhanException = new UnprocessableEntityException([
  {
    field: 'motTacGia',
    error:
      'Công trình khai tay đang chỉ có MỘT tác giả là bạn. Nếu đúng vậy, đánh dấu ' +
      '«Công trình chỉ có một tác giả»; nếu còn đồng tác giả thì thêm đủ họ tên ' +
      'theo đúng thứ tự trên bài — một tác giả là hưởng trọn định mức.',
  },
]);

/**
 * Đã có công trình CÙNG TÊN. Ca thật: một bài khai tay 3 lần (2 bản "1 tác giả"),
 * một báo cáo hội nghị khai 2 lần bởi 2 người. Cho đi tiếp khi người khai nói rõ
 * là công trình khác (bản hội nghị + bản tạp chí trùng tên là chuyện thường).
 */
export const TrungCongBoException = (
  ds: Array<{ title: string; nam: number | null; nguoiKhai: string | null }>,
) =>
  new ConflictException([
    {
      field: 'work.title',
      error:
        'Hệ thống đã có công trình cùng tên: ' +
        ds
          .slice(0, 3)
          .map(
            (b) =>
              `«${b.title}»${b.nam ? ` (${b.nam})` : ''}${b.nguoiKhai ? `, do ${b.nguoiKhai} khai` : ''}`,
          )
          .join('; ') +
        '. Cùng một bài thì gắn tên mình vào bài đó (mỗi bài chỉ tính một lần); ' +
        'là công trình khác (vd bản hội nghị và bản tạp chí) thì đánh dấu «Đây là ' +
        'công trình khác» rồi lưu.',
    },
  ]);

export const KhongPhaiBanTrungException = new UnprocessableEntityException([
  {
    field: 'ganVaoBai',
    error: 'Chỉ gắn tên được vào công trình CÙNG TÊN với công trình đang khai.',
  },
]);

/** Thao tác soát của Khoa không còn đúng (dữ liệu đã đổi từ lúc mở danh sách). */
export const SoatKhongConDungException = (lyDo: string) =>
  new UnprocessableEntityException([{ field: 'id', error: lyDo }]);
