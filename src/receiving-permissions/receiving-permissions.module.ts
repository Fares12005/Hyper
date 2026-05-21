import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReceivingPermission, ReceivingPermissionSchema } from './receiving-permission.schema';
import { ReceivingPermissionsService } from './receiving-permissions.service';
import { ReceivingPermissionsController } from './receiving-permissions.controller';
import { SupplierOrder, SupplierOrderSchema } from '../supplier-orders/supplier-order.schema';
import { User, UserSchema } from '../users/user.schema';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReceivingPermission.name, schema: ReceivingPermissionSchema },
      { name: SupplierOrder.name, schema: SupplierOrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ProductsModule,
  ],
  providers: [ReceivingPermissionsService],
  controllers: [ReceivingPermissionsController],
  exports: [ReceivingPermissionsService],
})
export class ReceivingPermissionsModule {}

