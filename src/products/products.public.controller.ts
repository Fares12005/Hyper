import { Controller, Get, Param } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('public/products')
export class ProductsPublicController {
  constructor(private productsService: ProductsService) {}

  // GET /api/public/products/barcode/:code
  @Get('barcode/:code')
  async findByBarcodePublic(@Param('code') code: string) {
    const p: any = await this.productsService.findByBarcode(code);
    if (!p) return null;
    return {
      id: String(p._id || p.id || ''),
      name: p.name,
      price: p.price,
      barcode: p.barcode,
    };
  }
}

