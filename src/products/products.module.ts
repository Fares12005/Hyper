import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from './product.schema';
import { ProductsService } from './products.service';
import { ProductsImportService } from './products-import.service';
import { ProductsController } from './products.controller';
import { ProductsPublicController } from './products.public.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }])],
  providers: [ProductsService, ProductsImportService],
  controllers: [ProductsController, ProductsPublicController],
  exports: [ProductsService],
})
export class ProductsModule {}
