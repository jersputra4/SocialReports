import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { RequirePermissions, RequireStepUpMfa } from '../common/security/decorators';
import { PoliciesService } from './policies.service';

class CreatePolicyDto {
  @IsUUID() platformId!: string;
  @IsString() @MaxLength(64) code!: string;
  @IsString() @MaxLength(256) name!: string;
  @IsOptional() @IsString() @MaxLength(128) category?: string;
  @IsString() @MaxLength(32) version!: string;
  @IsString() @MinLength(10) text!: string;
  @IsOptional() @IsString() @MaxLength(512) sourceUrl?: string;
  @Type(() => Date) @IsDate() effectiveFrom!: Date;
}

class AddPolicyVersionDto {
  @IsString() @MaxLength(32) version!: string;
  @IsString() @MinLength(10) text!: string;
  @IsOptional() @IsString() @MaxLength(512) sourceUrl?: string;
  @Type(() => Date) @IsDate() effectiveFrom!: Date;
}

@Controller()
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get('platforms/:platformId/policies')
  listByPlatform(@Param('platformId') platformId: string, @Query('at') at?: string) {
    const when = at ? new Date(at) : new Date();
    return this.policies.listByPlatform(platformId, Number.isNaN(when.getTime()) ? new Date() : when);
  }

  // --------------------------------------------------------------- admin ----

  @Get('admin/policies')
  @RequirePermissions('policy.manage')
  listAll() {
    return this.policies.listAllForAdmin();
  }

  @Post('admin/policies')
  @RequirePermissions('policy.manage')
  @RequireStepUpMfa()
  create(@Body() dto: CreatePolicyDto) {
    return this.policies.createPolicy(dto);
  }

  @Post('admin/policies/:policyId/versions')
  @RequirePermissions('policy.manage')
  @RequireStepUpMfa()
  addVersion(@Param('policyId') policyId: string, @Body() dto: AddPolicyVersionDto) {
    return this.policies.addVersion({ policyId, ...dto });
  }

  @Post('admin/policies/:policyId/archive')
  @RequirePermissions('policy.manage')
  @RequireStepUpMfa()
  async archive(@Param('policyId') policyId: string) {
    await this.policies.archive(policyId);
    return { message: 'Kebijakan diarsipkan.' };
  }
}
