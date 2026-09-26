import { Inject } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { loadActor } from '../common/http';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class OrdersGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token);
      const user = await loadActor(this.prisma, payload.sub, payload.sid);
      client.data.user = user;
      if (user.merchantId) client.join(`merchant:${user.merchantId}`);
      if (user.customerId) client.join(`customer:${user.customerId}`);
      if (user.permissions.includes('dispatch.manage') || user.roles.includes('SUPER_ADMIN')) client.join('ops');
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join')
  join(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId?: string }) {
    if (body.orderId) client.join(`order:${body.orderId}`);
    return { ok: true };
  }

  emit(order: { id: string; merchantId: string; customerId?: string }) {
    this.server?.to(`order:${order.id}`).emit('order.updated', order);
    this.server?.to(`merchant:${order.merchantId}`).emit('order.updated', order);
    this.server?.to('ops').emit('order.updated', order);
  }
}
