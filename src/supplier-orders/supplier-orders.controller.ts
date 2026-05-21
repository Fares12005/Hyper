import { Body, Controller, Get, Param, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import { SupplierOrdersService } from './supplier-orders.service';
import * as XLSX from 'xlsx';

@Controller('supplier-orders')
@UseGuards(JwtAuthGuard)
export class SupplierOrdersController {
  constructor(private supplierOrdersService: SupplierOrdersService) {}

  // POST /api/supplier-orders
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  create(@Body() body: any, @Request() req) {
    return this.supplierOrdersService.create({ ...body, userId: req.user.userId });
  }

  // GET /api/supplier-orders?status=open&limit=200
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findAll(@Query('limit') limit: string, @Query('status') status: string) {
    return this.supplierOrdersService.findAll(+limit || 200, status);
  }

  // GET /api/supplier-orders/open
  @Get('open')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  open(@Query('limit') limit: string) {
    return this.supplierOrdersService.findOpen(+limit || 200);
  }

  // GET /api/supplier-orders/archive
  @Get('archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  archive(@Query('limit') limit: string) {
    return this.supplierOrdersService.findArchive(+limit || 200);
  }

  // GET /api/supplier-orders/:id
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.supplierOrdersService.findById(id);
  }

  // GET /api/supplier-orders/:id/export
  @Get(':id/export')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  async exportExcel(@Param('id') id: string, @Res() res: Response) {
    const order: any = await this.supplierOrdersService.findById(id);

    const wb = XLSX.utils.book_new();
    const header = [
      ['أمر توريد', order.orderNumber],
      ['المورد', order.supplierName],
      ['الحالة', order.status],
      ['تاريخ الإنشاء', order.createdAt ? new Date(order.createdAt).toISOString() : ''],
      ['ملاحظات', order.notes || ''],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(header);
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Info');

    const rows = (order.items || []).map((it: any) => ({
      productName: it.productName,
      category: it.category,
      qty: it.qty,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Items');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="supplier_order_${order.orderNumber}.xlsx"`);
    res.send(buf);
  }
}

