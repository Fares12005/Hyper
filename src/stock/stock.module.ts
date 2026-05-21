import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockPermission, StockPermissionSchema } from './stock-permission.schema';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';
import { ProductsModule } from '../products/products.module';
import { User, UserSchema } from '../users/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockPermission.name, schema: StockPermissionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ProductsModule,
  ],
  providers: [StockService],
  controllers: [StockController],
})
export class StockModule {}
