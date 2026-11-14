import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ZodSerializerDto } from 'nestjs-zod';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleService } from './google.service';
import {
  LoginBodyDTO,
  LoginOtpBodyDTO,
  PhysoomSsoBodyDTO,
  LoginResDTO,
  RefreshTokenBodyDTO,
  RefreshTokenResDTO,
  CreateAdminBodyDTO,
  UserResDTO,
  SendOTPBodyDTO,
  VerifyOTPBodyDTO,
  ForgotPasswordBodyDTO,
  GetAuthorizationUrlResDTO,
  MessageResDTO,
  UpdateProfileBodyDTO,
  ChangePasswordBodyDTO,
  SetStarredBodyDTO,
} from './auth.dto';
import { IsPublic } from '../shared/decorators/auth.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { ActiveUser } from '../shared/decorators/active-user.decorator';
import { RoleName } from '../shared/constants/role.constants';
import envConfig from '../shared/config/config';

@Controller('auth')
// Brute-force protection on credential endpoints, keyed by real client IP.
// Default 20/min for auth ops; sensitive routes tighten to 8/min below.
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleService: GoogleService,
  ) {}

  @Get('profile')
  @ZodSerializerDto(UserResDTO)
  getProfile(@ActiveUser('userId') userId: string) {
    return this.authService.getProfile(userId);
  }

  /**
   * Hồ sơ của CHÍNH người đang đăng nhập, mở cho cả cán bộ (LECTURER).
   *
   * Tách khỏi GET /auth/profile có chủ ý: route đó không gắn @Roles nên chỉ admin
   * qua được, và trang quản trị dựa vào chính lỗi 403 ấy để không cho cán bộ vào.
   * Hệ phiếu hỗ trợ (/ho-tro) cần cán bộ đăng nhập được → dùng route này, chỉ
   * trả về dữ liệu của chính người gọi nên không mở thêm gì khác.
   */
  @Get('me')
  @Roles(RoleName.Lecturer, RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(UserResDTO)
  getMe(@ActiveUser('userId') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Patch('profile')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(UserResDTO)
  updateProfile(
    @ActiveUser('userId') userId: string,
    @Body() body: UpdateProfileBodyDTO,
  ) {
    return this.authService.updateProfile(userId, body);
  }

  @Post('change-password')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  @ZodSerializerDto(MessageResDTO)
  changePassword(
    @ActiveUser('userId') userId: string,
    @Body() body: ChangePasswordBodyDTO,
  ) {
    return this.authService.changePassword(userId, body);
  }

  // Persist the admin's starred/favourite layouts & widgets (per-user UI state).
  @Put('starred')
  @Roles(RoleName.Admin, RoleName.SuperAdmin)
  setStarred(
    @ActiveUser('userId') userId: string,
    @Body() body: SetStarredBodyDTO,
  ) {
    return this.authService.setStarred(userId, body);
  }

  @Post('login')
  @IsPublic()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ZodSerializerDto(LoginResDTO)
  login(@Body() body: LoginBodyDTO) {
    return this.authService.login(body);
  }

  /** Đổi token PHYsoom lấy access token của web Khoa. */
  @Post('sso/physoom')
  @IsPublic()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ZodSerializerDto(LoginResDTO)
  ssoPhysoom(@Body() body: PhysoomSsoBodyDTO) {
    return this.authService.loginWithPhysoom(body.token);
  }

  // Dang nhap bang ma gui qua email. Giang vien chua tung dat mat khau van
  // vao duoc, ma khong phai tao them tai khoan nao.
  @Post('login-otp')
  @IsPublic()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ZodSerializerDto(LoginResDTO)
  loginOtp(@Body() body: LoginOtpBodyDTO) {
    return this.authService.loginWithOtp(body);
  }

  @Post('create-admin')
  @Roles(RoleName.SuperAdmin)
  @ZodSerializerDto(UserResDTO)
  createAdmin(@Body() body: CreateAdminBodyDTO) {
    return this.authService.createAdmin(body);
  }

  @Post('refresh-token')
  @IsPublic()
  @ZodSerializerDto(RefreshTokenResDTO)
  refreshToken(@Body() body: RefreshTokenBodyDTO) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Post('otp')
  @IsPublic()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ZodSerializerDto(MessageResDTO)
  sendOTP(@Body() body: SendOTPBodyDTO) {
    return this.authService.sendOTP(body);
  }

  @Post('verify-otp')
  @IsPublic()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ZodSerializerDto(MessageResDTO)
  verifyOTP(@Body() body: VerifyOTPBodyDTO) {
    return this.authService.verifyOTP(body);
  }

  @Post('forgot-password')
  @IsPublic()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ZodSerializerDto(MessageResDTO)
  forgotPassword(@Body() body: ForgotPasswordBodyDTO) {
    return this.authService.forgotPassword(body);
  }

  @Post('logout')
  @ZodSerializerDto(MessageResDTO)
  logout(@Body() body: RefreshTokenBodyDTO) {
    return this.authService.logout(body.refreshToken);
  }

  @Get('google-link')
  @IsPublic()
  @ZodSerializerDto(GetAuthorizationUrlResDTO)
  getGoogleAuthorizationUrl(@Req() req: Request) {
    return this.googleService.getAuthorizationUrl({
      userAgent: req.headers['user-agent'] ?? 'Unknown',
      ip: req.ip ?? 'Unknown',
    });
  }

  @Get('google/callback')
  @IsPublic()
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const { accessToken, refreshToken } =
        await this.googleService.googleCallback({ code, state });
      return res.redirect(
        `${envConfig.GOOGLE_CLIENT_REDIRECT_URI}?accessToken=${accessToken}&refreshToken=${refreshToken}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google login failed';
      return res.redirect(
        `${envConfig.GOOGLE_CLIENT_REDIRECT_URI}?errorMessage=${encodeURIComponent(message)}`,
      );
    }
  }
}
