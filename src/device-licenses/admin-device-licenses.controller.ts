import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import { DeviceLicensesService } from './device-licenses.service';
import { UpsertDeviceLicenseDto } from './dto/upsert-device-license.dto';

@Controller('admin/device-licenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminDeviceLicensesController {
  constructor(private readonly licenses: DeviceLicensesService) {}

  @Get()
  @Roles(UserRole.DEVELOPER)
  list() {
    return this.licenses.findAll();
  }

  @Post()
  @Roles(UserRole.DEVELOPER)
  upsert(@Body() body: UpsertDeviceLicenseDto) {
    return this.licenses.upsert(body.deviceId, body.expiresAt, body.label);
  }

  @Delete(':deviceId')
  @Roles(UserRole.DEVELOPER)
  remove(@Param('deviceId') deviceId: string) {
    return this.licenses.remove(deviceId);
  }
}
