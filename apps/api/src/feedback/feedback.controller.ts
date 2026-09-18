import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { requireSessionTenant } from '../settings/require-tenant';
import { FeedbackService } from './feedback.service';
import { TenantAdminGuard } from './tenant-admin.guard';

@Controller('feedback')
@UseGuards(JwtAuthGuard, TenantAdminGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(201)
  submit(
    @CurrentUser() user: AuthUser,
    @Body() body: { screenKey?: string; routePath?: string; note?: string },
  ) {
    return this.feedback.submit({
      tenantId: requireSessionTenant(user),
      userId: user.userId,
      screenKey: body?.screenKey,
      routePath: body?.routePath,
      note: body?.note ?? '',
    });
  }
}
