import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductsModule } from '../products/products.module';
import { SupplyOrder, SupplyOrderSchema } from './supply-order.schema';
import { SupplyOrdersController } from './supply-orders.controller';
import { SupplyOrdersService } from './supply-orders.service';
import { User, UserSchema } from '../users/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupplyOrder.name, schema: SupplyOrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ProductsModule,
  ],
  controllers: [SupplyOrdersController],
  providers: [SupplyOrdersService],
})
export class SupplyOrdersModule {}

