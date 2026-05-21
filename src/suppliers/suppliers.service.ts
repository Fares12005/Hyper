import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Supplier, SupplierDocument } from './supplier.schema';
import { Product, ProductDocument } from '../products/product.schema';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(Supplier.name) private supplierModel: Model<SupplierDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  create(data: Partial<Supplier>) {
    const name = String(data.name || '').trim();
    if (!name) throw new BadRequestException('اسم المورد مطلوب');
    const categories = Array.isArray((data as any).categories)
      ? (data as any).categories.map((c: any) => String(c || '').trim()).filter(Boolean)
      : [];
    return this.supplierModel.create({
      name,
      phone: data.phone,
      address: data.address,
      categories,
      notes: data.notes,
      isActive: data.isActive ?? true,
    });
  }

  findAll(activeOnly = true) {
    const filter: any = {};
    if (activeOnly) filter.isActive = true;
    return this.supplierModel.find(filter).sort({ name: 1 });
  }

  async findById(id: string) {
    const s = await this.supplierModel.findById(id);
    if (!s) throw new NotFoundException('المورد غير موجود');
    return s;
  }

  async update(id: string, data: Partial<Supplier>) {
    const patch: any = { ...data };
    if (data.name != null) {
      const name = String(data.name || '').trim();
      if (!name) throw new BadRequestException('اسم المورد مطلوب');
      patch.name = name;
    }
    if ((data as any).categories != null) {
      patch.categories = Array.isArray((data as any).categories)
        ? (data as any).categories.map((c: any) => String(c || '').trim()).filter(Boolean)
        : [];
    }
    const s = await this.supplierModel.findByIdAndUpdate(id, patch, { new: true });
    if (!s) throw new NotFoundException('المورد غير موجود');
    return s;
  }

  delete(id: string) {
    return this.supplierModel.findByIdAndUpdate(id, { isActive: false }, { new: true });
  }

  async setProductRelation(supplierId: string, productId: string, enabled: boolean) {
    const sid = String(supplierId || '').trim();
    const pid = String(productId || '').trim();
    if (!sid || !pid) throw new BadRequestException('بيانات المورد/المنتج غير صحيحة');

    const s = await this.supplierModel.findById(sid).select('_id isActive');
    if (!s) throw new NotFoundException('المورد غير موجود');
    if (!(s as any).isActive) throw new BadRequestException('المورد غير نشط');

    const p = await this.productModel.findById(pid).select('_id suppliers isActive');
    if (!p) throw new NotFoundException('المنتج غير موجود');
    if (!(p as any).isActive) throw new BadRequestException('المنتج غير نشط');

    const update = enabled
      ? { $addToSet: { suppliers: new Types.ObjectId(sid) } }
      : { $pull: { suppliers: new Types.ObjectId(sid) } };

    return this.productModel.findByIdAndUpdate(pid, update, { new: true }).select('name category suppliers');
  }

  /** الموردين المرتبطين بصنف */
  async findSuppliersForProduct(productId: string) {
    const p = await this.productModel.findById(productId).select('suppliers');
    if (!p) throw new NotFoundException('المنتج غير موجود');
    const ids = ((p as any).suppliers || []).map((x: any) => String(x));
    if (!ids.length) return [];
    return this.supplierModel.find({ _id: { $in: ids }, isActive: true }).sort({ name: 1 });
  }
}

