import * as AWS from 'aws-sdk';
import { OnModuleInit, OnModuleDestroy, Provider } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { MessageBatcher } from '@raphaabreu/message-batcher';
import { PromiseCollector } from '@raphaabreu/promise-collector';
import { StructuredLogger } from '@raphaabreu/nestjs-opensearch-structured-logger';

export type AutoSNSProducerOptions<T = unknown> = {
  serviceName?: string;
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
      provide: options.serviceName || AutoSNSProducer.getDefaultServiceName(options.eventName),
      useFactory: (awsSns: AWS.SNS, eventEmitter: EventEmitter2) => new AutoSNSProducer(awsSns, eventEmitter, options),
      inject: [AWS.SNS, EventEmitter2],
    };
  }

  public static getDefaultServiceName(eventName: string): string {
    return `${AutoSNSProducer.name}:${eventName}`;
  }

  constructor(private readonly awsSns: AWS.SNS, eventEmitter: EventEmitter2, options: AutoSNSProducerOptions<T>) {
    this.options = {
      ...defaultOptions,
      ...options,
      serviceName: options.serviceName || AutoSNSProducer.getDefaultServiceName(options.eventName),
    };

    this.logger = new StructuredLogger(this.options.serviceName);

    this.batcher = new MessageBatcher(
      this.options.batchSize,
      this.promiseCollector.wrap((b) => this.doPublishBatch(b, false)),
    );

    eventEmitter.on(this.options.eventName, (e) => this.add(e));
  }

  add(event: T) {
    this.batcher.add(event);
  }

  async publishBatch(messages: T | T[]) {
    const promises = MessageBatcher.batch(messages, this.options.batchSize).map((b) => this.doPublishBatch(b, true));

    await Promise.all(promises);
  }

  private async doPublishBatch(messages: T[], throws: boolean) {
    const params = {
      TopicArn: this.options.topicArn,
      PublishBatchRequestEntries: this.prepareBatch(messages),
    };

    this.logger.debug(
      'Publishing ${messageCount} messages to SNS topic ${topicArn}...',
      messages.length,
      this.options.topicArn,
    );

    try {
      const results = await this.awsSns.publishBatch(params).promise();

      const verboseLog = this.verboseLoggingEnabled();

      this.logger
        .createScope({
          messages: !this.options.verboseBeginning
            ? '-'
            : verboseLog
            ? JSON.stringify(params.PublishBatchRequestEntries)
            : `messages are only logged for the first ${MAX_VERBOSE_LOG_COUNT} batches`,
        })
        [results.Failed.length > 0 ? 'warn' : verboseLog ? 'log' : 'debug'](
          'Published ${messageCount} messages to SNS topic ${topicArn}: ${successCount} succeeded, ${failCount} failed.',
          params.PublishBatchRequestEntries.length,
          this.options.topicArn,
          results.Successful.length,
          results.Failed.length,
        );

      this.countVerboseLogging();
    } catch (error) {
      this.logger.error(
        'Failed to publish ${messageCount} messages to SNS topic ${topicArn}',
        error,
        params.PublishBatchRequestEntries.length,
        this.options.topicArn,
      );

      if (throws) {
        throw error;
      }
    }
  }

  onModuleInit() {
    this.logger.log(
      'Starting message batcher with batchSize = ${batchSize} and maxBatchIntervalMs = ${maxBatchIntervalMs}ms...',
      this.options.batchSize,
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

    this.logger[this.verboseLoggingEnabled() ? 'log' : 'debug']('Flushed');
    this.countVerboseLogging();
  }

  private prepareBatch(events: T[]): AWS.SNS.PublishBatchRequestEntryList {
    if (this.options.prepareEntry) {
      return events.map(this.options.prepareEntry);
    }

    return events.map((event, index) => ({
      Id: index.toString(),
      Message: this.options.serializer(event),
    }));
  }

  private verboseLoggingEnabled() {
    return this.options.verboseBeginning && this.verboseLogCount < MAX_VERBOSE_LOG_COUNT;
  }

  private countVerboseLogging() {
    if (this.verboseLoggingEnabled()) {
      this.verboseLogCount++;
      if (this.verboseLogCount === MAX_VERBOSE_LOG_COUNT) {
        this.logger.log('Success messages will be logged as debug from now on');
      }
    }
  }
}
