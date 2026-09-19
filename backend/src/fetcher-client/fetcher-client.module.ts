import { Global, Module } from '@nestjs/common';
import { FetcherClient } from './fetcher.client';

@Global()
@Module({
  providers: [FetcherClient],
  exports: [FetcherClient],
})
export class FetcherClientModule {}
