import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  // POST /api/orders
  // - الكاشير: بيع مباشر (completed)
  // - العميل: طلب (pending)
  @Post()
  create(@Body() body: any, @Request() req) {
    return this.ordersService.create({ ...body, userId: req.user.userId, role: req.user.role });
  }

  // GET /api/orders/mine
  @Get('mine')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  mine(@Query('limit') limit: string, @Request() req) {
    return this.ordersService.findMine(req.user.userId, +limit || 100);
  }

  // GET /api/orders?status=completed&limit=20
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CALLCENTER, UserRole.STOCK, UserRole.DELIVERY)
  findAll(@Query('limit') limit: string, @Query('status') status: string) {
    return this.ordersService.findAll(+limit || 50, status);
  }

  // GET /api/orders/report?from=2026-01-01&to=2026-04-30
  @Get('report')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getReport(@Query('from') from: string, @Query('to') to: string) {
    return this.ordersService.getSalesReport(from, to);
  }

  // GET /api/orders/top-products
  @Get('top-products')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getTopProducts(@Query('limit') limit: string) {
    return this.ordersService.getTopProducts(+limit || 5);
  }

  /** كاشير: فواتير بيع «بدون مخزون» لم تُرسل بعد للمخزون */
  @Get('cashier/stock-drafts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.ADMIN)
  cashierStockDrafts(@Request() req) {
    return this.ordersService.findCashierStockDrafts(req.user.userId, req.user.role);
  }

  /** مخزون: طلبات مرسلة من الكاشير وبانتظار التسوية */
  @Get('stock/registration-inbox')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  stockRegistrationInbox() {
    return this.ordersService.findStockRegistrationInbox();
  }

  /** كاشير: إرسال فواتير مختارة لتظهر في شاشة المخزون */
  @Post('release-to-stock')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.ADMIN)
  releaseToStock(@Body() body: { orderIds?: string[] }, @Request() req) {
    return this.ordersService.releaseOrdersToStock(body?.orderIds || [], req.user.userId, req.user.role);
  }

  /** مخزون: تأكيد التسوية وخصم الكميات من الأرصدة */
  @Post('resolve-stock-registration')
  @UseGuards(RolesGuard)
  @Roles(UserRole.STOCK, UserRole.ADMIN)
  resolveStockRegistration(@Body() body: { orderIds?: string[] }, @Request() req) {
    return this.ordersService.resolveStockRegistration(body?.orderIds || [], req.user.userId);
  }

  /** كاشير: جلب طلب بمعرف العميل بعد مزامنة الفواتير بدون اتصال */
  @Get('client/:clientOrderId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.ADMIN)
  findByClientOrderId(@Param('clientOrderId') clientOrderId: string, @Request() req) {
    return this.ordersService.findByClientOrderIdForCashier(clientOrderId, req.user.userId, req.user.role);
  }

  // GET /api/orders/:id
  @Get(':id')
  findOne(@Param('id') id: string) { return this.ordersService.findById(id); }

  // PATCH /api/orders/:id/return-stock — كاشير: إرجاع كميات المنتجات للمخزون بعد المرتجع
  @Patch(':id/return-stock')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.ADMIN)
  returnStock(@Param('id') id: string, @Body() body: any) {
    return this.ordersService.applyPosReturn(id, body);
  }

  // PATCH /api/orders/:id/payment-method — كاشير: تعديل طريقة الدفع فقط (بدون مخزون)
  @Patch(':id/payment-method')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.ADMIN)
  updatePaymentMethod(@Param('id') id: string, @Body('paymentMethod') paymentMethod: string) {
    return this.ordersService.updatePaymentMethod(id, paymentMethod);
  }

  // PATCH /api/orders/:id/cancel
  @Patch(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CALLCENTER)
  cancel(@Param('id') id: string) { return this.ordersService.cancel(id); }

  // PATCH /api/orders/:id/confirm
  @Patch(':id/confirm')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CALLCENTER)
  confirm(@Param('id') id: string) { return this.ordersService.confirm(id); }

  // PATCH /api/orders/:id/preparing
  @Patch(':id/preparing')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CALLCENTER)
  preparing(@Param('id') id: string) { return this.ordersService.preparing(id); }

  // PATCH /api/orders/:id/ready
  @Patch(':id/ready')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CALLCENTER)
  ready(@Param('id') id: string) { return this.ordersService.ready(id); }

  // PATCH /api/orders/:id/delivered
  @Patch(':id/delivered')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DELIVERY, UserRole.CALLCENTER)
  delivered(@Param('id') id: string) { return this.ordersService.delivered(id); }
}
