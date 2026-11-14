export const REQUEST_USER_KEY = 'user';

export enum AuthType {
  Bearer = 'Bearer',
  None = 'None',
}

export enum ConditionType {
  And = 'and',
  Or = 'or',
}

export const AUTH_TYPE_KEY = 'authType';
export const ROLES_KEY = 'roles';

export enum VerificationMethod {
  ForgotPassword = 'FORGOT_PASSWORD',
  /// Ma dung de DANG NHAP khong can mat khau. Tach khoi FORGOT_PASSWORD de ma
  /// xin cho viec nay khong doi duoc mat khau, va nguoc lai.
  Login = 'LOGIN',
}
