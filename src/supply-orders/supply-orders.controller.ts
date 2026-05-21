import { Body, Controller, Get, Param, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SupplyOrdersService } from './supply-orders.service';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import * as XLSX from 'xlsx';

@Controller('supply-orders')
@UseGuards(JwtAuthGuard)
export class SupplyOrdersController {
  constructor(private supplyOrdersService: SupplyOrdersService) {}

  // POST /api/supply-orders
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  create(@Body() body: any, @Request() req) {
    return this.supplyOrdersService.create({ ...body, userId: req.user.userId });
  }

  // GET /api/supply-orders?status=pending&limit=100
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findAll(@Query('limit') limit: string, @Query('status') status: string) {
    return this.supplyOrdersService.findAll(+limit || 100, status);
  }

  // GET /api/supply-orders/:id
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.supplyOrdersService.findById(id);
  }

  // PATCH /api/supply-orders/:id/approve
  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  approve(@Param('id') id: string, @Request() req) {
    return this.supplyOrdersService.approve(id, req.user.userId);
  }

  // PATCH /api/supply-orders/:id/reject
  @Patch(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  reject(@Param('id') id: string, @Request() req) {
    return this.supplyOrdersService.reject(id, req.user.userId);
  }

  // PATCH /api/supply-orders/:id/fulfill
  @Patch(':id/fulfill')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  fulfill(@Param('id') id: string, @Request() req) {
    return this.supplyOrdersService.fulfill(id, req.user.userId);
  }

  // GET /api/supply-orders/:id/export
  @Get(':id/export')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  async exportExcel(@Param('id') id: string, @Res() res: Response) {
    const o: any = await this.supplyOrdersService.findById(id);
    const wb = XLSX.utils.book_new();

    const header = [
      ['طلب توريد داخلي', o.orderNumber],
      ['الحالة', o.status],
      ['الأولوية', o.priority],
      ['السبب', o.reason || ''],
      ['ملاحظات', o.notes || ''],
      ['تاريخ الإنشاء', o.createdAt ? new Date(o.createdAt).toISOString() : ''],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(header);
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Info');

    const rows = (o.items || []).map((it: any) => ({
      productName: it.productName,
      qty: it.qty,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Items');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="supply_order_${o.orderNumber}.xlsx"`);
    res.send(buf);
  }
}

