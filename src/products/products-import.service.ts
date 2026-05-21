import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Readable } from 'stream';
import * as csvParser from 'csv-parser';
import * as XLSX from 'xlsx';
import { basename, extname } from 'path';
import { readFileSync } from 'fs';
import { Product, ProductDocument } from './product.schema';

type AnyRow = Record<string, any>;

function normKey(k: string) {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[ـ_]/g, '')
    .replace(/[()]/g, '')
    .replace(/[:\-]+/g, ' ')
    .trim();
}

function pickFirst(row: AnyRow, keys: string[]) {
  for (const k of Object.keys(row)) {
    const nk = normKey(k);
    if (keys.includes(nk)) return row[k];
  }
  return undefined;
}

function toNumber(val: any, fallback = 0) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val).trim();
  if (!s) return fallback;
  // Remove currency / thousands separators
  const cleaned = s
    .replace(/[^\d.,\-]/g, '')
    .replace(/,/g, '.')
    .replace(/\.(?=.*\.)/g, ''); // keep last dot as decimal
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function toString(val: any) {
  const s = String(val ?? '').trim();
  return s;
}

/** خلية ظاهرة في الملف (حتى لو الرقم 0) — لو فاضية نعتبر الحقل «مش موجود» وما نلمسش القيمة القديمة في وضع الدمج */
function hasExplicitCell(val: any): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === 'number' && Number.isFinite(val)) return true;
  return String(val).trim() !== '';
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function buildCategoryPath(row: AnyRow) {
  const category = toString(
    pickFirst(row, [
      'category',
      'القسم',
      'التصنيف',
      'اسم القسم',
      'القسم الرئيسي',
      'المجموعة',
      'group',
      'department',
    ]),
  );

  // Support hierarchical columns like: قسم 1 / قسم 2 / قسم 3 ...
  const parts: string[] = [];
  const directParts = [
    toString(pickFirst(row, ['القسم 1', 'قسم 1', 'cat 1', 'category 1', 'level 1', 'l1'])),
    toString(pickFirst(row, ['القسم 2', 'قسم 2', 'cat 2', 'category 2', 'level 2', 'l2'])),
    toString(pickFirst(row, ['القسم 3', 'قسم 3', 'cat 3', 'category 3', 'level 3', 'l3'])),
    toString(pickFirst(row, ['القسم 4', 'قسم 4', 'cat 4', 'category 4', 'level 4', 'l4'])),
  ].filter(Boolean);

  if (directParts.length) parts.push(...directParts);
  else if (category) parts.push(category);

  return parts.filter(Boolean).join(' / ');
}

@Injectable()
export class ProductsImportService {
  constructor(@InjectModel(Product.name) private productModel: Model<ProductDocument>) {}

