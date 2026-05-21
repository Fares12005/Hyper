import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesGuard, Roles, JwtAuthGuard } from '../auth/roles.guard';
import { UserRole } from './user.schema';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() { return this.usersService.findAll(); }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() body: any, @Request() req) {
    return this.usersService.create(body, req.user?.role);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.usersService.update(id, body, req.user?.role);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string, @Request() req) {
    return this.usersService.remove(id, req?.user?.userId, req.user?.role);
  }
}
