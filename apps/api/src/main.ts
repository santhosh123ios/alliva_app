import './load-env';
import { createApp } from './app';
import { Logger } from './common/logger';

async function bootstrap() {
  const { server, container } = createApp();
  await container.prisma.$connect();
  const port = Number(process.env.API_PORT ?? 4000);
  server.listen(port, () => new Logger('AllivaApi').log(`Listening on http://localhost:${port}/api (docs at /api/docs)`));
}

void bootstrap();
