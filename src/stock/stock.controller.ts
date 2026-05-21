import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request, Res } from '@nestjs/common';
import { StockService } from './stock.service';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import { Response } from 'express';
import * as XLSX from 'xlsx';

@Controller('stock')
@UseGuards(JwtAuthGuard)
export class StockController {
  constructor(private stockService: StockService) {}

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

  private permStatusLabel(s: string) {
    const x = String(s || '').toLowerCase();
    if (x === 'pending') return 'معلّق';
    if (x === 'approved') return 'معتمد';
    if (x === 'rejected') return 'مرفوض';
    return s || '';
  }

  private permTypeLabel(t: string) {
    const x = String(t || '').toLowerCase();
    if (x === 'receive') return 'استلام';
    if (x === 'return') return 'مرتجع';
    if (x === 'damage') return 'استهلاك/تالف';
    if (x === 'transfer') return 'تحويل';
    if (x === 'price_update') return 'تحديث سعر';
    return t || '';
  }

  private applySheetLayout(ws: any, cols?: number[]) {
    try {
      ws['!rtl'] = true;
      if (cols?.length) ws['!cols'] = cols.map((wch) => ({ wch }));
    } catch {
      // ignore layout errors
    }
  }

  /** صف عناوين ثم صف قيم (جدول أفقي) */
  private permIsReturn(perm: any) {
    return String(perm?.type || '').toLowerCase() === 'return';
  }

  /** كمية × سعر الكتالوج الحالي (لا ينطبق على تحديث السعر) */
  private permCatalogLineValue(perm: any): { unit: number | ''; line: number | '' } {
    const t = String(perm?.type || '').toLowerCase();
    if (t === 'price_update') return { unit: '', line: '' };
    const qty = Math.floor(Number(perm.qty)) || 0;
    const unit = Number(perm.product?.price);
    if (!Number.isFinite(unit)) return { unit: '', line: '' };
    const line = Math.round(qty * unit * 100) / 100;
    return { unit, line };
  }

  // GET /api/stock/permissions?type=return&status=pending&limit=200
  @Get('permissions')
  findPermissions(
    @Query('type') type: string,
    @Query('status') status: string,
    @Query('limit') limit: string,
  ) {
    return this.stockService.findPermissions(type, status, +limit || 200);
  }

  // POST /api/stock/ops/transfer-barcode-qty
  @Post('ops/transfer-barcode-qty')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  transferBarcodeQty(@Body() body: any, @Request() req) {
    return this.stockService.transferQtyBetweenBarcodes({
      fromBarcode: body?.fromBarcode,
      toBarcode: body?.toBarcode,
      qty: body?.qty,
      notes: body?.notes,
      userId: req.user.userId,
    });
  }

