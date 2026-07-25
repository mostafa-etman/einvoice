import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { RefreshService } from './refresh.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          secret: env.JWT_ACCESS_SECRET,
          signOptions: { expiresIn: env.JWT_ACCESS_TTL as `${number}m` },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RefreshService, JwtStrategy],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
