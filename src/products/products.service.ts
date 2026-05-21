import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './product.schema';

@Injectable()
export class ProductsService {
  constructor(@InjectModel(Product.name) private productModel: Model<ProductDocument>) {}

  async onModuleInit() {
    // تنبيه النقص يعتمد على hadWarehouseReceive — ترحيل المنتجات القديمة اللي الرصيد فيها > 0
    await this.productModel.updateMany(
      { hadWarehouseReceive: { $exists: false }, stock: { $gt: 0 } },
      { $set: { hadWarehouseReceive: true } },
    );
    await this.productModel.updateMany(
      { hadWarehouseReceive: { $exists: false }, stock: { $lte: 0 } },
      { $set: { hadWarehouseReceive: false } },
    );

    // Disabled by default: we don't want the DB to auto-fill products
    // especially when importing from an external file (Excel/CSV).
    const shouldSeed = String(process.env.SEED_DEFAULT_PRODUCTS || '').toLowerCase() === 'true';
    if (!shouldSeed) return;
    const count = await this.productModel.countDocuments();
    if (count === 0) await this.seedProducts();
  }

  private async seedProducts() {
    const products = [
      { name: 'تفاح أحمر',   category: 'فواكه',   price: 12.5,  stock: 48,  emoji: '🍎', barcode: '001' },
      { name: 'موز أصفر',    category: 'فواكه',   price: 9,     stock: 30,  emoji: '🍌', barcode: '002' },
      { name: 'طماطم طازجة', category: 'خضار',    price: 7,     stock: 0,   emoji: '🍅', barcode: '003' },
      { name: 'لبن كامل',    category: 'ألبان',   price: 8,     stock: 60,  emoji: '🥛', barcode: '004' },
      { name: 'جبنة رومي',   category: 'ألبان',   price: 45,    stock: 8,   emoji: '🧀', barcode: '005', lowStockThreshold: 10 },
      { name: 'خبز عيش',     category: 'مخبوزات', price: 5,     stock: 100, emoji: '🍞', barcode: '006' },
      { name: 'دجاج مشوي',   category: 'لحوم',    price: 65,    stock: 12,  emoji: '🍗', barcode: '007' },
      { name: 'مياه معدنية', category: 'مشروبات', price: 4,     stock: 200, emoji: '💧', barcode: '008' },
      { name: 'أرز بسمتي',   category: 'حبوب',    price: 35,    stock: 70,  emoji: '🌾', barcode: '009' },
      { name: 'زيت زيتون',   category: 'زيوت',    price: 85,    stock: 3,   emoji: '🫒', barcode: '010', lowStockThreshold: 5 },
    ];
    await this.productModel.insertMany(products);
    console.log('✅ Default products seeded');
  }

  /** فلتر قائمة المنتجات النشطة + قسم/بحث (مشترك بين findAll / findPaged) */
  private buildListFilter(category?: string, search?: string, extra?: any) {
    const filter: any = { isActive: true };
    if (category && category !== 'الكل') {
      // Support category paths like "قسم / فرعي"
      filter.category = { $regex: `^${escapeRegExp(category)}(\\s*\\/|$)`, $options: 'i' };
    }
    if (search) Object.assign(filter, buildSearchFilter(search));
    if (extra && typeof extra === 'object') Object.assign(filter, extra);
    return filter;
  }

  /**
   * ترتيب العرض: اللي لسه فيه مخزون (stock > 0) يظهر الأول، وبعدها المنتهي/الصفر.
   * ينطبق على أي قسم أو بحث — كل عمليات الجلب اللي بتعدي من هنا.
   */
  private aggregateListedProducts(filter: any, opts: { skip?: number; limit?: number }) {
    const pipe: any[] = [
      { $match: filter },
      {
        $addFields: {
          _availSort: { $cond: [{ $gt: ['$stock', 0] }, 0, 1] },
        },
      },
      { $sort: { _availSort: 1, name: 1 } },
    ];
    if (opts.skip != null) pipe.push({ $skip: opts.skip });
    if (opts.limit != null) pipe.push({ $limit: opts.limit });
    pipe.push({ $project: { _availSort: 0 } });
    return this.productModel.aggregate(pipe);
  }

  findAll(category?: string, search?: string) {
    const filter = this.buildListFilter(category, search);
    return this.aggregateListedProducts(filter, {});
  }

