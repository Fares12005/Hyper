import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ScaleService } from './scale.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';

@Controller('scale')
export class ScaleController {
  constructor(private scale: ScaleService) {}

  private checkKey(h: Record<string, any>) {
    const required = String(process.env.SCALE_API_KEY || '').trim();
    if (!required) return true;
    const got = String(h?.['x-scale-key'] || h?.['X-Scale-Key'] || '').trim();
    return got && got === required;
  }

  @Post('ping')
  ping(@Body() body: any) {
    const ip = String(body?.ip || '').trim();
    const port = Number(body?.port || 0);
    return this.scale.ping(ip, port);
  }

  @Post('ping-batch')
  pingBatch(@Body() body: { ips?: string[] }) {
    const ips = Array.isArray(body?.ips) ? body.ips : [];
    return this.scale.pingBatch(ips);
  }

  /**
   * رفع ملف PLU (Items.xls) من البرنامج مباشرة إلى كل IP عبر TCP خام (تجريبي).
   * يتطلب JWT + صلاحية admin أو stock.
   */
  @Post('push-plu-xls')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STOCK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async pushPluXls(
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Body('ips') ipsJson: string,
    @Body('ports') portsCsv?: string,
  ) {
    const buf = file?.buffer;
    if (!buf || buf.length < 32) {
      return { ok: false, message: 'ملف PLU غير صالح أو فارغ' };
    }
    const raw = String(ipsJson || '').trim();
    let ips: string[] = [];
    try {
      const p = JSON.parse(raw);
      ips = Array.isArray(p) ? p : [];
    } catch {
      ips = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    }
    return this.scale.pushPluBufferToManyHosts(ips, buf, portsCsv);
  }

  // ميزان/شبكة: هات بيانات صنف بالـ PLU علشان الميزان يطبع ليبل من الداتا بتاعتنا
  // GET /api/scale/product/12345?key=...
  @Get('product/:plu')
  async getProduct(
    @Param('plu') plu: string,
    @Query('key') key: string,
    @Headers() headers: Record<string, any>,
  ) {
    // دعم key في query للميزان اللي مابيعرفش headers
    const required = String(process.env.SCALE_API_KEY || '').trim();
    const ok = required ? (String(key || '').trim() === required || this.checkKey(headers)) : true;
    if (!ok) return { ok: false, message: 'Unauthorized' };

    const p = await this.scale.getProductByPlu(plu);
    if (!p) return { ok: false, message: 'Not found' };
    return { ok: true, product: p };
  }
}
