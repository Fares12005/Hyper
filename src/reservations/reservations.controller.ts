import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user.schema';
import { ReservationsService } from './reservations.service';
import { ReservationPayMethod, ReservationStatus } from './reservation.schema';

@Controller('reservations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CASHIER, UserRole.ADMIN)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  create(
    @Body()
    body: {
      referenceNumber: string;
      description: string;
      totalDue: number;
      firstPayment: number;
      paymentMethod: ReservationPayMethod;
      paymentNotes?: string;
      expectedCompletionDate?: string;
      customerName?: string;
      customerPhone?: string;
      notes?: string;
    },
    @Request() req,
  ) {
    return this.reservationsService.create({
      ...body,
      userId: req.user.userId,
    });
  }

  @Get()
  list(@Query('status') status: string, @Query('limit') limit: string) {
    let st: ReservationStatus | undefined;
    if (status && (Object.values(ReservationStatus) as string[]).includes(status)) {
      st = status as ReservationStatus;
    }
    return this.reservationsService.list(st, +limit || 100);
  }

  @Get('lookup')
  lookup(@Query('ref') ref: string) {
    return this.reservationsService.lookupByReference(ref || '');
  }

  @Patch(':id/payment')
  addPayment(
    @Param('id') id: string,
    @Request() req,
    @Body()
    body: {
      amount: number;
      paymentMethod: ReservationPayMethod;
      notes?: string;
    },
  ) {
    return this.reservationsService.addPayment(id, body, req.user.userId);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.reservationsService.cancel(id);
  }
}
