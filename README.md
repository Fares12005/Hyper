# HyperMart Backend API 🛒

## تشغيل المشروع

```bash
npm install
npm run start:dev
```

> تأكد إن MongoDB شغال على جهازك أو استخدم MongoDB Atlas

---

## كل الـ API Endpoints

### 🔐 Auth
| Method | Endpoint         | الوصف          |
|--------|------------------|----------------|
| POST   | /api/auth/login  | تسجيل الدخول   |

**Request:**
```json
{ "username": "cashier", "password": "1234" }
```
**Response:**
```json
{ "access_token": "eyJ...", "user": { "name": "أحمد", "role": "cashier" } }
```

---

### 🛍️ Products
> كل الـ endpoints محتاجة `Authorization: Bearer <token>`

| Method | Endpoint                      | الوصف                    | الصلاحية      |
|--------|-------------------------------|--------------------------|---------------|
| GET    | /api/products                 | كل المنتجات              | الكل          |
| GET    | /api/products?category=فواكه  | فلتر بالكاتيجوري         | الكل          |
| GET    | /api/products?search=تفاح     | بحث بالاسم               | الكل          |
| GET    | /api/products/low-stock       | المنتجات اللي كميتها منخفضة | الكل       |
| GET    | /api/products/barcode/:code   | بحث بالباركود            | الكل          |
| GET    | /api/products/:id             | منتج واحد                | الكل          |
| POST   | /api/products                 | إضافة منتج جديد          | admin + stock |
| PATCH  | /api/products/:id             | تعديل منتج               | admin + stock |
| DELETE | /api/products/:id             | حذف منتج (soft delete)   | admin         |

---

### 🧾 Orders
| Method | Endpoint                    | الوصف                  | الصلاحية       |
|--------|-----------------------------|------------------------|----------------|
| POST   | /api/orders                 | إنشاء أوردر جديد       | الكل           |
| GET    | /api/orders                 | كل الأوردرات           | الكل           |
| GET    | /api/orders?status=completed| فلتر بالحالة           | الكل           |
| GET    | /api/orders/report          | تقرير المبيعات         | admin          |
| GET    | /api/orders/top-products    | أكثر المنتجات مبيعاً   | admin          |
| GET    | /api/orders/:id             | أوردر واحد             | الكل           |
| PATCH  | /api/orders/:id/cancel      | إلغاء أوردر            | admin + cashier|

**Create Order Request:**
```json
{
  "items": [
    { "productId": "664abc...", "qty": 2 },
    { "productId": "664def...", "qty": 1 }
  ],
  "paymentMethod": "cash",
  "notes": "ملاحظة اختيارية"
}
```

---

### 📦 Stock Permissions
| Method | Endpoint                              | الوصف           | الصلاحية      |
|--------|---------------------------------------|-----------------|---------------|
| GET    | /api/stock/permissions                | كل الأذونات     | الكل          |
| GET    | /api/stock/permissions?type=return    | فلتر بالنوع     | الكل          |
| GET    | /api/stock/permissions?status=pending | فلتر بالحالة    | الكل          |
| POST   | /api/stock/permissions                | إذن جديد        | stock + admin |
| PATCH  | /api/stock/permissions/:id/approve    | اعتماد إذن      | admin         |
| PATCH  | /api/stock/permissions/:id/reject     | رفض إذن         | admin         |

**Create Permission Request:**
```json
{
  "type": "return",
  "productId": "664abc...",
  "qty": 5,
  "notes": "مرتجع من العميل"
}
```
> الأنواع: `return` | `transfer` | `receive` | `damage`

---

### 👥 Users
| Method | Endpoint       | الوصف              | الصلاحية |
|--------|----------------|--------------------|----------|
| GET    | /api/users     | كل المستخدمين      | admin    |
| POST   | /api/users     | إضافة مستخدم       | admin    |
| PATCH  | /api/users/:id | تعديل مستخدم       | admin    |

---

## بيانات الدخول الافتراضية
| Username | Password | Role    |
|----------|----------|---------|
| admin    | 1234     | admin   |
| cashier  | 1234     | cashier |
| stock    | 1234     | stock   |

---

## ربط الـ Frontend بالـ API

في ملف `src/data/products.js` في الـ Electron app:

```js
const API = 'http://localhost:3000/api';
const token = localStorage.getItem('token');

// مثال: جلب المنتجات
const res = await fetch(`${API}/products`, {
  headers: { Authorization: `Bearer ${token}` }
});
const products = await res.json();
```
