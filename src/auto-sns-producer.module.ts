import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import { SNS } from 'aws-sdk';
import { AutoSNSProducerService, AutoSNSProducerServiceOptions } from './auto-sns-producer.service';
import * as AWSXRay from 'aws-xray-sdk';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<AutoSNSProducerServiceOptions>().build();

@Module({
  imports: [EventEmitterModule],
  providers: [
    {
      provide: SNS,
      useFactory: () => AWSXRay.captureAWSClient(new SNS()),
    },
    {
      provide: AutoSNSProducerService,
      useFactory: (sns: SNS, eventEmitter: EventEmitter2, options: AutoSNSProducerServiceOptions) =>
        new AutoSNSProducerService(sns, eventEmitter, options),
      inject: [SNS, EventEmitter2, MODULE_OPTIONS_TOKEN],
    },
  ],
  exports: [],
})
export class AutoSNSProducerModule extends ConfigurableModuleClass {}
