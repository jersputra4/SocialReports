import { Module } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { RedisService } from '../common/redis/redis.service';
import { ReportsModule } from '../reports/reports.module';
import { CheckoutService } from './checkout.service';
import { MockGatewayController } from './gateway/mock-gateway.controller';
import { MockPaymentGateway } from './gateway/mock.gateway';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.interface';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentWebhooksController } from './webhooks.controller';

@Module({
  imports: [ReportsModule],
  controllers: [PaymentsController, PaymentWebhooksController, MockGatewayController],
  providers: [
    PaymentsService,
    CheckoutService,
    MockPaymentGateway,
    {
      provide: PAYMENT_GATEWAY,
      // Pemilihan implementasi terjadi di satu tempat ini saja.
      // Menambah gateway berlisensi berarti menambah satu cabang di sini.
      useFactory: (config: AppConfig, redis: RedisService) => {
        switch (config.payment.driver) {
          case 'mock':
            return new MockPaymentGateway(config, redis);
          default:
            throw new Error(
              `PAYMENT_DRIVER "${config.payment.driver}" belum diimplementasikan. ` +
                'Tambahkan kelas gateway yang memenuhi antarmuka PaymentGateway.',
            );
        }
      },
      inject: [CONFIG_TOKEN, RedisService],
    },
  ],
  exports: [PaymentsService, CheckoutService],
})
export class PaymentsModule {}
