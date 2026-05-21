import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReceivingPermissionDocument = ReceivingPermission & Document;

export enum ReceivingPermissionStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Schema({ _id: false })
class ReceivingPermissionItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  product: Types.ObjectId;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true, min: 1 })
  requestedQty: number;

  @Prop({ required: true, min: 0, default: 0 })
  receivedQty: number;
}
const ReceivingPermissionItemSchema = SchemaFactory.createForClass(ReceivingPermissionItem);

@Schema({ timestamps: true })
export class ReceivingPermission {
  @Prop({ required: true, unique: true, immutable: true })
  permissionNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplier: Types.ObjectId;

  @Prop({ required: true })
  supplierName: string;

  @Prop({ type: Types.ObjectId, ref: 'SupplierOrder', required: true, index: true })
  supplierOrder: Types.ObjectId;

  @Prop({ type: [ReceivingPermissionItemSchema], required: true })
  items: ReceivingPermissionItem[];

  @Prop({ enum: ReceivingPermissionStatus, default: ReceivingPermissionStatus.PENDING })
  status: ReceivingPermissionStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop() createdByDisplayName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actionBy?: Types.ObjectId;

  @Prop() actionByDisplayName?: string;

  @Prop()
  actionAt?: Date;

  /** نتيجة مقارنة الكميات (يُملأ بعد الاستلام) */
  @Prop({ default: '' })
  comparisonResult?: 'matched' | 'different' | '';

  @Prop() notes?: string;
}

export const ReceivingPermissionSchema = SchemaFactory.createForClass(ReceivingPermission);
ReceivingPermissionSchema.index({ status: 1, createdAt: -1 });

