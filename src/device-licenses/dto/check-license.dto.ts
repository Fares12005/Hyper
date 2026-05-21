import { IsString, MinLength } from 'class-validator';

export class CheckLicenseDto {
  @IsString()
  @MinLength(8)
  deviceId: string;
}
