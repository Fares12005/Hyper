import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  // GET /api/suppliers?active=1
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findAll(@Query('active') active: string) {
    const activeOnly = !(String(active || '') === '0' || String(active || '').toLowerCase() === 'false');
    return this.suppliersService.findAll(activeOnly);
  }

  // POST /api/suppliers
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  create(@Body() body: any, @Request() _req) {
    return this.suppliersService.create(body);
  }

  // PATCH /api/suppliers/:id
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  update(@Param('id') id: string, @Body() body: any) {
    return this.suppliersService.update(id, body);
  }

  // PATCH /api/suppliers/:supplierId/products/:productId  { enabled: true|false }
  @Patch(':supplierId/products/:productId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  setProductRelation(@Param('supplierId') supplierId: string, @Param('productId') productId: string, @Body() body: any) {
    return this.suppliersService.setProductRelation(supplierId, productId, Boolean(body?.enabled));
  }

  // GET /api/suppliers/for-product/:productId
  @Get('for-product/:productId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  forProduct(@Param('productId') productId: string) {
    return this.suppliersService.findSuppliersForProduct(productId);
  }
}

