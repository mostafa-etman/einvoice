import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { SigningDevice } from '@prisma/client';
import { DevicesService } from './devices.service';

/** Authenticates agent calls via `Authorization: Bearer <device_token>`. Revoked/unknown → 401. */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly devices: DevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      device?: SigningDevice;
    }>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException();
    }
    const token = auth.slice(7).trim();
    if (!token) throw new UnauthorizedException();

    req.device = await this.devices.resolveByToken(token);
    return true;
  }
}
