import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductsService } from '../products/products.service';
import { SequencesService } from '../sequences/sequences.service';
import { SupplierOrder, SupplierOrderDocument, SupplierOrderStatus } from '../supplier-orders/supplier-order.schema';
import {
  ReceivingPermission,
  ReceivingPermissionDocument,
  ReceivingPermissionStatus,
} from './receiving-permission.schema';
import { User, UserDocument } from '../users/user.schema';

@Injectable()
export class ReceivingPermissionsService {
  constructor(
    @InjectModel(ReceivingPermission.name) private recModel: Model<ReceivingPermissionDocument>,
    @InjectModel(SupplierOrder.name) private supplierOrderModel: Model<SupplierOrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private sequences: SequencesService,
    private productsService: ProductsService,
  ) {}

  private async userDisplayName(userId: string): Promise<string> {
    try {
      const u = await this.userModel.findById(userId).select('name').lean();
      return String((u as any)?.name || '').trim();
    } catch {
      return '';
    }
  }

  async createForSupplierOrder(orderId: string, userId: string) {
    const order = await this.supplierOrderModel.findById(orderId).lean();
    if (!order) throw new NotFoundException('أمر التوريد غير موجود');
    if (String((order as any).status) !== SupplierOrderStatus.OPEN) {
      throw new BadRequestException('لا يمكن إنشاء إذن استلام لأمر مغلق');
    }
    const existing = await this.recModel.findOne({ supplierOrder: orderId }).select('_id').lean();
    if (existing) return this.recModel.findById((existing as any)._id);

    const seq = await this.sequences.next('receiving_permission');
    const permissionNumber = `RCV-${String(seq).padStart(6, '0')}`;
    const byName = await this.userDisplayName(userId);

    const rec = await this.recModel.create({
      permissionNumber,
      supplier: (order as any).supplier,
      supplierName: (order as any).supplierName,
      supplierOrder: (order as any)._id,
      items: ((order as any).items || []).map((it: any) => ({
        product: it.product,
        productName: it.productName,
        requestedQty: it.qty,
        receivedQty: 0,
      })),
      status: ReceivingPermissionStatus.PENDING,
      createdBy: userId as any,
      createdByDisplayName: byName || undefined,
    });

    await this.supplierOrderModel.findByIdAndUpdate(orderId, { $set: { receivingPermission: rec._id } });
    return rec;
  }

  findAll(limit = 200, status?: string) {
    const filter: any = {};
    if (status) filter.status = status;
    return this.recModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(500, Number(limit) || 200)))
      .populate('supplier', 'name')
      .populate('createdBy', 'name username')
      .populate('actionBy', 'name username')
      .populate('supplierOrder', 'orderNumber status')
      .populate('items.product', 'name emoji price barcode category');
  }

  async findById(id: string) {
    const rec = await this.recModel.findById(id)
      .populate('supplier', 'name')
      .populate('createdBy', 'name username')
      .populate('actionBy', 'name username')
      .populate('supplierOrder', 'orderNumber status')
      .populate('items.product', 'name emoji price barcode category');
    if (!rec) throw new NotFoundException('إذن الاستلام غير موجود');
    return rec;
  }

  async accept(id: string, userId: string, payload: { items: Array<{ productId: string; receivedQty: number }>; notes?: string }) {
    const rec = await this.recModel.findById(id);
    if (!rec) throw new NotFoundException('إذن الاستلام غير موجود');
    if (rec.status !== ReceivingPermissionStatus.PENDING) throw new BadRequestException('الإذن اتعمل فيه إجراء بالفعل');

    const map = new Map<string, number>();
    for (const it of payload?.items || []) {
      const pid = String(it.productId || '').trim();
      const q = Math.floor(Number(it.receivedQty));
      if (!pid) continue;
      if (!Number.isFinite(q) || q < 0) throw new BadRequestException('الكمية المستلمة لازم تكون رقم صحيح ≥ 0');
      map.set(pid, q);
    }

    let allMatch = true;
    for (const item of (rec.items as any[]) || []) {
      const pid = String(item.product);
      const receivedQty = map.has(pid) ? map.get(pid)! : Math.floor(Number(item.receivedQty || 0));
      item.receivedQty = receivedQty;
      if (Math.floor(Number(item.requestedQty)) !== Math.floor(Number(receivedQty))) allMatch = false;
    }

    // Apply stock increases by received qty
    for (const item of (rec.items as any[]) || []) {
      const qty = Math.floor(Number(item.receivedQty));
      if (qty > 0) {
        await this.productsService.updateStock(String(item.product), qty, { markStockIn: true });
      }
    }

    rec.status = ReceivingPermissionStatus.ACCEPTED;
    rec.comparisonResult = allMatch ? 'matched' : 'different';
    rec.notes = payload?.notes;
    rec.actionBy = userId as any;
    rec.actionByDisplayName = (await this.userDisplayName(userId)) || undefined;
    rec.actionAt = new Date();
    await rec.save();

    await this.supplierOrderModel.findByIdAndUpdate(String(rec.supplierOrder), {
      $set: {
        status: SupplierOrderStatus.RECEIVED,
        closedBy: userId as any,
        closedByDisplayName: (await this.userDisplayName(userId)) || undefined,
        closedAt: new Date(),
      },
    });

    return this.findById(id);
  }

  async reject(id: string, userId: string, payload?: { notes?: string }) {
    const rec = await this.recModel.findById(id);
    if (!rec) throw new NotFoundException('إذن الاستلام غير موجود');
    if (rec.status !== ReceivingPermissionStatus.PENDING) throw new BadRequestException('الإذن اتعمل فيه إجراء بالفعل');

    rec.status = ReceivingPermissionStatus.REJECTED;
    rec.notes = payload?.notes;
    rec.actionBy = userId as any;
    rec.actionByDisplayName = (await this.userDisplayName(userId)) || undefined;
    rec.actionAt = new Date();
    rec.comparisonResult = '';
    await rec.save();

    await this.supplierOrderModel.findByIdAndUpdate(String(rec.supplierOrder), {
      $set: {
        status: SupplierOrderStatus.REJECTED,
        closedBy: userId as any,
        closedByDisplayName: (await this.userDisplayName(userId)) || undefined,
        closedAt: new Date(),
      },
    });

    return this.findById(id);
  }
}

