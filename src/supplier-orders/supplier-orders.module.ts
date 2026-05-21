import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupplierOrder, SupplierOrderSchema } from './supplier-order.schema';
import { SupplierOrdersService } from './supplier-orders.service';
import { SupplierOrdersController } from './supplier-orders.controller';
import { Supplier, SupplierSchema } from '../suppliers/supplier.schema';
import { User, UserSchema } from '../users/user.schema';
import { ProductsModule } from '../products/products.module';
import { ReceivingPermissionsModule } from '../receiving-permissions/receiving-permissions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupplierOrder.name, schema: SupplierOrderSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ProductsModule,
    forwardRef(() => ReceivingPermissionsModule),
  ],
  providers: [SupplierOrdersService],
  controllers: [SupplierOrdersController],
  exports: [SupplierOrdersService],
})
export class SupplierOrdersModule {}

