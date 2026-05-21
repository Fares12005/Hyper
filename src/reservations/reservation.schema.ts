import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReservationDocument = Reservation & Document;

export enum ReservationStatus {
  OPEN = 'open',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ReservationPayMethod {
  CASH = 'cash',
  CARD = 'card',
  WALLET = 'wallet',
  /** دفع بشيك (الرقم المرجعي يُخزَّن على مستوى الحجز) */
  CHEQUE = 'cheque',
}

@Schema({ _id: false })
class ReservationPaymentLine {
  @Prop({ required: true }) amount: number;
  @Prop({ required: true }) paidAt: Date;
  @Prop({ enum: ReservationPayMethod, default: ReservationPayMethod.CASH })
  paymentMethod: ReservationPayMethod;
  @Prop() notes?: string;
  @Prop() cashierDisplayName?: string;
}
const ReservationPaymentLineSchema = SchemaFactory.createForClass(ReservationPaymentLine);

@Schema({ timestamps: true })
export class Reservation {
  /**
   * الرقم المرجعي للشيك / المرجع الذي يدخله الكاشير — فريد لكل حجز.
   */
  @Prop({ required: true, unique: true, trim: true })
  referenceNumber: string;

  /** وصف مختصر مثل: 100 شنطة رمضان */
  @Prop({ required: true, trim: true })
  description: string;

  /** إجمالي قيمة الحجز المستحقة بالكامل */
  @Prop({ required: true }) totalDue: number;

  @Prop({ type: [ReservationPaymentLineSchema], default: [] })
  payments: ReservationPaymentLine[];

  @Prop({ enum: ReservationStatus, default: ReservationStatus.OPEN })
  status: ReservationStatus;

  /** تاريخ متوقع لإتمام الدفع (اختياري) */
  @Prop() expectedCompletionDate?: Date;

  @Prop() customerName?: string;
  @Prop() customerPhone?: string;
  @Prop() notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop() createdByDisplayName?: string;
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation);

ReservationSchema.index({ referenceNumber: 1 });
ReservationSchema.index({ status: 1, updatedAt: -1 });
