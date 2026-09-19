import { Controller, Get } from '@nestjs/common';
import { PlatformsService } from './platforms.service';

@Controller()
export class PlatformsController {
  constructor(private readonly platforms: PlatformsService) {}

  @Get('platforms')
  list() {
    return this.platforms.list();
  }

  @Get('action-types')
  actionTypes() {
    return this.platforms.actionTypes();
  }
}
