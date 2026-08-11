import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadEnv } from '../config/env';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { clearRefreshCookieHeader, setRefreshCookieHeader } from './refresh-cookie';

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; name?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.register(body.email, body.password, body.name);
    setRefreshCookieHeader(res, this.env, session.refreshRaw);
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      activeTenantId: session.activeTenantId,
      user: session.user,
    };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(body.email, body.password);
    setRefreshCookieHeader(res, this.env, session.refreshRaw);
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      activeTenantId: session.activeTenantId,
      user: session.user,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[this.env.REFRESH_COOKIE_NAME] as string | undefined;
    if (!raw) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const session = await this.auth.refreshSession(raw);
    setRefreshCookieHeader(res, this.env, session.refreshRaw);
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      activeTenantId: session.activeTenantId,
      user: session.user,
    };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: { userId: string },
  ) {
    const raw = req.cookies?.[this.env.REFRESH_COOKIE_NAME] as string | undefined;
    await this.auth.logout(raw, user.userId);
    clearRefreshCookieHeader(res, this.env);
  }
}
