import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SequenceDocument = Sequence & Document;

@Schema({ timestamps: true })
export class Sequence {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true, default: 0 })
  value: number;
}

export const SequenceSchema = SchemaFactory.createForClass(Sequence);
SequenceSchema.index({ key: 1 }, { unique: true });

