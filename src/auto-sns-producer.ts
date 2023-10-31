import * as AWS from 'aws-sdk';
import { OnModuleInit, OnModuleDestroy, Provider } from '@nestjs/common';
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
};

export class AutoSNSProducer<T> implements OnModuleInit, OnModuleDestroy {
  private readonly logger: StructuredLogger;
  private readonly batcher: MessageBatcher<T>;
  private readonly promiseCollector = new PromiseCollector();
  private readonly options: AutoSNSProducerOptions<T>;
  private readonly snsProducer: SNSProducer<T>;

  public static register<T>(options: AutoSNSProducerOptions<T>): Provider {
    return {
      provide: AutoSNSProducer.getServiceName(options.eventName, options.name),
      useFactory: (awsSns: AWS.SNS, eventEmitter: EventEmitter2) => new AutoSNSProducer(awsSns, eventEmitter, options),
      inject: [AWS.SNS, EventEmitter2],
    };
  }

  public static getServiceName(eventName: string, name?: string): string {
    return `${AutoSNSProducer.name}:${eventName}${name ? ':' + name : ''}`;
  }

  constructor(awsSns: AWS.SNS, eventEmitter: EventEmitter2, options: AutoSNSProducerOptions<T>) {
    this.options = { ...defaultOptions, ...options };

    this.logger = new StructuredLogger(AutoSNSProducer.getServiceName(options.eventName, options.name));

    this.batcher = new MessageBatcher(
      SNSProducer.BATCH_SIZE,
      this.promiseCollector.wrap((b) => this.publishIgnoringErrors(b)),
    );

    this.snsProducer = new SNSProducer(awsSns, { ...options, name: options.eventName });

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
      SNSProducer.BATCH_SIZE,
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
