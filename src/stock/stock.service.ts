import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StockPermission, StockPermissionDocument, PermissionStatus, PermissionType } from './stock-permission.schema';
import { ProductsService } from '../products/products.service';
import { User, UserDocument } from '../users/user.schema';
import { SequencesService } from '../sequences/sequences.service';

@Injectable()
export class StockService {
  constructor(
    @InjectModel(StockPermission.name) private permModel: Model<StockPermissionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private productsService: ProductsService,
    private sequences: SequencesService,
  ) {}

  private async userDisplayName(userId: string): Promise<string> {
    try {
      const u = await this.userModel.findById(userId).select('name').lean();
      return String((u as any)?.name || '').trim();
    } catch {
      return '';
    }
  }

  private parsePermissionType(raw: string): PermissionType {
    const t = String(raw || '').trim();
    if (
      t === PermissionType.RECEIVE ||
      t === PermissionType.RETURN ||
      t === PermissionType.DAMAGE ||
      t === PermissionType.TRANSFER ||
      t === PermissionType.PRICE_UPDATE
    ) {
      return t as PermissionType;
    }
    throw new BadRequestException('نوع الإذن غير صحيح');
  }

  /** تأثير المخزون بعد اعتماد الإذن (نفس منطق approve) */
  private async applyStockForApprovedPermission(type: PermissionType, productId: string, qty: number) {
    if (type === PermissionType.PRICE_UPDATE) return;
    if (type === PermissionType.RECEIVE) {
      await this.productsService.updateStock(productId, +qty, { markStockIn: true });
      return;
    }
    // مرتجع لمورد / خروج بضاعة: يخصم من الرصيد (مثل تالف/تحويل)
    if (type === PermissionType.RETURN || type === PermissionType.DAMAGE || type === PermissionType.TRANSFER) {
      await this.productsService.updateStock(productId, -qty);
      return;
    }
  }

  // ── Permissions ──

  /**
   * تشغيل: تحويل كمية من منتج (باركود) إلى منتج آخر (باركود)
   * - يخصم من المنتج المصدر ويضيف للمنتج الهدف
   * - يتحقق من توافر الكمية
   */
  async transferQtyBetweenBarcodes(payload: { fromBarcode: string; toBarcode: string; qty: number; userId: string; notes?: string }) {
    const fromBarcode = String(payload.fromBarcode || '').trim();
    const toBarcode = String(payload.toBarcode || '').trim();
    const qty = Math.floor(Number(payload.qty));
    if (!fromBarcode || !toBarcode) throw new BadRequestException('لازم تدخل باركود من وباركود إلى');
    if (fromBarcode === toBarcode) throw new BadRequestException('الباركودين لازم يكونوا مختلفين');
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('الكمية لازم تكون رقم صحيح أكبر من صفر');

    const fromP: any = await this.productsService.findByBarcode(fromBarcode);
    if (!fromP?._id) throw new NotFoundException('باركود (من) غير موجود');
    const toP: any = await this.productsService.findByBarcode(toBarcode);
    if (!toP?._id) throw new NotFoundException('باركود (إلى) غير موجود');

    if (String(fromP._id) === String(toP._id)) {
      throw new BadRequestException('الباركودين يرجعوا لنفس المنتج — اختار منتج مختلف');
    }
    if (Number(fromP.stock) < qty) {
      throw new BadRequestException(`الكمية أكبر من المتاح في المخزون لـ "${fromP.name}" (المتاح: ${fromP.stock})`);
    }

    // خصم من المصدر + إضافة للهدف
    await this.productsService.updateStock(String(fromP._id), -qty);
    await this.productsService.updateStock(String(toP._id), +qty, { markStockIn: true });

    return {
      ok: true,
      qty,
      from: { id: String(fromP._id), name: fromP.name, barcode: fromP.barcode, stockBefore: Number(fromP.stock), stockAfter: Number(fromP.stock) - qty },
      to: { id: String(toP._id), name: toP.name, barcode: toP.barcode, stockBefore: Number(toP.stock), stockAfter: Number(toP.stock) + qty },
      notes: String(payload.notes || '').trim() || '',
      by: payload.userId,
    };
  }