  findPaged(category?: string, search?: string, limit = 200, skip = 0) {
    const filter = this.buildListFilter(category, search);
    const lim = Math.max(1, Math.min(500, Number(limit) || 200));
    const sk = Math.max(0, Number(skip) || 0);
    return this.aggregateListedProducts(filter, { skip: sk, limit: lim });
  }

  /**
   * اقتراحات سريعة للبحث (لشاشات التشغيل): أولوية للمطابقة من بداية الاسم ثم المطابقة داخل الاسم.
   * يرجع حقول خفيفة للعرض في dropdown.
   */
  async suggest(search: string, limit = 20) {
    const s = String(search ?? '').trim();
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    if (!s) return [];

    const cleanBarcode = sanitizeScannerBarcode(s);
    const rx = escapeRegExp(s);
    const starts = new RegExp(`^${rx}`, 'i');
    const contains = new RegExp(rx, 'i');

    const baseFilter: any = { isActive: true };
    const barcodeDigits = String(cleanBarcode || '').replace(/-/g, '');
    const barcodeOr: any[] = [];
    if (cleanBarcode) barcodeOr.push({ barcode: cleanBarcode });
    if (barcodeDigits) barcodeOr.push({ barcode: barcodeDigits });

    const project = { name: 1, barcode: 1, stock: 1, price: 1, category: 1 };

    const prefixFilter: any = { ...baseFilter, name: { $regex: starts } };
    if (barcodeOr.length) prefixFilter.$or = [{ name: { $regex: starts } }, ...barcodeOr];
    const first = await this.productModel.find(prefixFilter).select(project as any).sort({ name: 1 }).limit(lim).lean();

    if (first.length >= lim) return first;

    const need = lim - first.length;
    const used = new Set(first.map((x: any) => String(x._id)));
    const containFilter: any = { ...baseFilter, name: { $regex: contains } };
    if (barcodeOr.length) containFilter.$or = [{ name: { $regex: contains } }, ...barcodeOr];
    const more = await this.productModel.find(containFilter).select(project as any).sort({ name: 1 }).limit(lim * 2).lean();
    const merged: any[] = [...first];
    for (const m of more) {
      if (merged.length >= lim) break;
      const id = String((m as any)?._id);
      if (!id || used.has(id)) continue;
      used.add(id);
      merged.push(m);
    }
    return merged.slice(0, lim);
  }

  async findByBarcode(barcode: string) {
    const clean = sanitizeScannerBarcode(barcode);
    const digits = String(clean || '').replace(/-/g, '');
    const p = await this.productModel.findOne({
      isActive: true,
      $or: [{ barcode: clean }, ...(digits ? [{ barcode: digits }] : [])],
    });
    if (p) return p;

    // باركود الرف من النظام (assignScalePlu): EAN-13 = 20 + حقل PLU بعرض 10 أرقام + خانة تحقق
    if (/^20\d{10}\d$/.test(digits)) {
      const pluBlock = digits.slice(2, 12);
      const pluNum = parseInt(pluBlock, 10);
      if (Number.isFinite(pluNum) && pluNum > 0) {
        const byPlu = await this.findProductByScalePluDigits(String(pluNum));
        if (byPlu) return byPlu;
      }
    }

    // باركود ميزان شائع: 13 رقم يبدأ بـ 2 ثم 5 خانات PLU (ليس نفس صيغة 20+10 أعلاه)
    if (/^2\d{12}$/.test(digits) && !/^20\d{10}\d$/.test(digits)) {
      const plu5 = digits.slice(1, 6);
      const byPlu = await this.findProductByScalePluDigits(plu5);
      if (byPlu) return byPlu;
    }
    return null;
  }

  async findById(id: string) {
    const p = await this.productModel.findById(id);
    if (!p) throw new NotFoundException('المنتج مش موجود');
    return p;
  }

  create(data: Partial<Product>) {
    const stock = Number((data as any).stock ?? 0);
    const payload = {
      ...data,
      hadWarehouseReceive: Boolean((data as any).hadWarehouseReceive) || (Number.isFinite(stock) && stock > 0),
    };
    return this.productModel.create(payload);
  }

  async update(id: string, data: Partial<Product>) {
    const patch: any = { ...data };
    if (data.stock !== undefined) {
      const prev = await this.productModel.findById(id).select('stock').lean();
      const prevStock = Number((prev as any)?.stock ?? 0);
      const newStock = Number(data.stock);
      if (Number.isFinite(newStock) && newStock > prevStock) {
        patch.hadWarehouseReceive = true;
      }
    }
    const p = await this.productModel.findByIdAndUpdate(id, patch, { new: true });
    if (!p) throw new NotFoundException('المنتج مش موجود');
    return p;
  }

