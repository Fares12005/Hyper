import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { Order, OrderSchema } from '../orders/order.schema';
import { StockPermission, StockPermissionSchema } from '../stock/stock-permission.schema';
import { SupplyOrder, SupplyOrderSchema } from '../supply-orders/supply-order.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
      { name: StockPermission.name, schema: StockPermissionSchema },
      { name: SupplyOrder.name, schema: SupplyOrderSchema },
    ]),
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
