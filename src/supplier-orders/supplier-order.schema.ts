import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupplierOrderDocument = SupplierOrder & Document;

export enum SupplierOrderStatus {
  OPEN = 'open',
  RECEIVED = 'received',
  REJECTED = 'rejected',
}

@Schema({ _id: false })
class SupplierOrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  product: Types.ObjectId;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true, min: 1 })
  qty: number;
}
const SupplierOrderItemSchema = SchemaFactory.createForClass(SupplierOrderItem);

@Schema({ timestamps: true })
export class SupplierOrder {
  @Prop({ required: true, unique: true, immutable: true })
  orderNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplier: Types.ObjectId;

  @Prop({ required: true })
  supplierName: string;

  @Prop({ type: [SupplierOrderItemSchema], required: true })
  items: SupplierOrderItem[];

  @Prop({ enum: SupplierOrderStatus, default: SupplierOrderStatus.OPEN })
  status: SupplierOrderStatus;

  @Prop({ type: Types.ObjectId, ref: 'ReceivingPermission' })
  receivingPermission?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop() createdByDisplayName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  closedBy?: Types.ObjectId;

  @Prop() closedByDisplayName?: string;

  @Prop() closedAt?: Date;

  @Prop() notes?: string;
}

export const SupplierOrderSchema = SchemaFactory.createForClass(SupplierOrder);
SupplierOrderSchema.index({ status: 1, createdAt: -1 });
SupplierOrderSchema.index({ supplier: 1, createdAt: -1 });

