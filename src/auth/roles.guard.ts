import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

// ── JWT Guard ──
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// ── Roles Decorator ──
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

// ── Roles Guard ──
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>('roles', context.getHandler());
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!required.includes(user.role)) {
      throw new ForbiddenException('مش عندك صلاحية للوصول لهذا المورد');
    }
    return true;
  }
}
