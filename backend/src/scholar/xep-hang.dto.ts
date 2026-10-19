import { createZodDto } from 'nestjs-zod';
import {
  ApDungBodySchema,
  ApDungResSchema,
  GoiYQuerySchema,
  GoiYResSchema,
  LechQuerySchema,
  LechResSchema,
  NapBangBodySchema,
  NapBangResSchema,
  TaiCoreResSchema,
  TinhTrangBangResSchema,
} from './xep-hang.model';

export class GoiYQueryDTO extends createZodDto(GoiYQuerySchema) {}
export class GoiYResDTO extends createZodDto(GoiYResSchema) {}
export class NapBangBodyDTO extends createZodDto(NapBangBodySchema) {}
export class NapBangResDTO extends createZodDto(NapBangResSchema) {}
export class TinhTrangBangResDTO extends createZodDto(TinhTrangBangResSchema) {}
export class TaiCoreResDTO extends createZodDto(TaiCoreResSchema) {}
export class LechQueryDTO extends createZodDto(LechQuerySchema) {}
export class LechResDTO extends createZodDto(LechResSchema) {}
export class ApDungBodyDTO extends createZodDto(ApDungBodySchema) {}
export class ApDungResDTO extends createZodDto(ApDungResSchema) {}
