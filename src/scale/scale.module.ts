import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScaleController } from './scale.controller';
import { ScaleService } from './scale.service';
import { Product, ProductSchema } from '../products/product.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
  ],
  controllers: [ScaleController],
  providers: [ScaleService],
})
export class ScaleModule {}

