import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductsService } from '../products/products.service';
import { Supplier, SupplierDocument } from '../suppliers/supplier.schema';
import { SequencesService } from '../sequences/sequences.service';
import { User, UserDocument } from '../users/user.schema';
import { SupplierOrder, SupplierOrderDocument, SupplierOrderStatus } from './supplier-order.schema';
import { ReceivingPermissionsService } from '../receiving-permissions/receiving-permissions.service';

@Injectable()
export class SupplierOrdersService {
  constructor(
    @InjectModel(SupplierOrder.name) private supplierOrderModel: Model<SupplierOrderDocument>,
    @InjectModel(Supplier.name) private supplierModel: Model<SupplierDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private productsService: ProductsService,
    private sequences: SequencesService,
    private receivingPermissions: ReceivingPermissionsService,
  ) {}

  private async userDisplayName(userId: string): Promise<string> {
    try {
      const u = await this.userModel.findById(userId).select('name').lean();
      return String((u as any)?.name || '').trim();
    } catch {
      return '';
    }
  }

  async create(data: {
    supplierId: string;
    items: Array<{ productId: string; qty: number }>;
    notes?: string;
    userId: string;
  }) {
    const supplierId = String(data.supplierId || '').trim();
    if (!supplierId) throw new BadRequestException('لازم تختار المورد');

    const supplier = await this.supplierModel.findById(supplierId).select('name isActive').lean();
    if (!supplier) throw new NotFoundException('المورد غير موجود');
    if (!(supplier as any).isActive) throw new BadRequestException('المورد غير نشط');

    if (!data.items?.length) throw new BadRequestException('لازم تختار صنف واحد على الأقل');

    const items: any[] = [];
    for (const it of data.items) {
      const qty = Math.floor(Number(it.qty));
      if (!it.productId || !Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException('بيانات الصنف/الكمية غير صحيحة');
      }
      const p = await this.productsService.findById(String(it.productId));
      items.push({
        product: p._id,
        productName: p.name,
        category: p.category,
        qty,
      });
    }

    const seq = await this.sequences.next('supplier_order');
    const orderNumber = `PO-${String(seq).padStart(6, '0')}`;
    const byName = await this.userDisplayName(data.userId);

    const order = await this.supplierOrderModel.create({
      orderNumber,
      supplier: supplierId as any,
      supplierName: (supplier as any).name,
      items,
      status: SupplierOrderStatus.OPEN,
      notes: data.notes,
      createdBy: data.userId as any,
      createdByDisplayName: byName || undefined,
    });

    // Create receiving permission immediately (as requested)
    await this.receivingPermissions.createForSupplierOrder(String(order._id), data.userId);

    return this.findById(String(order._id));
  }

  findAll(limit = 200, status?: string) {
    const filter: any = {};
    if (status) filter.status = status;
    return this.supplierOrderModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(500, Number(limit) || 200)))
      .populate('supplier', 'name')
      .populate('createdBy', 'name username')
      .populate('closedBy', 'name username')
      .populate('receivingPermission', 'permissionNumber status comparisonResult');
  }

  async findById(id: string) {
    const order = await this.supplierOrderModel.findById(id)
      .populate('supplier', 'name')
      .populate('createdBy', 'name username')
      .populate('closedBy', 'name username')
      .populate('receivingPermission', 'permissionNumber status comparisonResult')
      .populate('items.product', 'name emoji');
    if (!order) throw new NotFoundException('أمر التوريد غير موجود');
    return order;
  }

  /** قائمة “الأوامر المفتوحة” فقط (اللي تظهر في شاشة الطلبات) */
  findOpen(limit = 200) {
    return this.findAll(limit, SupplierOrderStatus.OPEN);
  }

  /** أرشيف الأوامر (كل ما عدا open) */
  findArchive(limit = 200) {
    return this.supplierOrderModel.find({ status: { $ne: SupplierOrderStatus.OPEN } })
      .sort({ closedAt: -1, createdAt: -1 })
      .limit(Math.max(1, Math.min(500, Number(limit) || 200)))
      .populate('supplier', 'name')
      .populate('createdBy', 'name username')
      .populate('closedBy', 'name username')
      .populate('receivingPermission', 'permissionNumber status comparisonResult');
  }
}

