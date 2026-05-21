import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { DeviceLicensesModule } from '../device-licenses/device-licenses.module';

@Module({
  imports: [
    UsersModule,
    DeviceLicensesModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'hypermart_super_secret_key_2026',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
