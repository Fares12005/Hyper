import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeviceLicense, DeviceLicenseSchema } from './device-license.schema';
import { DeviceLicensesService } from './device-licenses.service';
import { LicensePublicController } from './license-public.controller';
import { AdminDeviceLicensesController } from './admin-device-licenses.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: DeviceLicense.name, schema: DeviceLicenseSchema }])],
  controllers: [LicensePublicController, AdminDeviceLicensesController],
  providers: [DeviceLicensesService],
  exports: [DeviceLicensesService],
})
export class DeviceLicensesModule {}
