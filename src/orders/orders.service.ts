import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus, PaymentMethod } from './order.schema';
import { ProductsService } from '../products/products.service';
import { User, UserDocument, UserRole } from '../users/user.schema';

function hasReleasedToStock(o: OrderDocument): boolean {
  const d = o.get?.('releasedToStockAt') ?? (o as any).releasedToStockAt;
  return d instanceof Date && Number.isFinite(d.getTime());
}

/** دفع مُجزّأ من الكاشير: paymentSplits يطابق إجمالي الفاتورة */
function normalizePosPaymentSplits(
  data: { paymentMethod?: string; paymentSplits?: any[] },
  total: number,
  isCustomer: boolean,
): { paymentMethod: string; paymentSplits?: { method: string; amount: number }[] } {
  const raw = data?.paymentSplits;
  if (!Array.isArray(raw) || raw.length < 2) {
    const pm = String(data?.paymentMethod || 'cash').trim().toLowerCase();
    return { paymentMethod: pm || 'cash' };
  }
  if (isCustomer) {
    throw new BadRequestException('تقسيم الدفع غير متاح لطلبات العملاء');
  }
  const splits: { method: string; amount: number }[] = [];
  let sum = 0;
  for (const row of raw) {
    const method = String(row?.method || '').trim().toLowerCase();
    if (!['cash', 'card', 'wallet'].includes(method)) {
      throw new BadRequestException('طريقة دفع غير صالحة في تقسيم الدفع');
    }
    const amount = Number(row?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('مبلغ غير صالح في تقسيم الدفع');
    }
    const rounded = Math.round(amount * 100) / 100;
    splits.push({ method, amount: rounded });
    sum += rounded;
  }
  const totalRounded = Math.round(total * 100) / 100;
  if (Math.abs(sum - totalRounded) > 0.02) {
    throw new BadRequestException(
      `مجموع الدفعات (${sum.toFixed(2)}) يجب أن يساوي إجمالي الفاتورة (${totalRounded.toFixed(2)})`,
    );
  }
  return { paymentMethod: 'mixed', paymentSplits: splits };
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private productsService: ProductsService,
  ) {}

  private async generateOrderNumber(): Promise<string> {
    const count = await this.orderModel.countDocuments();
    return `ORD-${String(count + 1).padStart(5, '0')}`;
  }

  async create(data: {
    items: any[];
    paymentMethod: string;
    /** [{ method: cash|card|wallet, amount }] — عند وجود عنصرين أو أكثر يُخزَّن كـ mixed */
    paymentSplits?: { method: string; amount: number }[];
    clientOrderId?: string;
    userId: string;
    role: string;
    notes?: string;
    customerName?: string;
    customerPhone?: string;
    deliveryAddress?: string;
    /** كاشير فقط: لا تحقق من الرصيد ولا خصم من المخزون — التسوية من شاشة المخزون */
    skipStockDeduction?: boolean;
  }) {
    // Idempotency for POS offline queue: if clientOrderId already exists, return it.
    const clientOrderId = String(data.clientOrderId || '').trim();
    if (clientOrderId) {
      const ex = await this.orderModel.findOne({ clientOrderId });
      if (ex) return ex;
    }

    const isCustomer = data.role === UserRole.CUSTOMER;
    const skipStock =
      Boolean(data.skipStockDeduction) && data.role === UserRole.CASHIER && !isCustomer;
    const allowDeferPerItem = data.role === UserRole.CASHIER && !isCustomer;

    // حساب الأسعار والتحقق من المخزون
    let subtotal = 0;
    const orderItems: any[] = [];
    let hasDeferredStockItems = false;

    for (const item of data.items || []) {
      const rawAdHoc = item?.adHoc;
      if (rawAdHoc && typeof rawAdHoc === 'object') {
        if (!skipStock) {
          throw new BadRequestException('الأصناف اليدوية متاحة فقط مع «بيع بدون خصم من المخزون»');
        }
        const name = String(rawAdHoc.name || '').trim();
        const price = Number(rawAdHoc.price);
        const qty = Math.floor(Number(item.qty ?? rawAdHoc.qty));
        const barcode = String(rawAdHoc.barcode || '').trim();
        if (!name) throw new BadRequestException('اكتب اسم الصنف للأصناف غير المسجّلة');
        if (!Number.isFinite(price) || price < 0) throw new BadRequestException('سعر غير صالح للصنف اليدوي');
        if (!Number.isFinite(qty) || qty < 1) throw new BadRequestException('كمية غير صالحة للصنف اليدوي');
        const total = Math.round(price * qty * 100) / 100;
        subtotal += total;
        orderItems.push({
          name,
          price,
          qty,
          total,
          barcode: barcode || undefined,
          isAdHoc: true,
          deferStockDeduction: true,
          returnedQty: 0,
        });
        continue;
      }

      const product = await this.productsService.findById(item.productId);
      const deferStockDeduction =
        Boolean(item?.deferStockDeduction) && allowDeferPerItem && !skipStock;
      if (deferStockDeduction) hasDeferredStockItems = true;
      if (!skipStock && !deferStockDeduction && product.stock < item.qty) {
        throw new BadRequestException(`الكمية المطلوبة من "${product.name}" أكبر من المتاح (${product.stock})`);
      }
      const pct = Number((product as any).discountPercent ?? 0);
      const activeFlag = Boolean((product as any).discountActive);
      const from = (product as any).discountFrom ? new Date((product as any).discountFrom) : null;
      const to = (product as any).discountTo ? new Date((product as any).discountTo) : null;
      const now = new Date();
      const inWindow =
        (!from || !Number.isFinite(from.getTime()) || now >= from) &&
        (!to || !Number.isFinite(to.getTime()) || now <= to);
      const active = activeFlag && inWindow;
      const unitPrice =
        active && Number.isFinite(pct) && pct > 0
          ? Math.max(0, Math.round(product.price * (1 - Math.min(100, pct) / 100) * 100) / 100)
          : product.price;
      const total = unitPrice * item.qty;
      subtotal += total;
      orderItems.push({
        product: product._id,
        name: product.name,
        price: unitPrice,
        qty: item.qty,
        total,
        barcode: String((product as any).barcode || '').trim() || undefined,
        isAdHoc: false,
        deferStockDeduction: Boolean(skipStock || deferStockDeduction),
        returnedQty: 0,
      });
    }

    // الضريبة ملغية بالكامل في النظام
    const tax = 0;
    const total = subtotal;
    const orderNumber = await this.generateOrderNumber();

    const payResolved = normalizePosPaymentSplits(data, total, isCustomer);

    // إنشاء الأوردر
    if (isCustomer) {
      const name = String(data.customerName || '').trim();
      const phone = String(data.customerPhone || '').trim();
      const address = String(data.deliveryAddress || '').trim();
      if (!name || !phone || !address) {
        throw new BadRequestException('لازم تكتب (الاسم/رقم الموبايل/العنوان) قبل إرسال الطلب');
      }
    }
    let actorDisplayName = '';
    try {
      const actor = await this.userModel.findById(data.userId).select('name').lean();
      actorDisplayName = String((actor as any)?.name || '').trim();
    } catch {
      /* ignore */
    }
    const order = await this.orderModel.create({
      clientOrderId: clientOrderId || undefined,
      orderNumber, items: orderItems, subtotal, tax, total,
      paymentMethod: payResolved.paymentMethod as any,
      ...(payResolved.paymentSplits ? { paymentSplits: payResolved.paymentSplits } : {}),
      status: isCustomer ? OrderStatus.PENDING : OrderStatus.COMPLETED,
      cashier: isCustomer ? undefined : (data.userId as any),
      customer: isCustomer ? (data.userId as any) : undefined,
      cashierDisplayName: !isCustomer && actorDisplayName ? actorDisplayName : undefined,
      customerAccountDisplayName: isCustomer && actorDisplayName ? actorDisplayName : undefined,
      customerName: isCustomer ? String(data.customerName || '').trim() : undefined,
      customerPhone: isCustomer ? String(data.customerPhone || '').trim() : undefined,
      deliveryAddress: isCustomer ? String(data.deliveryAddress || '').trim() : undefined,
      notes: data.notes,
      stockDeductedAtSale: !(skipStock || hasDeferredStockItems),
      pendingStockRegistration: Boolean(skipStock || hasDeferredStockItems),
      releasedToStockAt: undefined,
      stockRegistrationResolved: false,
    });

    // خصم الكميات من المخزون (البيع العادي فقط)
    if (!skipStock) {
      for (const item of data.items || []) {
        if (item?.adHoc) continue;
        if (Boolean(item?.deferStockDeduction) && allowDeferPerItem) continue;
        await this.productsService.updateStock(item.productId, -item.qty);
      }
    }

    return order;
  }

  /** فواتير «بدون مخزون» لم يُرسَلها الكاشير بعد للمخزون */
  findCashierStockDrafts(userId: string, role: string) {
    const q: any = {
      pendingStockRegistration: true,
      stockRegistrationResolved: { $ne: true },
      $or: [{ releasedToStockAt: null }, { releasedToStockAt: { $exists: false } }],
    };
    if (role !== UserRole.ADMIN) {
      q.cashier = userId as any;
    }
    return this.orderModel
      .find(q)
      .sort({ createdAt: -1 })
      .limit(200)
      .select(
        'orderNumber items total cashierDisplayName createdAt pendingStockRegistration releasedToStockAt paymentMethod',
      )
      .lean();
  }

  /** مرسلة من الكاشير وبانتظار تسوية المخزون */
  findStockRegistrationInbox() {
    return this.orderModel
      .find({
        pendingStockRegistration: true,
        releasedToStockAt: { $ne: null },
        stockRegistrationResolved: { $ne: true },
      })
      .sort({ releasedToStockAt: -1 })
      .limit(300)
      .populate('cashier', 'name username')
      .lean();
  }

  async releaseOrdersToStock(orderIds: string[], userId: string, role: string) {
    const ids = (orderIds || []).map((id) => String(id || '').trim()).filter(Boolean);
    if (!ids.length) throw new BadRequestException('لم يُحدد أي طلب');
    const now = new Date();
    let updated = 0;
    for (const id of ids) {
      const order = await this.orderModel.findById(id);
      if (!order) continue;
      if (!order.pendingStockRegistration || order.stockRegistrationResolved) continue;
      if (hasReleasedToStock(order)) continue;
      if (role !== UserRole.ADMIN && String(order.cashier) !== String(userId)) {
        throw new BadRequestException('لا يمكن إرسال طلب صادر من كاشير آخر');
      }
      order.releasedToStockAt = now;
      await order.save();
      updated += 1;
    }
    return { updated };
  }

  /** خصم الكميات المتأخرة من أرصدة المنتجات بعد تسجيلها في المخزون */
  async resolveStockRegistration(orderIds: string[], resolverUserId: string) {
    const rawIds = (orderIds || []).map((id) => String(id || '').trim()).filter(Boolean);
    const ids = [...new Set(rawIds)];
    if (!ids.length) throw new BadRequestException('لم يُحدد أي طلب');
    const now = new Date();

    const ordersToResolve: OrderDocument[] = [];
    for (const id of ids) {
      const order = await this.orderModel.findById(id);
      if (!order) continue;
      if (!order.pendingStockRegistration || order.stockRegistrationResolved) continue;
      if (!hasReleasedToStock(order)) {
        throw new BadRequestException(`الطلب ${order.orderNumber} لم يُرسَل من الكاشير بعد`);
      }
      ordersToResolve.push(order);
    }

    /** إجمالي الكميات المطلوب خصمها لكل منتج (كل الطلبات المختارة) */
    const deductByProduct = new Map<string, number>();
    for (const order of ordersToResolve) {
      for (const it of order.items as any[]) {
        if (it?.isAdHoc || !it?.product) continue;
        // لو السطر اتخصم بالفعل وقت البيع، مش محتاج خصم في التسوية
        if (it?.deferStockDeduction === false) continue;
        const pid = String(it.product);
        const q = Math.max(0, Math.floor(Number(it.qty) || 0));
        if (q <= 0) continue;
        deductByProduct.set(pid, (deductByProduct.get(pid) || 0) + q);
      }
    }

    for (const [productId, needQty] of deductByProduct) {
      const product = await this.productsService.findById(productId);
      const available = Math.max(0, Math.floor(Number((product as any).stock) || 0));
      if (available < needQty) {
        throw new BadRequestException(
          `لا يمكن تأكيد التسوية: رصيد «${product.name}» غير كافٍ. المتاح ${available} والمطلوب خصمه ${needQty}. سجّل واردة أو زِد الرصيد أولاً.`,
        );
      }
    }

    let resolved = 0;
    for (const order of ordersToResolve) {
      for (const it of order.items as any[]) {
        if (it?.isAdHoc || !it?.product) continue;
        if (it?.deferStockDeduction === false) continue;
        await this.productsService.updateStock(String(it.product), -Number(it.qty) || 0);
      }
      order.stockRegistrationResolved = true;
      order.stockRegistrationResolvedAt = now;
      order.pendingStockRegistration = false;
      order.stockResolvedBy = resolverUserId as any;
      await order.save();
      resolved += 1;
    }
    return { resolved };
  }

  findAll(limit = 50, status?: string) {
    const filter: any = {};
    if (status) filter.status = status;
    return this.orderModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('cashier', 'name username')
      .populate('customer', 'name username');
  }

  async findById(id: string) {
    const order = await this.orderModel.findById(id)
      .populate('cashier', 'name username')
      .populate('customer', 'name username');
    if (!order) throw new NotFoundException('الأوردر مش موجود');
    return order;
  }

  /** جلب طلب بمعرف العميل (POS offline) — الكاشير يرى طلباته فقط */
  async findByClientOrderIdForCashier(clientOrderId: string, userId: string, role: string) {
    const cid = String(clientOrderId || '').trim();
    if (!cid) throw new BadRequestException('معرف الطلب المحلي غير صالح');
    const order = await this.orderModel
      .findOne({ clientOrderId: cid })
      .populate('cashier', 'name username')
      .populate('customer', 'name username');
    if (!order) throw new NotFoundException('الأوردر مش موجود');
    if (role !== UserRole.ADMIN && String(order.cashier) !== String(userId)) {
      throw new ForbiddenException('لا يمكن عرض طلب كاشير آخر');
    }
    return order;
  }

  findMine(userId: string, limit = 100) {
    return this.orderModel.find({ customer: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('customer', 'name username');
  }

  async setStatus(id: string, nextStatus: OrderStatus) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('الأوردر مش موجود');
    order.status = nextStatus;
    return order.save();
  }

  async confirm(id: string) {
    const o = await this.findById(id);
    if (o.status !== OrderStatus.PENDING) throw new BadRequestException('لا يمكن تأكيد الطلب في هذه الحالة');
    return this.setStatus(id, OrderStatus.CONFIRMED);
  }

  async preparing(id: string) {
    const o = await this.findById(id);
    if (![OrderStatus.CONFIRMED, OrderStatus.PENDING].includes(o.status as any)) {
      throw new BadRequestException('لا يمكن نقل الطلب للتحضير في هذه الحالة');
    }
    return this.setStatus(id, OrderStatus.PREPARING);
  }

  async ready(id: string) {
    const o = await this.findById(id);
    if (o.status !== OrderStatus.PREPARING) throw new BadRequestException('لا يمكن جعل الطلب جاهز إلا بعد التحضير');
    return this.setStatus(id, OrderStatus.READY);
  }

  async delivered(id: string) {
    const o = await this.findById(id);
    if (o.status !== OrderStatus.READY) throw new BadRequestException('لا يمكن التسليم إلا بعد أن يكون جاهز للتسليم');
    return this.setStatus(id, OrderStatus.DELIVERED);
  }

  async cancel(id: string) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('الأوردر مش موجود');
    if (order.status !== OrderStatus.COMPLETED) throw new BadRequestException('الأوردر مش في حالة تسمح بالإلغاء');

    const stockWasDeducted = order.get('stockDeductedAtSale') !== false;
    // رجّع الكميات للمخزون فقط إذا كان الخصم قد تم وقت البيع
    if (stockWasDeducted) {
      for (const item of order.items) {
        if ((item as any).isAdHoc || !(item as any).product) continue;
        await this.productsService.updateStock(String(item.product), +item.qty);
      }
    }
    order.status = OrderStatus.CANCELLED;
    return order.save();
  }

  /** مرتجع كاشير: إرجاع أصناف الفاتورة للمخزون (مرة واحدة لكل طلب) */
  async applyPosReturn(id: string, body?: any) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('الأوردر مش موجود');
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('المرتجع متاح لفواتير البيع المكتملة فقط');
    }

    const returnMaxAgeMs = 24 * 60 * 60 * 1000;
    const createdAt = order.get('createdAt') as Date | undefined;
    if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
      throw new BadRequestException('لا يمكن التحقق من تاريخ الفاتورة للمرتجع');
    }
    if (Date.now() - createdAt.getTime() > returnMaxAgeMs) {
      throw new BadRequestException('مرتجع غير مسموح: مرّ أكثر من 24 ساعة على وقت الفاتورة');
    }

    const reqItemsRaw = body?.items;
    const reqItems = Array.isArray(reqItemsRaw) ? reqItemsRaw : null;

    // Normalize order items: returnedQty default
    for (const it of order.items as any[]) {
      if (typeof it.returnedQty !== 'number' || !Number.isFinite(it.returnedQty) || it.returnedQty < 0) {
        it.returnedQty = 0;
      }
    }

    const byProductId = new Map<string, any>();
    for (const it of order.items as any[]) {
      byProductId.set(String(it.product), it);
    }

    // If no body.items -> full return of remaining quantities.
    const toReturn: Array<{ productId: string; qty: number }> = [];
    if (!reqItems) {
      for (const it of order.items as any[]) {
        if (it.isAdHoc || !it.product) continue;
        const ordered = Number(it.qty) || 0;
        const already = Number(it.returnedQty) || 0;
        const remaining = ordered - already;
        if (remaining > 0) {
          toReturn.push({ productId: String(it.product), qty: remaining });
        }
      }
    } else {
      for (const x of reqItems) {
        const productId = String(x?.productId || x?.product || '').trim();
        const qty = Math.floor(Number(x?.qty));
        if (!productId) throw new BadRequestException('عنصر مرتجع غير صالح: productId مفقود');
        if (!Number.isFinite(qty) || qty < 1) throw new BadRequestException('عنصر مرتجع غير صالح: qty لازم يكون >= 1');
        toReturn.push({ productId, qty });
      }
    }

    if (toReturn.length === 0) {
      throw new BadRequestException('لا يوجد كميات متاحة للإرجاع');
    }

    // Validate + apply
    for (const r of toReturn) {
      const it = byProductId.get(String(r.productId));
      if (!it) {
        throw new BadRequestException('لا يمكن إرجاع صنف غير موجود في الفاتورة');
      }
      const ordered = Number(it.qty) || 0;
      const already = Number(it.returnedQty) || 0;
      const remaining = ordered - already;
      if (remaining <= 0) {
        throw new BadRequestException('هذا الصنف تم إرجاعه بالكامل بالفعل');
      }
      if (r.qty > remaining) {
        throw new BadRequestException('كمية المرتجع أكبر من المتبقي في الفاتورة');
      }
    }

    for (const r of toReturn) {
      const it = byProductId.get(String(r.productId));
      if (!it) continue;
      if ((it as any).isAdHoc || !(it as any).product) {
        it.returnedQty = (Number(it.returnedQty) || 0) + r.qty;
        continue;
      }
      await this.productsService.updateStock(String(it.product), +r.qty);
      it.returnedQty = (Number(it.returnedQty) || 0) + r.qty;
    }

    // If fully returned -> mark as refunded; otherwise keep completed.
    const allReturned = (order.items as any[]).every((it) => {
      const ordered = Number(it.qty) || 0;
      const already = Number(it.returnedQty) || 0;
      return ordered > 0 && already >= ordered;
    });
    if (allReturned) order.status = OrderStatus.REFUNDED;

    return order.save();
  }

  /** كاشير: تعديل طريقة الدفع فقط بدون لمس الأصناف/المخزون */
  async updatePaymentMethod(id: string, paymentMethod: string) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('الأوردر مش موجود');
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('تعديل الدفع متاح لفواتير البيع المكتملة فقط');
    }
    const next = String(paymentMethod || '').trim().toLowerCase();
    const allowed = Object.values(PaymentMethod);
    if (!allowed.includes(next as any)) {
      throw new BadRequestException('طريقة دفع غير صحيحة');
    }
    order.paymentMethod = next as any;
    order.set('paymentSplits', undefined);
    return order.save();
  }

  // تقرير المبيعات
  async getSalesReport(from: string, to: string) {
    const match: any = { status: OrderStatus.COMPLETED };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to)   match.createdAt.$lte = new Date(to);
    }
    const result = await this.orderModel.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        totalRevenue: { $sum: '$total' },
        totalOrders:  { $sum: 1 },
        avgOrder:     { $avg: '$total' },
      }},
    ]);
    return result[0] || { totalRevenue: 0, totalOrders: 0, avgOrder: 0 };
  }

  async getTopProducts(limit = 5) {
    return this.orderModel.aggregate([
      { $match: { status: OrderStatus.COMPLETED } },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', totalSold: { $sum: '$items.qty' }, revenue: { $sum: '$items.total' } } },
      { $sort: { totalSold: -1 } },
      { $limit: limit },
    ]);
  }
}
