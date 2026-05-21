import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

export enum OrderStatus {
  // Customer flow
  PENDING    = 'pending',     // تم استلام الطلب
  CONFIRMED  = 'confirmed',   // تم تأكيد الطلب
  PREPARING  = 'preparing',   // جاري التحضير
  READY      = 'ready',       // جاهز للتسليم
  DELIVERED  = 'delivered',   // تم التسليم

  // POS flow / legacy
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED  = 'refunded',
}

export enum PaymentMethod {
  CASH   = 'cash',
  CARD   = 'card',
  WALLET = 'wallet',
  /** أكثر من طريقة دفع على نفس الفاتورة (يتطلب paymentSplits) */
  MIXED  = 'mixed',
}

@Schema({ _id: false })
class OrderItem {
  /** صنف مسجّل؛ يُترك فارغًا للأصناف اليدوية (باركود غير مُسجّل بعد). */
  @Prop({ type: Types.ObjectId, ref: 'Product', required: false })
  product?: Types.ObjectId;

  @Prop({ required: true }) name: string;
  @Prop({ required: true }) price: number;
  @Prop({ required: true }) qty: number;
  @Prop({ required: true }) total: number;

  @Prop() barcode?: string;

  /** سطر يدوي من الكاشير (بدون منتج في النظام). */
  @Prop({ default: false })
  isAdHoc?: boolean;

  /**
   * كاشير: خصم مؤجل من المخزون لهذا السطر (حتى لو المنتج مسجّل).
   * - عند البيع: لا يتم التحقق من الرصيد ولا الخصم.
   * - عند «تسوية الكاشير»: يتم خصم الكمية من المخزون.
   */
  @Prop({ default: false })
  deferStockDeduction?: boolean;

  /**
   * POS partial return tracking.
   * If missing in old orders -> treated as 0.
   */
  @Prop({ default: 0 })
  returnedQty?: number;
}
const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ _id: false })
class PaymentSplitLine {
  /** جزء من الإجمالي على طريقة محددة (ليس قيمة «mixed») */
  @Prop({ type: String, enum: [PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.WALLET], required: true })
  method: PaymentMethod;

  @Prop({ required: true, type: Number })
  amount: number;
}
const PaymentSplitLineSchema = SchemaFactory.createForClass(PaymentSplitLine);

@Schema({ timestamps: true })
export class Order {
  /**
   * Client-generated id to support offline queue + idempotent retries.
   * Optional for backward compatibility.
   */
  @Prop({ unique: true, sparse: true })
  clientOrderId?: string;

  @Prop({ required: true, unique: true })
  orderNumber: string;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({ required: true }) subtotal: number;
  @Prop({ required: true }) tax: number;
  @Prop({ required: true }) total: number;

  @Prop({ enum: PaymentMethod, default: PaymentMethod.CASH })
  paymentMethod: PaymentMethod;

  /**
   * دفع مُجزّأ: [{ method, amount }, ...] — مجموع amount = total، و paymentMethod = mixed
   */
  @Prop({ type: [PaymentSplitLineSchema], required: false })
  paymentSplits?: PaymentSplitLine[];

  @Prop({ enum: OrderStatus, default: OrderStatus.COMPLETED })
  status: OrderStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  cashier: Types.ObjectId;

  /** اسم الكاشير وقت العملية — يُثبَّت عند الحذف النهائي للمستخدم أو عند إنشاء الفاتورة */
  @Prop() cashierDisplayName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  customer: Types.ObjectId;

  /** اسم حساب العميل المسجّل وقت الطلب (للعرض بعد حذف الحساب) */
  @Prop() customerAccountDisplayName?: string;

  // بيانات الشحن للطلبات الأونلاين (Customer)
  @Prop() customerName?: string;
  @Prop() customerPhone?: string;
  @Prop() deliveryAddress?: string;

  @Prop() notes: string;

  /**
   * بيع كاشير: هل خُصم من المخزون وقت الفاتورة؟
   * الطلبات القديمة: غير محدد → يُعامل كـ true.
   */
  @Prop({ default: true })
  stockDeductedAtSale?: boolean;

  /** فاتورة «بدون رصيد» بانتظار تسوية المخزون لاحقًا */
  @Prop({ default: false })
  pendingStockRegistration?: boolean;

  /** الكاشير يُطلق الطلب لظهوره عند مسؤول المخزون */
  @Prop()
  releasedToStockAt?: Date;

  /** المخزون أكمل التسوية (خصم الكميات المتأخرة من الرصيد) */
  @Prop({ default: false })
  stockRegistrationResolved?: boolean;

  @Prop()
  stockRegistrationResolvedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  stockResolvedBy?: Types.ObjectId;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
