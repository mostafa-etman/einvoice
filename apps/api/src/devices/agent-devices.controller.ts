import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { SigningDevice } from '@prisma/client';
import { CurrentDevice } from './current-device.decorator';
import { DeviceTokenGuard } from './device-token.guard';
import { DevicesService } from './devices.service';

@Controller('agent')
export class AgentDevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Unauthenticated: the pairing code itself is the one-time credential. */
  @Post('pair')
  pair(
    @Body() body: { pairingCode: string; label: string; machineFingerprint?: string },
  ) {
    return this.devices.pairAgent(body);
  }

  @Post('heartbeat')
  @HttpCode(200)
  @UseGuards(DeviceTokenGuard)
  heartbeat(
    @CurrentDevice() device: SigningDevice,
    @Body() body: { ready?: Record<string, unknown> },
  ) {
    return this.devices.heartbeat(device, body?.ready);
  }
}
