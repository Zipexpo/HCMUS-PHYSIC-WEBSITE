import { createZodDto } from 'nestjs-zod';
import {
  PhysoomSsoBodySchema,
  LoginBodySchema,
  LoginResSchema,
  RefreshTokenBodySchema,
  RefreshTokenResSchema,
  CreateAdminBodySchema,
  UserResSchema,
  SendOTPBodySchema,
  LoginOtpBodySchema,
  VerifyOTPBodySchema,
  ForgotPasswordBodySchema,
  GetAuthorizationUrlResSchema,
  MessageResSchema,
  UpdateProfileBodySchema,
  ChangePasswordBodySchema,
  SetStarredBodySchema,
} from './auth.model';

export class LoginBodyDTO extends createZodDto(LoginBodySchema) {}
export class LoginResDTO extends createZodDto(LoginResSchema) {}
export class RefreshTokenBodyDTO extends createZodDto(RefreshTokenBodySchema) {}
export class RefreshTokenResDTO extends createZodDto(RefreshTokenResSchema) {}
export class CreateAdminBodyDTO extends createZodDto(CreateAdminBodySchema) {}
export class UserResDTO extends createZodDto(UserResSchema) {}
export class SendOTPBodyDTO extends createZodDto(SendOTPBodySchema) {}
export class VerifyOTPBodyDTO extends createZodDto(VerifyOTPBodySchema) {}
export class LoginOtpBodyDTO extends createZodDto(LoginOtpBodySchema) {}
export class ForgotPasswordBodyDTO extends createZodDto(
  ForgotPasswordBodySchema,
) {}
export class GetAuthorizationUrlResDTO extends createZodDto(
  GetAuthorizationUrlResSchema,
) {}
export class MessageResDTO extends createZodDto(MessageResSchema) {}
export class UpdateProfileBodyDTO extends createZodDto(
  UpdateProfileBodySchema,
) {}
export class ChangePasswordBodyDTO extends createZodDto(
  ChangePasswordBodySchema,
) {}
export class SetStarredBodyDTO extends createZodDto(SetStarredBodySchema) {}

export class PhysoomSsoBodyDTO extends createZodDto(PhysoomSsoBodySchema) {}