  async updateStock(id: string, delta: number, opts?: { markStockIn?: boolean }) {
    const update: Record<string, unknown> = { $inc: { stock: delta } };
    if (opts?.markStockIn && delta > 0) {
      (update as any).$set = { hadWarehouseReceive: true };
    }
    const p = await this.productModel.findByIdAndUpdate(id, update, { new: true });
    if (!p) throw new NotFoundException('المنتج مش موجود');
    return p;
  }

  getLowStock() {
    return this.productModel.aggregate([
      {
        $match: {
          isActive: true,
          hadWarehouseReceive: true,
          $expr: { $lte: ['$stock', '$lowStockThreshold'] },
        },
      },
      {
        $addFields: {
          _availSort: { $cond: [{ $gt: ['$stock', 0] }, 0, 1] },
        },
      },
      { $sort: { _availSort: 1, stock: 1, name: 1 } },
      { $project: { _availSort: 0 } },
    ]);
  }

  async getCategories() {
    const cats = await this.productModel.distinct('category', { isActive: true });
    const top = new Set<string>();
    for (const c of cats) {
      const t = String(c || '').split('/')[0].trim();
      if (t) top.add(t);
    }
    return Array.from(top).sort((a, b) => a.localeCompare(b, 'ar'));
  }

  /** أصناف الميزان فقط */
  findWeightProducts(category?: string, search?: string) {
    // مهم: $ne لوحدها بتطابق الحقول غير الموجودة (missing) => ترجع كل المنتجات وتعمل تهنيج.
    // لازم نضمن إن scalePlu "موجود" ومش فاضي.
    const extra = {
      $or: [
        { soldByWeight: true },
        { scalePlu: { $exists: true, $ne: '' } },
      ],
    };
    const filter = this.buildListFilter(category, search, extra);
    return this.aggregateListedProducts(filter, {});
  }

  /** إنشاء/تخصيص كود ميزان (PLU) — إن وُجد باركود رقمي قصير أو باركود رف داخلي 20… يُستخدم كـ PLU؛ وإلا متسلسل 1، 2، 3… */
  async assignScalePlu(id: string) {
    const p = await this.productModel.findById(id);
    if (!p) throw new NotFoundException('المنتج مش موجود');
    if (String(p.scalePlu || '').trim()) return p;

    const fromBarcode = tryBarcodeDerivedScalePlu(String((p as any).barcode || ''));
    if (fromBarcode != null) {
      const taken = await this.productModel
        .findOne({
          isActive: true,
          _id: { $ne: p._id },
          scalePlu: String(fromBarcode),
        })
        .select({ _id: 1 })
        .lean();
      if (!taken) {
        p.scalePlu = String(fromBarcode);
        p.soldByWeight = true;
        if (!String((p as any).barcode || '').trim()) {
          (p as any).barcode = internalShelfEan13FromScalePlu(fromBarcode);
        }
        await p.save();
        return p;
      }
      // لو الرقم محجوز لصنف آخر نكمّل بالمتسلسل
    }

    const agg = await this.productModel.aggregate([
      { $match: { isActive: true, scalePlu: { $ne: '' } } },
      {
        $addFields: {
          _pluNum: {
            $convert: { input: '$scalePlu', to: 'int', onError: null, onNull: null },
          },
        },
      },
      { $match: { _pluNum: { $ne: null } } },
      { $sort: { _pluNum: -1 } },
      { $limit: 1 },
      { $project: { _pluNum: 1 } },
    ]);
    const max = Number(agg?.[0]?._pluNum ?? 0);
    const next = max + 1;
    // حتى 5 أرقام يدخل جوّه باركود الميزان EAN-13 (جزء PLU)
    if (!Number.isFinite(next) || next < 1 || next > 99999) throw new Error('نفدت أكواد الميزان');

    p.scalePlu = String(next);
    p.soldByWeight = true;
    if (!String((p as any).barcode || '').trim()) {
      (p as any).barcode = internalShelfEan13FromScalePlu(next);
    }
    await p.save();
    return p;
  }

