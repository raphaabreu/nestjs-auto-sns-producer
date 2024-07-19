import * as AWS from 'aws-sdk';
import { OnModuleInit, OnModuleDestroy, Provider, Inject } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { MessageBatcher } from '@raphaabreu/message-batcher';
import { PromiseCollector } from '@raphaabreu/promise-collector';
import { StructuredLogger } from '@raphaabreu/nestjs-opensearch-structured-logger';
import { SNSProducer, SNSProducerOptions } from './sns-producer';

export type AutoSNSProducerOptions<T = unknown> = {
  name?: string;
  eventName: string;
  maxBatchIntervalMs?: number;
} & Omit<SNSProducerOptions<T>, 'name'>;

const defaultOptions: Partial<AutoSNSProducerOptions> = {
  maxBatchIntervalMs: 10000,
  maxBatchSize: 10,
};

export class AutoSNSProducer<T> implements OnModuleInit, OnModuleDestroy {
  private readonly logger: StructuredLogger;
  private readonly batcher: MessageBatcher<T>;
  private readonly promiseCollector = new PromiseCollector();
  private readonly options: AutoSNSProducerOptions<T>;
  private readonly snsProducer: SNSProducer<T>;

  public static register<T>(options: AutoSNSProducerOptions<T>): Provider {
    return {
      provide: AutoSNSProducer.getServiceName(options.name || options.eventName),
      useFactory: (
        awsSns: AWS.SNS,
        awsSnsFactory: (options: { region: string }) => AWS.SNS,
        eventEmitter: EventEmitter2,
      ) => {
        const final = awsSnsFactory || awsSns;

        if (!final) {
          throw new Error('Either AWS.SNS or SNS_FACTORY must be provided');
        }

        return new AutoSNSProducer(final, eventEmitter, options);
      },
      inject: [{ token: AWS.SNS, optional: true }, { token: SNSProducer.SNS_FACTORY, optional: true }, EventEmitter2],
    };
  }

  public static getServiceName(name: string): string {
    return `${AutoSNSProducer.name}:${name}`;
  }

  constructor(
    instanceOrFactory: AWS.SNS | ((options: { region: string }) => AWS.SNS),
    eventEmitter: EventEmitter2,
    options: AutoSNSProducerOptions<T>,
  ) {
    this.options = { ...defaultOptions, ...options };

    this.logger = new StructuredLogger(AutoSNSProducer.getServiceName(options.name || options.eventName));

    this.batcher = new MessageBatcher(
      this.options.maxBatchSize,
      this.promiseCollector.wrap((b) => this.publishIgnoringErrors(b)),
    );

    this.snsProducer = new SNSProducer(instanceOrFactory, {
      ...options,
      name: options.name || options.eventName,
    });

    eventEmitter.on(this.options.eventName, (e) => this.add(e));
  }

  add(event: T) {
    this.batcher.add(event);
  }

  private async publishIgnoringErrors(messages: T[]) {
    try {
      await this.snsProducer.publishBatch(messages);
    } catch (error) {
      // Do nothing
    }
  }

  onModuleInit() {
    this.logger.log(
      'Starting message batcher with batchSize = ${batchSize} and maxBatchIntervalMs = ${maxBatchIntervalMs}ms...',
      this.options.maxBatchSize,
      this.options.maxBatchIntervalMs,
    );

    this.batcher.start(this.options.maxBatchIntervalMs);
  }

  async onModuleDestroy() {
    this.logger.log('Stopping message batcher...');

    this.batcher.stop();
    await this.flush();
  }

  @OnEvent('flush')
  async flush() {
    this.batcher.flush();
    await this.promiseCollector.pending();
  }
}
