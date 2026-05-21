import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DeviceLicenseDocument = DeviceLicense & Document;

@Schema({ timestamps: true })
export class DeviceLicense {
  @Prop({ required: true, unique: true, trim: true })
  deviceId: string;

  /** تاريخ انتهاء الاشتراك */
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ trim: true, default: '' })
  label: string;

  @Prop({ type: Date })
  lastSeenAt?: Date;
}

export const DeviceLicenseSchema = SchemaFactory.createForClass(DeviceLicense);
