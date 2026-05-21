import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductDocument = Product & Document;

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true })
  price: number;

  /** خصم نسبة مئوية على السعر (0..100) */
  @Prop({ default: 0 })
  discountPercent: number;

  /** تفعيل/إيقاف الخصم */
  @Prop({ default: false })
  discountActive: boolean;

  /** بداية الخصم (اختياري) */
  @Prop()
  discountFrom?: Date;

  /** نهاية الخصم (اختياري) */
  @Prop()
  discountTo?: Date;

  @Prop({ default: 0 })
  stock: number;

  @Prop({ default: '' })
  emoji: string;

  @Prop({ default: '' })
  barcode: string;

  /** يباع بالوزن (ميزان) */
  @Prop({ default: false })
  soldByWeight: boolean;

  /** كود الميزان/PLU الداخلي (عادة 5 أرقام) */
  @Prop({ default: '' })
  scalePlu: string;

  @Prop({ default: '' })
  imageUrl: string;

  @Prop({ default: true })
  isActive: boolean;

  // Alert لما الكمية تقل عن الحد ده
  @Prop({ default: 10 })
  lowStockThreshold: number;

  /** true بعد ما اتسجل وارد/زيادة رصيد — تنبيه النقص يظهر بس للأصناف دي (مش اللي فاضية من الأول ومحدش سجل وارد) */
  @Prop({ default: false })
  hadWarehouseReceive: boolean;

  /** الموردين المرتبطين بالصنف (لاختيار المورد عند أمر التوريد) */
  @Prop({ type: [Types.ObjectId], ref: 'Supplier', default: [] })
  suppliers?: Types.ObjectId[];
}

export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ name: 1 });
ProductSchema.index({ category: 1 });
ProductSchema.index({ barcode: 1 });
ProductSchema.index({ soldByWeight: 1 });
ProductSchema.index({ scalePlu: 1 });
ProductSchema.index({ discountActive: 1, discountFrom: 1, discountTo: 1 });
