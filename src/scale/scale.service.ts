import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Model } from 'mongoose';
import { Product, ProductDocument } from '../products/product.schema';
import * as net from 'node:net';

const execFileAsync = promisify(execFile);

/** منافذ شائعة لطابعات/ميزان شبكة — أدوات مثل Rongda غالبًا لا تفتح أيًا منها */
const DEFAULT_TCP_SCAN_PORTS = [9100, 9200, 3000, 8080, 80, 5000, 2000, 10001];

function isSafeIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host.trim());
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

/** ping ICMP من السيرفر — يثبت أن العنوان على الشبكة حتى لو الميزان بروتوكول خاص (Rongda) */
async function icmpReachable(host: string): Promise<boolean> {
  if (!isSafeIpv4(host)) return false;
  try {
    if (process.platform === 'win32') {
      await execFileAsync('ping', ['-n', '1', '-w', '2500', host], {
        timeout: 4500,
        windowsHide: true,
      });
    } else {
      await execFileAsync('ping', ['-c', '1', '-W', '2', host], { timeout: 4500 });
    }
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class ScaleService {
  constructor(@InjectModel(Product.name) private productModel: Model<ProductDocument>) {}

  private async scanTcpPorts(
    host: string,
    ports: number[],
    timeoutMs: number,
  ): Promise<{ ok: true; port: number } | { ok: false }> {
    const attempts = ports.map(
      (p) =>
        new Promise<{ ok: true; port: number } | { ok: false }>((resolve) => {
          const sock = new net.Socket();
          const finish = (v: { ok: true; port: number } | { ok: false }) => {
            try {
              sock.destroy();
            } catch {}
            resolve(v);
          };
          sock.setTimeout(timeoutMs);
          sock.once('connect', () => finish({ ok: true, port: p }));
          sock.once('timeout', () => finish({ ok: false }));
          sock.once('error', () => finish({ ok: false }));
          sock.connect(p, host);
        }),
    );
    const results = await Promise.all(attempts);
    const hit = results.find((r): r is { ok: true; port: number } => r.ok === true);
    return hit || { ok: false };
  }

  /**
   * TCP شائع + ping. ميزان Rongda على إيثيرنت غالبًا بدون منفذ TCP عام — نجاح ping = شبكة سليمة.
   */
  async ping(ip: string, port = 0, timeoutMs = 2000) {
    const host = String(ip || '').trim();
    if (!host) return { ok: false, message: 'IP مطلوب' };

    const preferred = Number(port);
    let ports: number[];
    if (Number.isFinite(preferred) && preferred > 0 && preferred <= 65535) {
      ports = [preferred, ...DEFAULT_TCP_SCAN_PORTS.filter((x) => x !== preferred)];
    } else {
      ports = [...DEFAULT_TCP_SCAN_PORTS];
    }
    ports = [...new Set(ports)];

    const [tcp, icmp] = await Promise.all([
      this.scanTcpPorts(host, ports, timeoutMs),
      icmpReachable(host),
    ]);

    if (tcp.ok) {
      return { ok: true, message: `تم الاتصال TCP (منفذ ${tcp.port})` };
    }

    if (icmp) {
      return {
        ok: true,
        message:
          'العنوان يستجيب على الشبكة (ping). لا يوجد منفذ TCP عام مفتوح — طبيعي مع ميزان Rongda وأدوات PLU التي تتصل ببروتوكول خاص. صدّر Items.xls من هنا ثم حدّث الميزان من برنامج Rongda.',
      };
    }

    return {
      ok: false,
      message:
        'لا ping ولا TCP. تأكد أن السيرفر (Nest) على نفس شبكة الميزان، والـ IP صحيح، والجدار الناري يسمح بـ ICMP وTCP الصادرين.',
    };
  }

  /** اختبار عدة موازين من السيرفر (نفس شبكة LAN) */
  async pingBatch(ips: string[]) {
    const list = [...new Set((ips || []).map((x) => String(x || '').trim()).filter((x) => isSafeIpv4(x)))];
    const results = await Promise.all(
      list.map(async (ip) => {
        const r = await this.ping(ip, 0);
        return { ip, ok: r.ok, message: r.message };
      }),
    );
    return { results };
  }

  private parsePushPorts(portsCsv?: string): number[] {
    const raw = String(
      portsCsv || process.env.SCALE_PLU_PUSH_PORTS || '9761,9200,9100,5000,3000,4001,9771',
    )
      .split(/[,;\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 65535);
    return [...new Set(raw.length ? raw : [9761, 9200, 9100])];
  }

  /** بعد connect: انتظار قصير (ms) قبل إرسال البايتات — جرّب 100–400 لو الجهاز بطيء */
  private getPushStabilizeMs(): number {
    const n = parseInt(String(process.env.SCALE_PLU_PUSH_STABILIZE_MS || '0').trim(), 10);
    if (!Number.isFinite(n) || n < 0 || n > 15000) return 0;
    return Math.floor(n);
  }

  /** إرسال بايتات ملف PLU (مثل Items.xls) خام على TCP — تجريبي؛ بعض الموازن تقبل دفعة خام */
  private trySendBufferTcp(host: string, port: number, data: Buffer, timeoutMs = 12000): Promise<boolean> {
    const stabilizeMs = this.getPushStabilizeMs();
    const totalTimeout = timeoutMs + stabilizeMs;
    return new Promise((resolve) => {
      const sock = new net.Socket();
      const finish = (ok: boolean) => {
        try {
          sock.destroy();
        } catch {}
        resolve(ok);
      };
      sock.setTimeout(totalTimeout);
      sock.once('connect', () => {
        const send = () => {
          try {
            sock.end(data, () => finish(true));
          } catch {
            finish(false);
          }
        };
        if (stabilizeMs > 0) setTimeout(send, stabilizeMs);
        else send();
      });
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      sock.connect(port, host);
    });
  }

  async pushPluBufferToManyHosts(
    ips: string[],
    data: Buffer,
    portsCsv?: string,
  ): Promise<{ results: { ip: string; ok: boolean; message: string; port?: number }[] }> {
    const uniq = [...new Set((ips || []).map((x) => String(x || '').trim()).filter((x) => isSafeIpv4(x)))];
    const ports = this.parsePushPorts(portsCsv);
    const results: { ip: string; ok: boolean; message: string; port?: number }[] = [];
    for (const ip of uniq) {
      let ok = false;
      let usedPort: number | undefined;
      let msg = '';
      for (const port of ports) {
        // eslint-disable-next-line no-await-in-loop
        const sent = await this.trySendBufferTcp(ip, port, data);
        if (sent) {
          ok = true;
          usedPort = port;
          msg = `تم إرسال ${data.length} بايت (منفذ ${port})`;
          break;
        }
      }
      if (!ok) {
        msg = `لم يُكمل إرسال TCP على المنافذ: ${ports.join(', ')} — قد يحتاج الميزان بروتوكول مختلف (راجع دليل الشركة أو عيّن SCALE_PLU_PUSH_PORTS)`;
      }
      results.push({ ip, ok, message: msg, port: usedPort });
    }
    return { results };
  }

  async getProductByPlu(plu: string) {
    const clean = String(plu || '').replace(/\D/g, '').trim();
    if (!clean) return null;
    const trimmed = clean.replace(/^0+/, '') || '0';
    const numeric = String(parseInt(clean, 10));
    const pluCandidates = [...new Set([clean, trimmed, numeric])].filter(Boolean);
    const p = await this.productModel.findOne({
      isActive: true,
      $or: [{ barcode: clean }, ...pluCandidates.map((c) => ({ scalePlu: c }))],
    });
    if (!p) return null;
    return {
      _id: String((p as any)._id || ''),
      name: p.name,
      category: p.category,
      price: p.price,
      soldByWeight: Boolean((p as any).soldByWeight),
      scalePlu: String((p as any).scalePlu || ''),
      barcode: String((p as any).barcode || ''),
    };
  }
}