  async createPermission(data: {
    type: string;
    productId: string;
    qty?: number;
    newPrice?: number;
    notes?: string;
    userId: string;
  }) {
    const productId = String(data.productId || '').trim();
    if (!productId) throw new BadRequestException('لازم تختار المنتج');
    const product = await this.productsService.findById(productId);
    const typeKey = this.parsePermissionType(data.type);

    const permissionNumber = await this.sequences.next(`stock_perm_${typeKey}`);

    if (typeKey === PermissionType.PRICE_UPDATE) {
      const raw = String(data.newPrice ?? '').trim().replace(',', '.');
      const newPrice = parseFloat(raw);
      if (!Number.isFinite(newPrice) || newPrice < 0) {
        throw new BadRequestException('اكتب السعر الجديد بشكل صحيح (رقم ≥ 0)');
      }
      const oldPrice = Number(product.price);
      if (!Number.isFinite(oldPrice)) {
        throw new BadRequestException('سعر المنتج الحالي غير صالح');
      }

      const byName = await this.userDisplayName(data.userId);
      const perm = await this.permModel.create({
        permissionNumber,
        type: typeKey,
        product: productId,
        productName: product.name,
        qty: 0,
        oldPrice,
        newPrice,
        notes: data.notes,
        createdBy: data.userId,
        createdByDisplayName: byName || undefined,
        status: PermissionStatus.APPROVED,
        approvedBy: data.userId as any,
        approvedByDisplayName: byName || undefined,
      });
      await this.productsService.update(productId, { price: newPrice });
      return perm;
    }

    const qty = Math.floor(Number(data.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestException('الكمية لازم تكون رقم صحيح أكبر من صفر');
    }

    if (
      typeKey === PermissionType.RETURN ||
      typeKey === PermissionType.DAMAGE ||
      typeKey === PermissionType.TRANSFER
    ) {
      if (product.stock < qty) {
        throw new BadRequestException(
          `الكمية أكبر من المتاح في المخزون لـ "${product.name}" (المتاح: ${product.stock})`,
        );
      }
    }

    // كل الأذونات: تم التأكيد فورًا + تطبيق المخزون مباشرة (بدون مرحلة مراجعة)
    const byName = await this.userDisplayName(data.userId);
    const perm = await this.permModel.create({
      permissionNumber,
      type: typeKey,
      product: productId,
      productName: product.name,
      qty,
      notes: data.notes,
      createdBy: data.userId,
      createdByDisplayName: byName || undefined,
      status: PermissionStatus.APPROVED,
      approvedBy: data.userId as any,
      approvedByDisplayName: byName || undefined,
    });
    await this.applyStockForApprovedPermission(typeKey, productId, qty);
    return perm;
  }

  findPermissions(type?: string, status?: string, limit?: number) {
    const filter: any = {};
    if (type)   filter.type   = type;
    if (status) filter.status = status;
    return this.permModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(1000, Number(limit) || 200)))
      .populate('createdBy', 'name')
      .populate('product', 'name emoji price barcode category');
  }

  findMyPermissions(params: {
    userId: string;
    types?: string[]; // optional list of types
    permissionNumber?: number;
    from?: Date;
    to?: Date;
    limit?: number;
    skip?: number;
  }) {
    const filter: any = { createdBy: params.userId };

    if (params.types?.length) {
      filter.type = { $in: params.types };
    }
    if (Number.isFinite(params.permissionNumber)) {
      filter.permissionNumber = params.permissionNumber;
    }
    if (params.from || params.to) {
      filter.createdAt = {};
      if (params.from) filter.createdAt.$gte = params.from;
      if (params.to) filter.createdAt.$lte = params.to;
    }

    const limit = Math.max(1, Math.min(1000, Number(params.limit) || 200));
    const skip = Math.max(0, Number(params.skip) || 0);

    return this.permModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name username')
      .populate('approvedBy', 'name username')
      .populate('product', 'name emoji category barcode');
  }

  async findPermissionById(id: string) {
    const perm = await this.permModel.findById(id)
      .populate('createdBy', 'name username')
      .populate('approvedBy', 'name username')
      .populate('product', 'name emoji category barcode price');
    if (!perm) throw new NotFoundException('الإذن مش موجود');
    return perm;
  }

  async approvePermission(id: string, userId: string) {
    const perm = await this.permModel.findById(id);
    if (!perm) throw new NotFoundException('الإذن مش موجود');
    if (perm.status !== PermissionStatus.PENDING) throw new BadRequestException('الإذن اتعمل فيه إجراء بالفعل');

    const prod = await this.productsService.findById(String(perm.product));
    const q = Math.floor(Number(perm.qty)) || 0;
    if (
      (perm.type === 'return' || perm.type === 'damage' || perm.type === 'transfer') &&
      q > 0 &&
      prod.stock < q
    ) {
      throw new BadRequestException(
        `الكمية أكبر من المتاح في المخزون لـ "${prod.name}" (المتاح: ${prod.stock})`,
      );
    }

    perm.status    = PermissionStatus.APPROVED;
    perm.approvedBy = userId as any;
    perm.approvedByDisplayName = (await this.userDisplayName(userId)) || undefined;
    await perm.save();

    // تأثير على المخزون حسب النوع
    if (perm.type === PermissionType.PRICE_UPDATE) {
      const np = Number((perm as any).newPrice);
      if (Number.isFinite(np) && np >= 0) {
        await this.productsService.update(String(perm.product), { price: np });
      }
    }
    if (perm.type === 'receive') {
      await this.productsService.updateStock(String(perm.product), +perm.qty, { markStockIn: true });
    }
    if (perm.type === 'return')   await this.productsService.updateStock(String(perm.product), -perm.qty);
    if (perm.type === 'damage')   await this.productsService.updateStock(String(perm.product), -perm.qty);
    if (perm.type === 'transfer') await this.productsService.updateStock(String(perm.product), -perm.qty);

    return perm;
  }

  async rejectPermission(id: string, userId: string) {
    const perm = await this.permModel.findById(id);
    if (!perm) throw new NotFoundException('الإذن مش موجود');
    if (perm.status !== PermissionStatus.PENDING) throw new BadRequestException('الإذن اتعمل فيه إجراء بالفعل');
    perm.status     = PermissionStatus.REJECTED;
    perm.approvedBy = userId as any;
    perm.approvedByDisplayName = (await this.userDisplayName(userId)) || undefined;
    return perm.save();
  }
}
