import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { DeviceLicensesService } from '../device-licenses/device-licenses.service';
import { UserRole } from '../users/user.schema';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private deviceLicenses: DeviceLicensesService,
  ) {}

  async register(data: { username: string; password: string; name: string }) {
    const user: any = await this.usersService.registerCustomer(data);

    const payload = { sub: user._id, username: user.username, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user._id, name: user.name, username: user.username, role: user.role },
    };
  }

  async login(username: string, password: string, deviceId?: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user) throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غلط');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غلط');

    await this.deviceLicenses.assertDeviceLicensed(deviceId, user.role as UserRole);

    const payload = { sub: user._id, username: user.username, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        role: user.role,
      },
    };
  }
}
