import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  /** حساب المطور / مالك البرنامج — لوحة منفصلة، لا يُقيَّد باشتراك الجهاز */
  DEVELOPER = 'developer',
  ADMIN   = 'admin',
  CASHIER = 'cashier',
  STOCK   = 'stock',
  CUSTOMER = 'customer',
  DELIVERY = 'delivery',
  CALLCENTER = 'callcenter',
  /** شاشة استعلام سعر للعميل (كiosk على الحائط) — قراءة منتجات فقط */
  PRICE_KIOSK = 'price_kiosk',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true })
  password: string; // hashed

  @Prop({ required: true })
  name: string;

  @Prop({ enum: UserRole, default: UserRole.CASHIER })
  role: UserRole;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
