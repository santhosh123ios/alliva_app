import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { loadActor } from '../common/http';
import type { JwtService } from '../common/jwt';
import type { PrismaService } from '../prisma/prisma.service';

export class OrdersGateway {
  server?: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  attach(httpServer: HttpServer) {
    this.server = new Server(httpServer, { cors: { origin: true, credentials: true } });
    this.server.on('connection', (client) => {
      client.on('join', (body: { orderId?: string } | undefined, ack?: (reply: { ok: true }) => void) => {
        if (body?.orderId) void client.join(`order:${body.orderId}`);
        if (typeof ack === 'function') ack({ ok: true });
      });
      void this.handleConnection(client);
    });
  }

  close() {
    return new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      void this.server.close(() => resolve());
    });
  }

  private async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token);
      const user = await loadActor(this.prisma, payload.sub, payload.sid);
      client.data.user = user;
      if (user.merchantId) void client.join(`merchant:${user.merchantId}`);
      if (user.customerId) void client.join(`customer:${user.customerId}`);
      if (user.permissions.includes('dispatch.manage') || user.roles.includes('SUPER_ADMIN')) void client.join('ops');
    } catch {
      client.disconnect();
    }
  }

  emit(order: { id: string; merchantId: string; customerId?: string }) {
    this.server?.to(`order:${order.id}`).emit('order.updated', order);
    this.server?.to(`merchant:${order.merchantId}`).emit('order.updated', order);
    this.server?.to('ops').emit('order.updated', order);
  }
}
