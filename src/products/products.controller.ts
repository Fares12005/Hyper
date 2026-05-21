import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, UploadedFile } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsImportService } from './products-import.service';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';
import { extname } from 'path';
import { memoryStorage } from 'multer';
import { diskStorage } from 'multer';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private productsImport: ProductsImportService,
  ) {}

  // GET /api/products?category=فواكه&search=تفاح
  @Get()
  findAll(
    @Query('category') category: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @Query('skip') skip: string,
    @Query('all') all: string,
    @Query('byWeight') byWeight: string,
  ) {
    if (String(byWeight || '').toLowerCase() === 'true' || byWeight === '1') {
      return this.productsService.findWeightProducts(category, search);
    }
    // Optional: return all products (no paging) to keep clients in sync.
    if (String(all || '').toLowerCase() === 'true' || all === '1') {
      return this.productsService.findAll(category, search);
    }
    // Default to paged mode to keep the app fast with large catalogs.
    return this.productsService.findPaged(category, search, Number(limit || 200), Number(skip || 0));
  }

  // GET /api/products/low-stock
  @Get('low-stock')
  getLowStock() { return this.productsService.getLowStock(); }

  // GET /api/products/categories
  @Get('categories')
  getCategories() { return this.productsService.getCategories(); }

  // GET /api/products/suggest?q=عنب&limit=20
  @Get('suggest')
  suggest(@Query('q') q: string, @Query('limit') limit: string) {
    return this.productsService.suggest(q, Number(limit || 20));
  }

  // GET /api/products/barcode/:code
  @Get('barcode/:code')
  findByBarcode(@Param('code') code: string) {
    return this.productsService.findByBarcode(code);
  }

  // GET /api/products/:id
  @Get(':id')
  findOne(@Param('id') id: string) { return this.productsService.findById(id); }

  // POST /api/products  (admin + stock only)
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  create(@Body() body: any) { return this.productsService.create(body); }

  // PATCH /api/products/:id
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  update(@Param('id') id: string, @Body() body: any) {
    return this.productsService.update(id, body);
  }

  /** فرض تطابق scalePlu مع الباركود الرقمي — مسار أطول يُعلَن قبل scale-plu العادي */
  @Post(':id/scale-plu/sync-from-barcode')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  syncScalePluFromBarcode(@Param('id') id: string) {
    return this.productsService.syncScalePluFromBarcode(id);
  }

  // POST /api/products/:id/scale-plu  (admin + stock only)
  @Post(':id/scale-plu')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  assignScalePlu(@Param('id') id: string) {
    return this.productsService.assignScalePlu(id);
  }

  // POST /api/products/:id/image (admin + stock only)
  @Post(':id/image')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: 'uploads/products',
      filename: (_req, file, cb) => {
        const safeExt = extname(file.originalname || '').toLowerCase() || '.jpg';
        const name = `p_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExt}`;
        cb(null, name);
      }
    }),
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
      cb(ok ? null : new Error('Only image files are allowed'), ok);
    },
    limits: { fileSize: 6 * 1024 * 1024 },
  }))
  async uploadImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const url = file ? `/uploads/products/${file.filename}` : '';
    return this.productsService.update(id, { imageUrl: url });
  }

  // POST /api/products/import/items-tree  (admin only)
  // Upload: multipart/form-data with field name "file"
  @Post('import/items-tree')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  }))
  async importItemsTree(
    @UploadedFile() file: Express.Multer.File,
    @Query('mode') mode?: string,
  ) {
    const replace = String(mode || '').toLowerCase() === 'replace';
    return replace ? this.productsImport.resetAndImport(file) : this.productsImport.mergeImport(file);
  }

  // DELETE /api/products/purge (admin only) — لازم يفضل قبل @Delete(':id') عشان مايتلخبطش مع id = "purge"
  // Removes ALL products from DB immediately.
  @Delete('purge')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async purgeAllProducts() {
    return this.productsImport.purgeAll();
  }

  // DELETE /api/products/:id  (admin only)
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  delete(@Param('id') id: string) {
    return this.productsService.delete(id);
  }
}
