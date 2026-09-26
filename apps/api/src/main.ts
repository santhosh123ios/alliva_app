import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'path';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use('/uploads', express.static(join(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads')));
  app.enableCors({
    origin: (process.env.WEB_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  const config = new DocumentBuilder()
    .setTitle('Alliva API')
    .setDescription('Bahrain multi-merchant delivery platform')
    .setVersion('1.0')
    .addCookieAuth('alliva_access')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.API_PORT ?? 4000));
}

void bootstrap();
