import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { StockModule } from './stock/stock.module';
import { SupplyOrdersModule } from './supply-orders/supply-orders.module';
import { ScaleModule } from './scale/scale.module';
import { SequencesModule } from './sequences/sequences.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { SupplierOrdersModule } from './supplier-orders/supplier-orders.module';
import { ReceivingPermissionsModule } from './receiving-permissions/receiving-permissions.module';
import { ReservationsModule } from './reservations/reservations.module';
import { DeviceLicensesModule } from './device-licenses/device-licenses.module';

@Module({
  imports: [
    // Load .env
    ConfigModule.forRoot({ isGlobal: true }),

    // MongoDB Connection
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/hypermart'),

    // Feature Modules
    AuthModule,
    UsersModule,
    ProductsModule,
    OrdersModule,
    StockModule,
    SupplyOrdersModule,
    ScaleModule,
    SequencesModule,
    SuppliersModule,
    SupplierOrdersModule,
    ReceivingPermissionsModule,
    ReservationsModule,
    DeviceLicensesModule,
  ],
})
export class AppModule {}