  /** فرض تطابق كود الميزان مع الباركود الرقمي (إصلاح أصناف كانت PLU أوتوماتيك مختلف عن ما يُكتب على الميزان) */
  async syncScalePluFromBarcode(id: string) {
    const p = await this.productModel.findById(id);
    if (!p) throw new NotFoundException('المنتج مش موجود');
    const fromBarcode = tryBarcodeDerivedScalePlu(String((p as any).barcode || ''));
    if (fromBarcode == null) {
      throw new BadRequestException(
        'الباركود الحالي لا يُفسَّر ككود PLU (توقُّع من 1 إلى 99999، أو باركود الرف الداخلي 13 رقم يبدأ بـ 20)',
      );
    }
    const taken = await this.productModel
      .findOne({
        isActive: true,
        _id: { $ne: p._id },
        scalePlu: String(fromBarcode),
      })
      .select({ _id: 1 })
      .lean();
    if (taken) throw new ConflictException(`كود الميزان ${fromBarcode} مستخدم بالفعل لصنف آخر`);
    p.scalePlu = String(fromBarcode);
    p.soldByWeight = true;
    await p.save();
    return p;
  }

  private async findProductByScalePluDigits(segment: string) {
    const seg = String(segment || '').replace(/\D/g, '');
    if (!seg) return null;
    const trimmed = seg.replace(/^0+/, '') || '0';
    const numeric = String(parseInt(seg, 10));
    const candidates = [...new Set([seg, trimmed, numeric])].filter(Boolean);
    return this.productModel.findOne({
      isActive: true,
      $or: candidates.map((c) => ({ scalePlu: c })),
    });
  }

  delete(id: string) {
    return this.productModel.findByIdAndUpdate(id, { isActive: false }, { new: true });
  }
}

/** باركود رف ثابت 13 رقم (EAN-13) للصنف بالميزان: بادئة `20` + PLU مبطّن 10 أرقام + خانة تحقق */
function internalShelfEan13FromScalePlu(plu: number): string {
  const n = Math.max(1, Math.min(99999, Math.floor(Number(plu))));
  const body = `20${String(n).padStart(10, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}

function ean13CheckDigit(body12: string): string {
  if (body12.length !== 12) return '0';
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(body12.charAt(i), 10) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

/** استخراج رقم PLU من باركود المستخدم أو من باركود الرف الداخلي EAN-13 (20 + PLU بعرض 10 + تحقق) */
function tryBarcodeDerivedScalePlu(barcode: string): number | null {
  const digits = String(barcode || '')
    .trim()
    .replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 13 && digits.startsWith('20')) {
    const body12 = digits.slice(0, 12);
    const check = digits.slice(12, 13);
    if (ean13CheckDigit(body12) !== check) return null;
    const inner = parseInt(digits.slice(2, 12), 10);
    if (!Number.isFinite(inner) || inner < 1 || inner > 99999) return null;
    return inner;
  }

  if (digits.length > 13) return null;
  const trimmed = digits.replace(/^0+/, '') || '0';
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1 || n > 99999) return null;
  return n;
}

function escapeRegExp(s: string) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function latinizeBarcodeDigits(s: string): string {
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  let out = '';
  for (const ch of s) {
    const i = AR.indexOf(ch);
    if (i !== -1) {
      out += String(i);
      continue;
    }
    const j = FA.indexOf(ch);
    if (j !== -1) {
      out += String(j);
      continue;
    }
    out += ch;
  }
  return out;
}

/** Match POS: أرقام عربي/فارسي + إزالة رموز لوحة عربي/ماسح (مثل `[`) + F زائدة */
function sanitizeScannerBarcode(raw: string) {
  let s = latinizeBarcodeDigits(String(raw ?? '').replace(/[\u0000-\u001F\u007F]/g, '')).trim();
  s = s.replace(/[^\d-]/g, '');
  if (/^[\d-]{4,}[fF]+$/i.test(s)) s = s.replace(/[fF]+$/gi, '');
  if (/^[fF]+[\d-]{4,}$/i.test(s)) s = s.replace(/^[fF]+/i, '');
  return s;
}

function buildSearchFilter(rawSearch: string) {
  const s = String(rawSearch ?? '').trim();
  if (!s) return {};

  // Support barcode search + name search together.
  // Barcode arm uses digits/hyphen only after sanitize — skip it when empty (e.g. pure Arabic name search)
  // so we never use $regex: '' which would match every barcode.
  const nameRx = { $regex: escapeRegExp(s), $options: 'i' };
  const cleanBarcode = sanitizeScannerBarcode(s);
  const or: { name?: typeof nameRx; barcode?: { $regex: string; $options: string } }[] = [{ name: nameRx }];
  if (cleanBarcode) {
    or.push({ barcode: { $regex: escapeRegExp(cleanBarcode), $options: 'i' } });
  }
  return { $or: or };
}
