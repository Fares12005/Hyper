import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertDeviceLicenseDto {
  @IsString()
  @MinLength(8)
  deviceId: string;

  /** تاريخ/وقت انتهاء الاشتراك */
  @IsDateString()
  expiresAt: string;

  @IsOptional()
  @IsString()
  label?: string;
}
