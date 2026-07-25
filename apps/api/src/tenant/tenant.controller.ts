import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { TenantService } from './tenant.service';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: { name: string }) {
    const tenant = await this.tenants.createTenant(user.userId, body.name);
    return { id: tenant.id, name: tenant.name };
  }

  @Get()
  listMine(@CurrentUser() user: AuthUser) {
    return this.tenants.listMyTenants(user.userId);
  }
}
