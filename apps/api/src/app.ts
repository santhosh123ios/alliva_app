import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Request } from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { join } from 'path';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from './common/audit';
import { notFound } from './common/errors';
import { createContainer } from './container';
import { buildOpenApi } from './docs';
import { authRoutes } from './routes/auth';
import { portalRoutes } from './routes/portal';
import { storefrontRoutes } from './routes/storefront';

const keepRawBody = (request: Request & { rawBody?: Buffer }, _response: unknown, buffer: Buffer) => {
  request.rawBody = buffer;
};

export function createApp() {
  const container = createContainer();
  const app = express();
  app.use(cors({ origin: (process.env.WEB_ORIGINS ?? 'http://localhost:3000').split(','), credentials: true }));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(express.json({ verify: keepRawBody }));
  app.use(express.urlencoded({ extended: true, verify: keepRawBody }));
  app.use('/uploads', express.static(join(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads')));

  const groups = [authRoutes(container), storefrontRoutes(container), portalRoutes(container)];
  for (const group of groups) app.use('/api', group.router);

  const document = buildOpenApi(groups.flatMap((group) => group.routes));
  app.get('/api/docs-json', (_request, response) => {
    response.json(document);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(document));

  app.use((request, _response, next) => next(notFound(`Cannot ${request.method} ${request.path}`)));
  app.use(errorHandler);

  const server = createServer(app);
  container.gateway.attach(server);

  return {
    app,
    server,
    container,
    async close() {
      await container.gateway.close();
      await container.prisma.$disconnect();
    },
  };
}
