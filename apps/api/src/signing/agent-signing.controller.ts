import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { SigningDevice } from '@prisma/client';
import { CurrentDevice } from '../devices/current-device.decorator';
import { DeviceTokenGuard } from '../devices/device-token.guard';
import { SigningService } from './signing.service';

@Controller('agent/jobs')
@UseGuards(DeviceTokenGuard)
export class AgentSigningController {
  constructor(private readonly signing: SigningService) {}

  @Post('claim')
  @HttpCode(200)
  claim(@CurrentDevice() device: SigningDevice, @Body() body: { max?: number }) {
    return this.signing.claim(device, body?.max ?? 1);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(
    @CurrentDevice() device: SigningDevice,
    @Param('id') id: string,
    @Body()
    body: {
      documentId: string;
      documentVersion: number;
      signatureType: string;
      cadesBase64: string;
      certificateThumbprint?: string;
    },
  ) {
    return this.signing.submit(device, id, body);
  }

  @Post(':id/fail')
  @HttpCode(200)
  fail(
    @CurrentDevice() device: SigningDevice,
    @Param('id') id: string,
    @Body() body: { code: string; message?: string },
  ) {
    return this.signing.fail(device, id, body);
  }
}
