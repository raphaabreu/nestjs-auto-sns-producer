import * as AWS from 'aws-sdk';
import { OnModuleInit, OnModuleDestroy, Provider } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { MessageBatcher } from '@raphaabreu/message-batcher';
import { PromiseCollector } from '@raphaabreu/promise-collector';
import { StructuredLogger } from '@raphaabreu/nestjs-opensearch-structured-logger';

export type AutoSNSProducerOptions<T = unknown> = {
  topicArn: string;
  eventName: string;
  batchSize?: number;
  maxBatchIntervalMs?: number;
  serializer?: (event: T) => string;
  prepareEntry?: (event: T, index: number) => AWS.SNS.PublishBatchRequestEntry;
  verboseBeginning?: boolean;
};

const defaultOptions: Partial<AutoSNSProducerOptions> = {
  batchSize: 10,
  maxBatchIntervalMs: 10000,
  serializer: JSON.stringify,
  verboseBeginning: true,
};

const MAX_VERBOSE_LOG_COUNT = 10;

export class AutoSNSProducer<T> implements OnModuleInit, OnModuleDestroy {
  private readonly logger: StructuredLogger;
  private readonly batcher: MessageBatcher<T>;
  private readonly promiseCollector = new PromiseCollector();
  private readonly options: AutoSNSProducerOptions<T>;

  private verboseLogCount = 0;

  public static register<T>(options: AutoSNSProducerOptions<T>): Provider {
    return {
      provide: AutoSNSProducer.getServiceName(options.eventName),
      useFactory: (awsSns: AWS.SNS, eventEmitter: EventEmitter2) => new AutoSNSProducer(awsSns, eventEmitter, options),
      inject: [AWS.SNS, EventEmitter2],
    };
  }

  public static getServiceName(eventName: string): string {
    return `${AutoSNSProducer.name}:${eventName}`;
  }

  constructor(private readonly awsSns: AWS.SNS, eventEmitter: EventEmitter2, options: AutoSNSProducerOptions<T>) {
    this.options = { ...defaultOptions, ...options };

    this.logger = new StructuredLogger(AutoSNSProducer.getServiceName(this.options.eventName));

    this.batcher = new MessageBatcher(
      this.options.batchSize,
      this.promiseCollector.wrap((b) => this.publishBatch(b)),
    );

    eventEmitter.on(this.options.eventName, (e) => this.onEvent(e));
  }

  onEvent(event: T) {
    this.batcher.add(event);
  }

  prepareBatch(events: T[]): AWS.SNS.PublishBatchRequestEntryList {
    if (this.options.prepareEntry) {
      return events.map(this.options.prepareEntry);
    }

    return events.map((event, index) => ({
      Id: index.toString(),
      Message: this.options.serializer(event),
    }));
  }

  async publishBatch(events: T[]) {
    const params = {
      TopicArn: this.options.topicArn,
      PublishBatchRequestEntries: this.prepareBatch(events),
    };

    this.logger.debug(
      'Publishing ${messageCount} messages to SNS topic ${topicArn}...',
      this.options.topicArn,
      events.length,
    );

    try {
      const results = await this.awsSns.publishBatch(params).promise();

      const verboseLog = this.options.verboseBeginning && this.verboseLogCount < MAX_VERBOSE_LOG_COUNT;

      this.logger[results.Failed.length > 0 ? 'warn' : verboseLog ? 'log' : 'debug'](
        'Published ${batchMessages} messages to SNS topic ${topicArn}: ${successCount} succeeded, ${failCount} failed.',
        verboseLog ? JSON.stringify(params.PublishBatchRequestEntries) : '{omitted}',
        this.options.topicArn,
        results.Successful.length,
        results.Failed.length,
      );

      if (verboseLog) {
        this.verboseLogCount++;
        if (this.verboseLogCount === MAX_VERBOSE_LOG_COUNT) {
          this.logger.log('Success messages will be logged as debug from now on');
        }
      }
    } catch (error) {
      this.logger.error('Failed to publish messages to SNS topic ${topicArn}', error, this.options.topicArn);
    }
  }

  onModuleInit() {
    this.logger.log(
      'Starting message batcher with interval ${maxBatchIntervalMs}ms...',
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
    const verboseLog = this.options.verboseBeginning && this.verboseLogCount < MAX_VERBOSE_LOG_COUNT;

    this.batcher.flush();
    await this.promiseCollector.pending();

    this.logger[verboseLog ? 'log' : 'debug']('Flushed');
  }
}
