import { Body, Controller, Get, Param, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import { ReceivingPermissionsService } from './receiving-permissions.service';
import * as XLSX from 'xlsx';

@Controller('receiving-permissions')
@UseGuards(JwtAuthGuard)
export class ReceivingPermissionsController {
  constructor(private receivingService: ReceivingPermissionsService) {}

  private fmtArDateTime(v: any) {
    try {
      if (!v) return '';
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return String(v || '');
    }
  }

  private recStatusLabel(s: string) {
    const x = String(s || '').toLowerCase();
    if (x === 'pending') return 'معلّق';
    if (x === 'accepted') return 'مستلم';
    if (x === 'rejected') return 'مرفوض';
    return s || '';
  }

  private comparisonLabel(v: string) {
    const x = String(v || '').toLowerCase();
    if (x === 'matched') return 'مطابق';
    if (x === 'different') return 'مختلف';
    return v || '';
  }

  private applySheetLayout(ws: any, cols?: number[]) {
    try {
      ws['!rtl'] = true;
      if (cols?.length) ws['!cols'] = cols.map((wch) => ({ wch }));
    } catch {
      // ignore layout errors
    }
  }

  // GET /api/receiving-permissions?status=pending&limit=200
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findAll(@Query('limit') limit: string, @Query('status') status: string) {
    return this.receivingService.findAll(+limit || 200, status);
  }

  // GET /api/receiving-permissions/:id
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.receivingService.findById(id);
  }

  // POST /api/receiving-permissions/for-order/:orderId  (idempotent)
  @Post('for-order/:orderId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  createForOrder(@Param('orderId') orderId: string, @Request() req) {
    return this.receivingService.createForSupplierOrder(orderId, req.user.userId);
  }

  // PATCH /api/receiving-permissions/:id/accept
  @Patch(':id/accept')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  accept(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.receivingService.accept(id, req.user.userId, body);
  }

  // PATCH /api/receiving-permissions/:id/reject
  @Patch(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  reject(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.receivingService.reject(id, req.user.userId, body);
  }

  // GET /api/receiving-permissions/:id/export
  @Get(':id/export')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  async exportExcel(@Param('id') id: string, @Res() res: Response) {
    const rec: any = await this.receivingService.findById(id);
    const wb = XLSX.utils.book_new();

    const infoHeaders = [
      'رقم الإذن',
      'المورد',
      'الحالة',
      'نتيجة المقارنة',
      'تم الإنشاء بواسطة',
      'تاريخ الإنشاء',
      'آخر إجراء بواسطة',
      'تاريخ آخر إجراء',
      'ملاحظات',
    ];
    const infoValues = [
      rec.permissionNumber,
      rec.supplierName,
      this.recStatusLabel(rec.status),
      this.comparisonLabel(rec.comparisonResult || ''),
      rec.createdByDisplayName || rec.createdBy?.name || rec.createdBy?.username || '—',
      this.fmtArDateTime(rec.createdAt),
      rec.actionByDisplayName || rec.actionBy?.name || rec.actionBy?.username || '—',
      this.fmtArDateTime(rec.actionAt),
      rec.notes || '',
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet([infoHeaders, infoValues]);
    this.applySheetLayout(wsInfo, [14, 24, 12, 14, 18, 18, 18, 18, 28]);
    XLSX.utils.book_append_sheet(wb, wsInfo, 'معلومات');

    const itemsAoa = [
      ['الصنف', 'المطلوب', 'المستلم', 'الفرق'],
      ...(rec.items || []).map((it: any) => [
        it.productName,
        Number(it.requestedQty) || 0,
        Number(it.receivedQty) || 0,
        (Number(it.receivedQty) || 0) - (Number(it.requestedQty) || 0),
      ]),
    ];
    const wsItems = XLSX.utils.aoa_to_sheet(itemsAoa);
    this.applySheetLayout(wsItems, [44, 12, 12, 12]);
    XLSX.utils.book_append_sheet(wb, wsItems, 'الأصناف');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="receiving_${rec.permissionNumber}.xlsx"`);
    res.send(buf);
  }
}

