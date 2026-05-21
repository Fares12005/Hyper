import { Body, Controller, Post } from '@nestjs/common';
import { DeviceLicensesService } from './device-licenses.service';
import { CheckLicenseDto } from './dto/check-license.dto';

@Controller('license')
export class LicensePublicController {
  constructor(private readonly licenses: DeviceLicensesService) {}

  @Post('check')
  check(@Body() body: CheckLicenseDto) {
    return this.licenses.check(body.deviceId);
  }
}
