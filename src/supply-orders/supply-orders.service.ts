import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductsService } from '../products/products.service';
import {
  SupplyOrder,
  SupplyOrderDocument,
  SupplyOrderPriority,
  SupplyOrderStatus,
} from './supply-order.schema';
import { User, UserDocument } from '../users/user.schema';

@Injectable()
export class SupplyOrdersService {
  constructor(
    @InjectModel(SupplyOrder.name) private supplyOrderModel: Model<SupplyOrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
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

  private async generateOrderNumber(): Promise<string> {
    const count = await this.supplyOrderModel.countDocuments();
    return `SUP-${String(count + 1).padStart(5, '0')}`;
  }

  async create(data: { items: Array<{ productId: string; qty: number }>; priority?: string; notes?: string; reason?: string; userId: string }) {
    if (!data.items?.length) throw new BadRequestException('لازم تختار منتج واحد على الأقل');

    const items = [];
    for (const it of data.items) {
      if (!it.productId || !it.qty || it.qty <= 0) throw new BadRequestException('بيانات المنتج/الكمية غير صحيحة');
      const product = await this.productsService.findById(it.productId);
      items.push({ product: product._id, productName: product.name, qty: +it.qty });
    }

    const orderNumber = await this.generateOrderNumber();
    const creatorName = await this.userDisplayName(data.userId);
    return this.supplyOrderModel.create({
      orderNumber,
      items,
      status: SupplyOrderStatus.PENDING,
      priority: data.priority === SupplyOrderPriority.URGENT ? SupplyOrderPriority.URGENT : SupplyOrderPriority.NORMAL,
      notes: data.notes,
      reason: data.reason || 'out_of_stock',
      createdBy: data.userId as any,
      createdByDisplayName: creatorName || undefined,
    });
  }

  findAll(limit = 100, status?: string) {
    const filter: any = {};
    if (status) filter.status = status;
    return this.supplyOrderModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('createdBy', 'name username')
      .populate('approvedBy', 'name username')
      .populate('fulfilledBy', 'name username')
      .populate('items.product', 'name emoji');
  }

  async findById(id: string) {
    const o = await this.supplyOrderModel.findById(id)
      .populate('createdBy', 'name username')
      .populate('approvedBy', 'name username')
      .populate('fulfilledBy', 'name username')
      .populate('items.product', 'name emoji');
    if (!o) throw new NotFoundException('طلب التوريد مش موجود');
    return o;
  }

  async approve(id: string, userId: string) {
    const o = await this.supplyOrderModel.findById(id);
    if (!o) throw new NotFoundException('طلب التوريد مش موجود');
    if (o.status !== SupplyOrderStatus.PENDING) throw new BadRequestException('الطلب اتعمل فيه إجراء بالفعل');
    o.status = SupplyOrderStatus.APPROVED;
    o.approvedBy = userId as any;
    o.approvedByDisplayName = (await this.userDisplayName(userId)) || undefined;
    return o.save();
  }

  async reject(id: string, userId: string) {
    const o = await this.supplyOrderModel.findById(id);
    if (!o) throw new NotFoundException('طلب التوريد مش موجود');
    if (o.status !== SupplyOrderStatus.PENDING) throw new BadRequestException('الطلب اتعمل فيه إجراء بالفعل');
    o.status = SupplyOrderStatus.REJECTED;
    o.approvedBy = userId as any;
    o.approvedByDisplayName = (await this.userDisplayName(userId)) || undefined;
    return o.save();
  }

  async fulfill(id: string, userId: string) {
    const o = await this.supplyOrderModel.findById(id);
    if (!o) throw new NotFoundException('طلب التوريد مش موجود');
    if (o.status !== SupplyOrderStatus.APPROVED) throw new BadRequestException('لا يمكن التوريد إلا بعد الاعتماد');

    for (const item of o.items || []) {
      await this.productsService.updateStock(String(item.product), +item.qty, { markStockIn: true });
    }

    o.status = SupplyOrderStatus.FULFILLED;
    o.fulfilledBy = userId as any;
    o.fulfilledByDisplayName = (await this.userDisplayName(userId)) || undefined;
    return o.save();
  }
}

