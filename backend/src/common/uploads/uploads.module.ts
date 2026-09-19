import { Global, Module } from '@nestjs/common';
import { MalwareScanner } from './malware-scanner';
import { UploadPipelineService } from './upload-pipeline.service';

@Global()
@Module({
  providers: [MalwareScanner, UploadPipelineService],
  exports: [MalwareScanner, UploadPipelineService],
})
export class UploadsModule {}
