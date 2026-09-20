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

export const TooFewAuthorsException = new UnprocessableEntityException([
  {
    field: 'totalAuthors',
    error: 'Tổng số tác giả phải lớn hơn hoặc bằng số tác giả thuộc Trường',
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