  async onModuleInit() {
    const filePath = String(process.env.AUTO_IMPORT_ITEMS_TREE_PATH || '').trim();
    const enabled = String(process.env.AUTO_IMPORT_ITEMS_TREE || '').toLowerCase() === 'true';
    if (!enabled || !filePath) return;

    try {
      const buffer = readFileSync(filePath);
      const originalname = basename(filePath);
      // مهم: الاستيراد التلقائي **مايمسحش** المنتجات الموجودة.
      // لو محتاج استبدال كامل من الملف، شغّل رفع يدوي بـ ?mode=replace أو استخدم purge صريح.
      const wipe = String(process.env.AUTO_IMPORT_ITEMS_TREE_WIPE || '').toLowerCase() === 'true';
      const fakeFile = { originalname, buffer } as Express.Multer.File;
      // eslint-disable-next-line no-console
      if (wipe) {
        const res = await this.resetAndImport(fakeFile);
        console.log(`✅ Auto import done (replace): inserted=${res.inserted} skipped=${res.skipped}`);
      } else {
        const res = await this.mergeImport(fakeFile);
        console.log(
          `✅ Auto import done (merge): upserted=${res.upserted} newRows=${res.insertedOnly} skipped=${res.skipped}`,
        );
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(`❌ Auto import failed: ${e?.message || e}`);
    }
  }

  private csvStreamFromUpload(file: Express.Multer.File) {
    const ext = extname(file.originalname || '').toLowerCase();
    if (ext === '.csv') {
      return Readable.from(file.buffer);
    }

    if (ext === '.xls' || ext === '.xlsx') {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = wb.SheetNames?.[0];
      if (!sheetName) throw new BadRequestException('ملف الإكسل فاضي');
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      return Readable.from(csv);
    }

    throw new BadRequestException('الملف لازم يكون CSV أو Excel (xls/xlsx)');
  }

  /**
   * @param mergeMode لو true (استيراد دمج): ما نحدّثش السعر/الكمية/حد التنبيه إلا لو العمود موجود فعلاً في الصف،
   * عشان ملفات الأسعار أو الأسماء من غير أعمدة مخزون ما تصفّرش المخزون في الداتابيز.
   */
  private rowToProduct(row: AnyRow, mergeMode = false): Partial<Product> | null {
    const name =
      toString(
        pickFirst(row, [
          'name',
          'اسم المنتج',
          'المنتج',
          'الصنف',
          'اسم الصنف',
          'item',
          'product',
          'product name',
        ]),
      ) || '';
    if (!name) return null;

    const categoryPath = buildCategoryPath(row) || 'غير مصنف';

    const priceRaw = pickFirst(row, ['price', 'السعر', 'سعر', 'سعر البيع', 'price egp', 'unit price']);
    const price =
      mergeMode && !hasExplicitCell(priceRaw) ? undefined : toNumber(priceRaw, 0);

    const stockRaw = pickFirst(row, ['stock', 'الكمية', 'كمية', 'الرصيد', 'رصيد', 'qty', 'quantity']);
    const stock =
      mergeMode && !hasExplicitCell(stockRaw) ? undefined : toNumber(stockRaw, 0);

    const barcode = toString(pickFirst(row, ['barcode', 'باركود', 'الباركود', 'sku', 'code']));
    const emoji = toString(pickFirst(row, ['emoji', 'ايموجي', 'رمز']));
    const imageUrl = toString(pickFirst(row, ['image', 'imageurl', 'صورة', 'رابط الصورة', 'image url']));
    const isActiveRaw = pickFirst(row, ['isactive', 'active', 'نشط']);
    const isActive =
      isActiveRaw === undefined || isActiveRaw === null || String(isActiveRaw).trim() === ''
        ? true
        : !/^(0|false|no|n|غير|لا)$/i.test(String(isActiveRaw).trim());

    const lowRaw = pickFirst(row, ['lowstockthreshold', 'حد النقص', 'حد التنبيه', 'حد تنبيه']);
    const lowStockThreshold =
      mergeMode && !hasExplicitCell(lowRaw) ? undefined : toNumber(lowRaw, 10);

    return omitUndefined({
      name,
      category: categoryPath,
      price,
      stock,
      barcode,
      emoji,
      imageUrl,
      isActive,
      lowStockThreshold,
    });
  }

  /** استيراد بدون مسح: يحدّث بالباركود أو يضيف صف جديد (بدون باركود قد يتكرر لو شغّلت نفس الملف مرتين) */
  async mergeImport(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('الملف غير موجود أو فاضي');

    const stream = this.csvStreamFromUpload(file);
    const parser = csvParser({ mapHeaders: ({ header }) => String(header || '').trim() });

    const batch: Partial<Product>[] = [];
    let skipped = 0;
    let upserted = 0;
    let insertedOnly = 0;

    const flushMerge = async () => {
      if (!batch.length) return;
      for (const doc of batch) {
        const bc = String(doc.barcode || '').trim();
        if (bc) {
          // MongoDB يرفض نفس المسار في $set و $setOnInsert معًا (مثل price).
          const $set = omitUndefined(doc) as Record<string, unknown>;
          const defaults: Record<string, unknown> = {
            price: 0,
            stock: 0,
            lowStockThreshold: 10,
            emoji: '',
            imageUrl: '',
          };
          const $setOnInsert = Object.fromEntries(
            Object.entries(defaults).filter(([key]) => !(key in $set)),
          );
          await this.productModel.updateOne(
            { barcode: bc },
            { $set, $setOnInsert },
            { upsert: true },
          );
          upserted += 1;
        } else {
          await this.productModel.create({
            ...doc,
            price: doc.price ?? 0,
            stock: doc.stock ?? 0,
            lowStockThreshold: doc.lowStockThreshold ?? 10,
          });
          insertedOnly += 1;
        }
      }
      batch.length = 0;
    };

    await new Promise<void>((resolve, reject) => {
      stream
        .pipe(parser)
        .on('data', async (row: AnyRow) => {
          try {
            parser.pause();
            const doc = this.rowToProduct(row, true);
            if (!doc) {
              skipped += 1;
              parser.resume();
              return;
            }
            batch.push(doc);
            if (batch.length >= 200) await flushMerge();
            parser.resume();
          } catch (e) {
            reject(e);
          }
        })
        .on('end', async () => {
          try {
            await flushMerge();
            resolve();
          } catch (e) {
            reject(e);
          }
        })
        .on('error', (e) => reject(e));
    });

    return { inserted: upserted + insertedOnly, upserted, insertedOnly, skipped };
  }

  /** مسح كل المنتجات ثم استيراد من الملف (استخدم بحذر) */
  async resetAndImport(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('الملف غير موجود أو فاضي');

    await this.productModel.deleteMany({});

    const stream = this.csvStreamFromUpload(file);
    const parser = csvParser({ mapHeaders: ({ header }) => String(header || '').trim() });

    const batch: Partial<Product>[] = [];
    let inserted = 0;
    let skipped = 0;

    const flush = async () => {
      if (!batch.length) return;
      await this.productModel.insertMany(batch, { ordered: false });
      inserted += batch.length;
      batch.length = 0;
    };

    await new Promise<void>((resolve, reject) => {
      stream
        .pipe(parser)
        .on('data', async (row: AnyRow) => {
          try {
            parser.pause();
            const doc = this.rowToProduct(row);
            if (!doc) {
              skipped += 1;
              parser.resume();
              return;
            }
            batch.push(doc);
            if (batch.length >= 500) await flush();
            parser.resume();
          } catch (e) {
            reject(e);
          }
        })
        .on('end', async () => {
          try {
            await flush();
            resolve();
          } catch (e) {
            reject(e);
          }
        })
        .on('error', (e) => reject(e));
    });

    return { inserted, skipped };
  }

  async purgeAll() {
    const r = await this.productModel.deleteMany({});
    return { deleted: true, deletedCount: r.deletedCount ?? 0 };
  }
}

