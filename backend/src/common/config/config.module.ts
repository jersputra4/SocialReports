import { Global, Module } from '@nestjs/common';
import { CONFIG_TOKEN, loadConfiguration } from './configuration';

@Global()
@Module({
  providers: [
    {
      provide: CONFIG_TOKEN,
      useFactory: loadConfiguration,
    },
  ],
  exports: [CONFIG_TOKEN],
})
export class AppConfigModule {}
