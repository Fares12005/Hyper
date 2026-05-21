import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type StockPermissionDocument = StockPermission & Document;

export enum PermissionType {
  RETURN        = 'return',
  TRANSFER      = 'transfer',
  RECEIVE       = 'receive',
  DAMAGE        = 'damage',
  /** تحديث سعر الكتالوج — لا يغيّر المخزون؛ الفواتير القديمة تحتفظ بسعر البيع المحفوظ */
  PRICE_UPDATE  = 'price_update',
}

export enum PermissionStatus {
  PENDING  = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Schema({ timestamps: true })
export class StockPermission {
  /** رقم إذن متسلسل (مستقل لكل نوع) */
  @Prop({ index: true })
  permissionNumber?: number;

  @Prop({ enum: PermissionType, required: true })
  type: PermissionType;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  product: Types.ObjectId;

  @Prop({ required: true }) productName: string;
  /** للأذونات العادية: كمية. لتحديث السعر: 0 */
  @Prop({ required: true }) qty: number;
  /** مملوء لنوع price_update فقط */
  @Prop() oldPrice?: number;
  @Prop() newPrice?: number;
  @Prop() notes: string;

  @Prop({ enum: PermissionStatus, default: PermissionStatus.PENDING })
  status: PermissionStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop() createdByDisplayName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy: Types.ObjectId;

  @Prop() approvedByDisplayName?: string;
}

export const StockPermissionSchema = SchemaFactory.createForClass(StockPermission);

// رقم إذن مستقل لكل نوع (sparse لتفادي كسر البيانات القديمة)
StockPermissionSchema.index({ type: 1, permissionNumber: 1 }, { unique: true, sparse: true });
