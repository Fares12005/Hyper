import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Reservation,
  ReservationDocument,
  ReservationPayMethod,
  ReservationStatus,
} from './reservation.schema';
import { User, UserDocument } from '../users/user.schema';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumPayments(doc: ReservationDocument): number {
  const rows = Array.isArray(doc.payments) ? doc.payments : [];
  return roundMoney(rows.reduce((s, p) => s + (Number(p?.amount) || 0), 0));
}

export interface ReservationView {
  _id: string;
  referenceNumber: string;
  description: string;
  totalDue: number;
  totalPaid: number;
  remaining: number;
  status: ReservationStatus;
  expectedCompletionDate?: Date;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  payments: Array<{
    amount: number;
    paidAt: Date;
    paymentMethod: ReservationPayMethod;
    notes?: string;
    cashierDisplayName?: string;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
  createdByDisplayName?: string;
}

@Injectable()
export class ReservationsService {
  constructor(
    @InjectModel(Reservation.name) private reservationModel: Model<ReservationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  private toView(doc: ReservationDocument): ReservationView {
    const totalPaid = sumPayments(doc);
    const totalDue = roundMoney(Number(doc.totalDue) || 0);
    const remaining = Math.max(0, roundMoney(totalDue - totalPaid));
    return {
      _id: String(doc._id),
      referenceNumber: doc.referenceNumber,
      description: doc.description,
      totalDue,
      totalPaid,
      remaining,
      status: doc.status,
      expectedCompletionDate: doc.expectedCompletionDate,
      customerName: doc.customerName,
      customerPhone: doc.customerPhone,
      notes: doc.notes,
      payments: (doc.payments || []).map((p) => ({
        amount: roundMoney(Number(p.amount) || 0),
        paidAt: p.paidAt,
        paymentMethod: p.paymentMethod,
        notes: p.notes,
        cashierDisplayName: p.cashierDisplayName,
      })),
      createdAt: doc.get?.('createdAt'),
      updatedAt: doc.get?.('updatedAt'),
      createdByDisplayName: doc.createdByDisplayName,
    };
  }

  async create(data: {
    referenceNumber: string;
    description: string;
    totalDue: number;
    firstPayment: number;
    paymentMethod: ReservationPayMethod;
    paymentNotes?: string;
    expectedCompletionDate?: string;
    customerName?: string;
    customerPhone?: string;
    notes?: string;
    userId: string;
  }) {
    const referenceNumber = String(data.referenceNumber || '').trim();
    if (!referenceNumber) throw new BadRequestException('أدخل الرقم المرجعي للشيك');
    const description = String(data.description || '').trim();
    if (!description) throw new BadRequestException('أدخل وصف الحجز');
    const customerName = String(data.customerName || '').trim();
    if (!customerName) throw new BadRequestException('أدخل اسم صاحب الحجز');
    const totalDue = roundMoney(Number(data.totalDue));
    if (!Number.isFinite(totalDue) || totalDue <= 0) throw new BadRequestException('إجمالي المستحق غير صالح');
    const firstPayment = roundMoney(Number(data.firstPayment));
    if (!Number.isFinite(firstPayment) || firstPayment < 0) throw new BadRequestException('مبلغ الدفعة غير صالح');
    if (firstPayment > totalDue) throw new BadRequestException('الدفعة الأولى أكبر من إجمالي المستحق');

    const pm =
      (Object.values(ReservationPayMethod) as string[]).includes(String(data.paymentMethod))
        ? data.paymentMethod
        : ReservationPayMethod.CASH;

    const user = await this.userModel.findById(data.userId).lean();
    const cashierName = String(user?.name || '').trim() || undefined;

    let expectedCompletionDate: Date | undefined;
    if (data.expectedCompletionDate) {
      const d = new Date(data.expectedCompletionDate);
      if (Number.isFinite(d.getTime())) expectedCompletionDate = d;
    }

    const payments =
      firstPayment > 0
        ? [
            {
              amount: firstPayment,
              paidAt: new Date(),
              paymentMethod: pm,
              notes: data.paymentNotes?.trim() || undefined,
              cashierDisplayName: cashierName,
            },
          ]
        : [];

    const dup = await this.reservationModel.findOne({ referenceNumber });
    if (dup) throw new BadRequestException('الرقم المرجعي مستخدم بالفعل في حجز آخر');

    const totalPaid = firstPayment;
    const status =
      roundMoney(totalPaid) >= totalDue ? ReservationStatus.COMPLETED : ReservationStatus.OPEN;

    const doc = await this.reservationModel.create({
      referenceNumber,
      description,
      totalDue,
      payments,
      status,
      expectedCompletionDate,
      customerName,
      customerPhone: data.customerPhone?.trim() || undefined,
      notes: data.notes?.trim() || undefined,
      createdBy: data.userId,
      createdByDisplayName: cashierName,
    });

    return this.toView(doc);
  }

  async list(status?: ReservationStatus, limit = 100) {
    const q: Record<string, unknown> = {};
    if (status && (Object.values(ReservationStatus) as string[]).includes(status)) {
      q.status = status;
    }
    const rows = await this.reservationModel
      .find(q)
      .sort({ updatedAt: -1 })
      .limit(Math.min(500, Math.max(1, limit)))
      .exec();
    return rows.map((r) => this.toView(r));
  }

  async lookupByReference(referenceNumber: string) {
    const ref = String(referenceNumber || '').trim();
    if (!ref) throw new BadRequestException('أدخل الرقم المرجعي');
    const doc = await this.reservationModel.findOne({ referenceNumber: ref }).exec();
    if (!doc) throw new NotFoundException('لا يوجد حجز بهذا الرقم المرجعي');
    return this.toView(doc);
  }

  async addPayment(
    id: string,
    body: { amount: number; paymentMethod: ReservationPayMethod; notes?: string },
    userId: string,
  ) {
    const amount = roundMoney(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('المبلغ غير صالح');

    const pm =
      (Object.values(ReservationPayMethod) as string[]).includes(String(body.paymentMethod))
        ? body.paymentMethod
        : ReservationPayMethod.CASH;

    const user = await this.userModel.findById(userId).lean();
    const cashierName = String(user?.name || '').trim() || undefined;

    const doc = await this.reservationModel.findById(id).exec();
    if (!doc) throw new NotFoundException('الحجز غير موجود');
    if (doc.status === ReservationStatus.CANCELLED) throw new BadRequestException('الحجز ملغى');
    if (doc.status === ReservationStatus.COMPLETED) throw new BadRequestException('الحجز مكتمل بالفعل');

    const paidBefore = sumPayments(doc);
    const totalDue = roundMoney(Number(doc.totalDue) || 0);
    const remainingBefore = Math.max(0, roundMoney(totalDue - paidBefore));
    if (amount > remainingBefore + 0.001)
      throw new BadRequestException(`المبلغ أكبر من المتبقي (${remainingBefore})`);

    doc.payments = doc.payments || [];
    doc.payments.push({
      amount,
      paidAt: new Date(),
      paymentMethod: pm,
      notes: body.notes?.trim() || undefined,
      cashierDisplayName: cashierName,
    });

    const paidAfter = sumPayments(doc);
    if (paidAfter >= totalDue - 0.001) doc.status = ReservationStatus.COMPLETED;
    await doc.save();

    return this.toView(doc);
  }

  async cancel(id: string) {
    const doc = await this.reservationModel.findById(id).exec();
    if (!doc) throw new NotFoundException('الحجز غير موجود');
    if (doc.status === ReservationStatus.COMPLETED) throw new BadRequestException('لا يمكن إلغاء حجز مكتمل');
    doc.status = ReservationStatus.CANCELLED;
    await doc.save();
    return this.toView(doc);
  }
}
