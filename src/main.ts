import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Validation على كل الـ DTOs تلقائياً
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // CORS عشان الـ Electron frontend يقدر يكلم الـ API
  app.enableCors({ origin: '*' });

  // Prefix لكل الـ routes
  app.setGlobalPrefix('api');

  // Serve uploaded files
  const uploadsRoot = join(process.cwd(), 'uploads', 'products');
  if (!existsSync(uploadsRoot)) mkdirSync(uploadsRoot, { recursive: true });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 HyperMart API running on: http://localhost:${port}/api`);
}
bootstrap();