  // GET /api/stock/permissions/my?types=return,receive&permissionNumber=12&from=2026-05-01&to=2026-05-05&limit=200&skip=0
  @Get('permissions/my')
  myPermissions(
    @Query('types') typesCsv: string,
    @Query('type') typeSingle: string,
    @Query('permissionNumber') permissionNumberRaw: string,
    @Query('from') fromRaw: string,
    @Query('to') toRaw: string,
    @Query('limit') limitRaw: string,
    @Query('skip') skipRaw: string,
    @Request() req,
  ) {
    const types = (typesCsv || typeSingle || '')
      .split(',')
      .map(s => String(s || '').trim())
      .filter(Boolean);

    const permissionNumber = permissionNumberRaw ? Number(permissionNumberRaw) : undefined;

    // Accept either full ISO or YYYY-MM-DD; treat as local date boundaries
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    // If "to" is a date-only string, include the full day by pushing to end-of-day
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(toRaw).trim())) {
      to.setHours(23, 59, 59, 999);
    }

    return this.stockService.findMyPermissions({
      userId: req.user.userId,
      types: types.length ? types : undefined,
      permissionNumber: Number.isFinite(permissionNumber) ? permissionNumber : undefined,
      from: from && !isNaN(from.getTime()) ? from : undefined,
      to: to && !isNaN(to.getTime()) ? to : undefined,
      limit: Number(limitRaw),
      skip: Number(skipRaw),
    });
  }

  // GET /api/stock/permissions/:id
  @Get('permissions/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.stockService.findPermissionById(id);
  }

  // POST /api/stock/permissions
  @Post('permissions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  createPermission(@Body() body: any, @Request() req) {
    return this.stockService.createPermission({ ...body, userId: req.user.userId });
  }

  // PATCH /api/stock/permissions/:id/approve
  @Patch('permissions/:id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  approve(@Param('id') id: string, @Request() req) {
    return this.stockService.approvePermission(id, req.user.userId);
  }

  // PATCH /api/stock/permissions/:id/reject
  @Patch('permissions/:id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  reject(@Param('id') id: string, @Request() req) {
    return this.stockService.rejectPermission(id, req.user.userId);
  }

  // GET /api/stock/permissions/:id/export
  @Get('permissions/:id/export')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  async exportExcel(@Param('id') id: string, @Res() res: Response) {
    const perm: any = await this.stockService.findPermissionById(id);
    const wb = XLSX.utils.book_new();

    const isReturn = this.permIsReturn(perm);
    const barcode = String(perm.product?.barcode || '').trim() || '—';
    const category = String(perm.product?.category || '').trim() || '—';
    const { unit: catUnit, line: catLine } = this.permCatalogLineValue(perm);

    const infoHeaders = [
      'رقم الإذن',
      'نوع الإذن',
      'إذن مرتجع',
      'الحالة',
      'الصنف',
      'الباركود',
      'الكاتيجوري',
      'الكمية',
      'سعر الوحدة (كتالوج)',
      'إجمالي القيمة',
      'السعر القديم',
      'السعر الجديد',
      'تم الإنشاء بواسطة',
      'تاريخ الإنشاء',
      'تم الاعتماد بواسطة',
      'تاريخ الاعتماد',
      'ملاحظات',
    ];
    const infoValues = [
      String(perm.permissionNumber ?? perm._id),
      this.permTypeLabel(perm.type),
      isReturn ? 'نعم' : 'لا',
      this.permStatusLabel(perm.status),
      perm.productName,
      barcode,
      category,
      Number(perm.qty) || 0,
      catUnit === '' ? '' : catUnit,
      catLine === '' ? '' : catLine,
      perm.oldPrice ?? '',
      perm.newPrice ?? '',
      perm.createdByDisplayName || perm.createdBy?.name || perm.createdBy?.username || '—',
      this.fmtArDateTime(perm.createdAt),
      perm.approvedByDisplayName || perm.approvedBy?.name || perm.approvedBy?.username || '—',
      this.fmtArDateTime(perm.updatedAt),
      perm.notes || '',
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet([infoHeaders, infoValues]);
    this.applySheetLayout(wsInfo, [10, 14, 10, 10, 28, 16, 16, 8, 14, 14, 10, 10, 18, 18, 18, 18, 22]);
    XLSX.utils.book_append_sheet(wb, wsInfo, 'معلومات');

    const lineAoa = [
      [
        'نوع الإذن',
        'إذن مرتجع',
        'الصنف',
        'الباركود',
        'الكاتيجوري',
        'الكمية',
        'سعر الوحدة (كتالوج)',
        'إجمالي القيمة',
        'السعر القديم',
        'السعر الجديد',
      ],
      [
        this.permTypeLabel(perm.type),
        isReturn ? 'نعم' : 'لا',
        perm.productName,
        barcode,
        category,
        Number(perm.qty) || 0,
        catUnit === '' ? '' : catUnit,
        catLine === '' ? '' : catLine,
        perm.oldPrice ?? '',
        perm.newPrice ?? '',
      ],
    ];
    const wsLine = XLSX.utils.aoa_to_sheet(lineAoa);
    this.applySheetLayout(wsLine, [14, 10, 40, 16, 16, 10, 12, 12, 12, 12]);
    XLSX.utils.book_append_sheet(wb, wsLine, 'البنود');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="stock_permission_${perm._id}.xlsx"`);
    res.send(buf);
  }
}
