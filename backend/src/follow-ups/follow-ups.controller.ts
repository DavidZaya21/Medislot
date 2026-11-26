import { Controller, Get, Post, Inject, Param, ParseIntPipe, Body, Query, UseGuards, ValidationPipe } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { FollowUpsService } from "./follow-ups.service";
import { ContactAttemptDto, FollowUpQueryDto, FollowUpCasesQueryDto } from "./follow-ups.dto";
@Controller()
@UseGuards(AuthGuard,RolesGuard)
export class FollowUpsController {
 constructor(@Inject(FollowUpsService) private readonly service:FollowUpsService){}
 @Get("rescheduling/followUps") @Roles(Role.RECEPTIONIST,Role.MANAGER,Role.ADMIN)
 list(@Query(new ValidationPipe({expectedType:FollowUpQueryDto,transform:true,whitelist:true})) query:FollowUpQueryDto,@CurrentUser() user:AuthUser){return this.service.list(query,user)}
 @Get("rescheduling/followUps/legacyAppointments") @Roles(Role.RECEPTIONIST,Role.MANAGER,Role.ADMIN)
 legacy(@Query(new ValidationPipe({expectedType:FollowUpQueryDto,transform:true,whitelist:true})) query:FollowUpQueryDto,@CurrentUser() user:AuthUser){return this.service.legacy(query,user)}
 @Get("rescheduling/followUps/cases") @Roles(Role.RECEPTIONIST,Role.MANAGER,Role.ADMIN)
 cases(@Query(new ValidationPipe({expectedType:FollowUpCasesQueryDto,transform:true,whitelist:true})) query:FollowUpCasesQueryDto,@CurrentUser() user:AuthUser){return this.service.cases(query,user)}
 @Get("rescheduling/followUps/:notificationId/contactAttempts") @Roles(Role.RECEPTIONIST,Role.MANAGER,Role.ADMIN)
 history(@Param("notificationId",ParseIntPipe) id:number,@Query(new ValidationPipe({expectedType:FollowUpQueryDto,transform:true,whitelist:true})) query:FollowUpQueryDto,@CurrentUser() user:AuthUser){return this.service.history(id,query,user)}
 @Post("appointments/:appointmentId/contactAttempts") @Roles(Role.RECEPTIONIST,Role.MANAGER)
 record(@Param("appointmentId",ParseIntPipe) id:number,@Body(new ValidationPipe({expectedType:ContactAttemptDto,transform:true,whitelist:true,forbidNonWhitelisted:true})) body:ContactAttemptDto,@CurrentUser() user:AuthUser){return this.service.record(id,body,user)}
}
