import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SupplierDocument = Supplier & Document;

@Schema({ timestamps: true })
export class Supplier {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop() phone?: string;
  @Prop() address?: string;

  /** الأقسام/الأنشطة اللي المورد بيورّدها (مثال: فواكه، ألبان، مخبوزات...) */
  @Prop({ type: [String], default: [] })
  categories?: string[];

  @Prop({ default: true }) isActive: boolean;
  @Prop() notes?: string;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);
SupplierSchema.index({ name: 1 }, { unique: true });

