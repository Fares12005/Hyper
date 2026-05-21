import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument, UserRole } from './user.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { StockPermission, StockPermissionDocument } from '../stock/stock-permission.schema';
import { SupplyOrder, SupplyOrderDocument } from '../supply-orders/supply-order.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(StockPermission.name) private stockPermModel: Model<StockPermissionDocument>,
    @InjectModel(SupplyOrder.name) private supplyOrderModel: Model<SupplyOrderDocument>,
  ) {}

  private normalizeUsername(username: string) {
    const u = String(username ?? '').trim().toLowerCase();
    if (!u) throw new BadRequestException('اسم الدخول مطلوب');
    if (/\s/.test(u)) throw new BadRequestException('اسم الدخول لا يجب أن يحتوي مسافات');
    return u;
  }

  async onModuleInit() {
    // تأكد إن المستخدمين الافتراضيين موجودين (حتى لو DB مش فاضية)
    await this.ensureDefaultUsers();
  }

  private async ensureDefaultUsers() {
    const defaults = [
      { username: 'admin',   password: '1234', name: 'سارة الأدمن',   role: UserRole.ADMIN   },
      { username: 'cashier', password: '1234', name: 'أحمد الكاشير',  role: UserRole.CASHIER },
      { username: 'stock',   password: '1234', name: 'محمود المخزن',  role: UserRole.STOCK   },
      { username: 'customer',password: '1234', name: 'عميل',          role: UserRole.CUSTOMER },
      { username: 'delivery',password: '1234', name: 'مندوب توصيل',   role: UserRole.DELIVERY },
      { username: 'callcentier',password: '1234', name: 'كول سنتر',   role: UserRole.CALLCENTER },
      { username: 'pricekiosk', password: '1234', name: 'شاشة سعر المنتج', role: UserRole.PRICE_KIOSK },
    ];

    let createdAny = false;
    for (const u of defaults) {
      const exists = await this.userModel.findOne({ username: u.username });
      if (exists) continue;
      const hashed = await bcrypt.hash(u.password, 10);
      await this.userModel.create({ ...u, password: hashed });
      createdAny = true;
    }
    if (createdAny) console.log('✅ Default users ensured');

    /**
     * حساب المطور (اختياري): في .env ضع
     * HYPERMART_DEV_OWNER_USERNAME + HYPERMART_DEV_OWNER_PASSWORD
     * اختياري: HYPERMART_DEV_OWNER_NAME
     * لو الاسم مستخدم مسبقاً بدور آخر: ضع HYPERMART_DEV_UPGRADE_EXISTING=true مرة واحدة لترقية الحساب لمطوّر وتحديث كلمة المرور.
     */
    const devUserRaw = String(process.env.HYPERMART_DEV_OWNER_USERNAME || '').trim();
    const devPass = String(process.env.HYPERMART_DEV_OWNER_PASSWORD || '').trim();
    const devDisplayName = String(process.env.HYPERMART_DEV_OWNER_NAME || '').trim() || 'مالك البرنامج';
    const devUpgrade = ['1', 'true', 'yes'].includes(
      String(process.env.HYPERMART_DEV_UPGRADE_EXISTING || '').trim().toLowerCase(),
    );

    if (devUserRaw && devPass) {
      try {
        const username = this.normalizeUsername(devUserRaw);
        const existing = await this.userModel.findOne({ username });

        if (!existing) {
          const hashedDev = await bcrypt.hash(devPass, 10);
          await this.userModel.create({
            username,
            password: hashedDev,
            name: devDisplayName,
            role: UserRole.DEVELOPER,
            isActive: true,
          });
          console.log(
            `✅ تم إنشاء حساب المطور (${username}) — سجّل الدخول من البرنامج بهذا الاسم وكلمة المرور من .env`,
          );
        } else if (existing.role === UserRole.DEVELOPER) {
          console.log(`ℹ️ حساب المطور (${username}) موجود مسبقاً — لا حاجة لإعادة الإنشاء.`);
        } else if (devUpgrade) {
          const hashedDev = await bcrypt.hash(devPass, 10);
          await this.userModel.updateOne(
            { _id: existing._id },
            {
              $set: {
                role: UserRole.DEVELOPER,
                password: hashedDev,
                name: devDisplayName,
                isActive: true,
              },
            },
          );
          console.log(
            `✅ تم ترقية المستخدم (${username}) إلى مطوّر وتحديث الاسم وكلمة المرور — أزل HYPERMART_DEV_UPGRADE_EXISTING من .env بعد التأكد.`,
          );
        } else {
          console.warn(
            `⚠️ لم يُنشأ حساب المطور: اسم المستخدم "${username}" مستخدم مسبقاً بدور "${String(existing.role)}".\n` +
              `   الحلول: (1) غيّر HYPERMART_DEV_OWNER_USERNAME لاسم غير مستخدم، أو (2) احذف/عدّل المستخدم من MongoDB، أو (3) أضف في .env مرة واحدة: HYPERMART_DEV_UPGRADE_EXISTING=true ثم أعد تشغيل السيرفر.`,
          );
        }
      } catch (e: any) {
        console.error('⚠️ فشل bootstrap حساب المطور:', e?.stack || e?.message || e);
      }
    } else {
      const hasU = Boolean(devUserRaw);
      const hasP = Boolean(devPass);
      console.log(
        `ℹ️ حساب المطوّر غير مفعّل: username=${hasU ? 'موجود' : 'ناقص'} password=${hasP ? 'موجود' : 'ناقص'}. ` +
          `لازم الاثنين في .env: HYPERMART_DEV_OWNER_USERNAME و HYPERMART_DEV_OWNER_PASSWORD (اختياري: HYPERMART_DEV_OWNER_NAME).`,
      );
    }
  }

  async findByUsername(username: string): Promise<UserDocument | null> {
    const u = this.normalizeUsername(username);
    return this.userModel.findOne({ username: u, isActive: true });
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().select('-password');
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).select('-password');
    if (!user) throw new NotFoundException('المستخدم مش موجود');
    return user;
  }

  async create(
    data: { username: string; password: string; name: string; role: UserRole },
    actingRole?: UserRole,
  ) {
    const username = this.normalizeUsername(data.username);
    const name = String(data?.name ?? '').trim();
    const password = String(data?.password ?? '');
    const role = data?.role as any;

    if (!name) throw new BadRequestException('اسم الموظف مطلوب');
    if (!password) throw new BadRequestException('كلمة المرور مطلوبة');

    if (role === UserRole.DEVELOPER && actingRole !== UserRole.DEVELOPER) {
      throw new ForbiddenException('لا يمكن إنشاء حساب مطوّر إلا من حساب مطوّر');
    }

    const exists = await this.userModel.findOne({ username });
    if (exists) throw new ConflictException('اسم المستخدم موجود بالفعل');
    const hashed = await bcrypt.hash(password, 10);
    return this.userModel.create({ username, name, role, password: hashed, isActive: true });
  }

  // Register public customer account (self signup)
  async registerCustomer(data: { username: string; password: string; name: string }) {
    const username = this.normalizeUsername(data.username);
    const name = String(data?.name ?? '').trim();
    const password = String(data?.password ?? '');
    if (!name) throw new BadRequestException('الاسم مطلوب');
    if (!password) throw new BadRequestException('كلمة المرور مطلوبة');

    const exists = await this.userModel.findOne({ username });
    if (exists) throw new ConflictException('اسم المستخدم موجود بالفعل');
    const hashed = await bcrypt.hash(password, 10);
    return this.userModel.create({
      username,
      password: hashed,
      name,
      role: UserRole.CUSTOMER,
      isActive: true,
    });
  }

  async update(
    id: string,
    data: Partial<{ name: string; role: UserRole; isActive: boolean; password: string }>,
    actingRole?: UserRole,
  ) {
    const existing = await this.userModel.findById(id).select('role');
    if (!existing) throw new NotFoundException('المستخدم مش موجود');

    if (existing.role === UserRole.DEVELOPER && actingRole !== UserRole.DEVELOPER) {
      throw new ForbiddenException('لا يمكن تعديل حساب المطوّر إلا من حساب مطوّر');
    }

    if (data.role === UserRole.DEVELOPER && actingRole !== UserRole.DEVELOPER) {
      throw new ForbiddenException('لا يمكن تعيين دور مطوّر إلا من حساب مطوّر');
    }

    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }
    return this.userModel.findByIdAndUpdate(id, data, { new: true }).select('-password');
  }

  /**
   * حذف نهائي للمستخدم من قاعدة البيانات.
   * قبل الحذف يُثبَّت الاسم الظاهر على كل السجلات المرتبطة (فواتير، أذون مخزون، طلبات توريد)
   * حتى تبقى المعاملات القديمة تعرض الاسم حتى بعد اختفاء الحساب.
   */
  async remove(id: string, requesterUserId?: string, actingRole?: UserRole) {
    const target = await this.userModel.findById(id).select('name role');
    if (!target) throw new NotFoundException('المستخدم مش موجود');
    if (target.role === UserRole.DEVELOPER && actingRole !== UserRole.DEVELOPER) {
      throw new ForbiddenException('لا يمكن حذف حساب المطوّر إلا من حساب مطوّر');
    }
    if (requesterUserId && String(target._id) === String(requesterUserId)) {
      throw new BadRequestException('لا يمكن حذف حسابك الحالي');
    }
    const displayName = String(target.name || '').trim() || '—';
    const oid = target._id;

    await this.orderModel.updateMany({ cashier: oid }, { $set: { cashierDisplayName: displayName } });
    await this.orderModel.updateMany({ customer: oid }, { $set: { customerAccountDisplayName: displayName } });
    await this.stockPermModel.updateMany({ createdBy: oid }, { $set: { createdByDisplayName: displayName } });
    await this.stockPermModel.updateMany({ approvedBy: oid }, { $set: { approvedByDisplayName: displayName } });
    await this.supplyOrderModel.updateMany({ createdBy: oid }, { $set: { createdByDisplayName: displayName } });
    await this.supplyOrderModel.updateMany({ approvedBy: oid }, { $set: { approvedByDisplayName: displayName } });
    await this.supplyOrderModel.updateMany({ fulfilledBy: oid }, { $set: { fulfilledByDisplayName: displayName } });

    await this.userModel.findByIdAndDelete(id);
    return { success: true };
  }
}
