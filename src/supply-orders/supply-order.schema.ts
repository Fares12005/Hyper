import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupplyOrderDocument = SupplyOrder & Document;

export enum SupplyOrderStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  FULFILLED = 'fulfilled',
}

export enum SupplyOrderPriority {
  NORMAL = 'normal',
  URGENT = 'urgent',
}

@Schema({ _id: false })
class SupplyOrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  product: Types.ObjectId;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true, min: 1 })
  qty: number;
}

const SupplyOrderItemSchema = SchemaFactory.createForClass(SupplyOrderItem);

@Schema({ timestamps: true })
export class SupplyOrder {
  @Prop({ required: true, unique: true })
  orderNumber: string;

  @Prop({ type: [SupplyOrderItemSchema], required: true })
  items: SupplyOrderItem[];

  @Prop({ enum: SupplyOrderStatus, default: SupplyOrderStatus.PENDING })
  status: SupplyOrderStatus;

  @Prop({ enum: SupplyOrderPriority, default: SupplyOrderPriority.NORMAL })
  priority: SupplyOrderPriority;

  @Prop({ default: 'out_of_stock' })
  reason: string;

  @Prop()
  notes: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop() createdByDisplayName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy: Types.ObjectId;

  @Prop() approvedByDisplayName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  fulfilledBy: Types.ObjectId;

  @Prop() fulfilledByDisplayName?: string;
}

export const SupplyOrderSchema = SchemaFactory.createForClass(SupplyOrder);

