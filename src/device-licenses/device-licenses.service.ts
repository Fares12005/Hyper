import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceLicense, DeviceLicenseDocument } from './device-license.schema';
import { UserRole } from '../users/user.schema';

export type LicenseCheckReason = 'active' | 'not_registered' | 'expired';

@Injectable()
export class DeviceLicensesService {
  constructor(@InjectModel(DeviceLicense.name) private model: Model<DeviceLicenseDocument>) {}

  disabledGlobally(): boolean {
    const v = String(process.env.LICENSE_CHECK_DISABLED || '')
      .trim()
      .toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  async check(deviceIdRaw: string) {
    if (this.disabledGlobally()) {
      return {
        ok: true as const,
        reason: 'active' as LicenseCheckReason,
        deviceId: String(deviceIdRaw || '').trim(),
        expiresAt: null as Date | null,
        label: '',
      };
    }

    const deviceId = String(deviceIdRaw || '').trim();
    if (!deviceId) throw new BadRequestException('معرّف الجهاز مطلوب');

    const doc = await this.model.findOne({ deviceId }).exec();

    /** بدون سجل اشتراك = تشغيل عادي بدون قيد */
    if (!doc) {
      return {
        ok: true as const,
        reason: 'not_registered' as LicenseCheckReason,
        deviceId,
        expiresAt: null as Date | null,
        label: '',
      };
    }

    await this.model.updateOne({ deviceId }, { $set: { lastSeenAt: new Date() } }).exec();

    const exp = doc.expiresAt ? new Date(doc.expiresAt).getTime() : 0;
    const now = Date.now();
    if (!exp || exp <= now) {
      return {
        ok: false as const,
        reason: 'expired' as LicenseCheckReason,
        deviceId,
        expiresAt: doc.expiresAt,
        label: doc.label || '',
      };
    }

    return {
      ok: true as const,
      reason: 'active' as LicenseCheckReason,
      deviceId,
      expiresAt: doc.expiresAt,
      label: doc.label || '',
    };
  }

  /**
   * عند تسجيل الدخول: المطوّر معفى؛ بدون سجل جهاز = مسموح؛ مع سجل منتهي = مرفوض.
   */
  async assertDeviceLicensed(deviceIdRaw: string | undefined, userRole?: string) {
    if (this.disabledGlobally()) return;
    if (userRole === UserRole.DEVELOPER) return;

    const deviceId = String(deviceIdRaw || '').trim();
    if (!deviceId) return;

    const doc = await this.model.findOne({ deviceId }).exec();
    if (!doc) return;

    const exp = doc.expiresAt ? new Date(doc.expiresAt).getTime() : 0;
    const now = Date.now();
    if (!exp || exp <= now) {
      throw new BadRequestException('انتهت مدة الاشتراك لهذا الجهاز.');
    }

    await this.model.updateOne({ deviceId }, { $set: { lastSeenAt: new Date() } }).exec();
  }

  findAll() {
    return this.model.find().sort({ updatedAt: -1 }).lean().exec();
  }

  async upsert(deviceIdRaw: string, expiresAtIso: string, label?: string) {
    const deviceId = String(deviceIdRaw || '').trim();
    if (!deviceId) throw new BadRequestException('معرّف الجهاز مطلوب');

    const expiresAt = new Date(expiresAtIso);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('تاريخ انتهاء الاشتراك غير صالح');
    }

    const doc = await this.model
      .findOneAndUpdate(
        { deviceId },
        {
          $set: {
            expiresAt,
            label: String(label ?? '').trim(),
            lastSeenAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    return doc;
  }

  /** حذف سجل الاشتراك — الجهاز يعود للتشغيل بلا قيد (كأنه لم يُسجَّل) */
  async remove(deviceIdRaw: string) {
    const deviceId = String(deviceIdRaw || '').trim();
    if (!deviceId) throw new BadRequestException('معرّف الجهاز مطلوب');

    const result = await this.model.deleteOne({ deviceId }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('لا يوجد اشتراك مسجّل لهذا الجهاز.');
    }

    return { ok: true, deviceId };
  }
}
