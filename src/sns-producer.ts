import * as AWS from 'aws-sdk';
import { Provider } from '@nestjs/common';
import { MessageBatcher } from '@raphaabreu/message-batcher';
import { StructuredLogger } from '@raphaabreu/nestjs-opensearch-structured-logger';

export type SNSProducerOptions<T = unknown> = {
  name: string;
  topicArn: string;
  serializer?: (event: T) => string;
  prepareEntry?: (event: T, index: number) => AWS.SNS.PublishBatchRequestEntry;
  verboseBeginning?: boolean;
};

const defaultOptions: Partial<SNSProducerOptions> = {
  serializer: JSON.stringify,
  verboseBeginning: true,
};

const MAX_VERBOSE_LOG_COUNT = 10;

export class SNSProducer<T> {
  public static readonly BATCH_SIZE = 10;

  private readonly logger: StructuredLogger;
  private readonly options: SNSProducerOptions<T>;

  private verboseLogCount = 0;

  public static register<T>(options: SNSProducerOptions<T>): Provider {
    return {
      provide: SNSProducer.getServiceName(options.name),
      useFactory: (awsSns: AWS.SNS) => new SNSProducer(awsSns, options),
      inject: [AWS.SNS],
    };
  }

  public static getServiceName(name: string): string {
    return `${SNSProducer.name}:${name}`;
  }

  constructor(private readonly awsSns: AWS.SNS, options: SNSProducerOptions<T>) {
    this.options = { ...defaultOptions, ...options };

    this.logger = new StructuredLogger(SNSProducer.getServiceName(options.name));
  }

  async publishBatch(messages: T | T[]) {
    const promises = MessageBatcher.batch(messages, SNSProducer.BATCH_SIZE).map((b) => this.doPublishBatch(b, true));

    await Promise.all(promises);
  }

  private async doPublishBatch(messages: T[], throws: boolean) {
    const params = {
      TopicArn: this.options.topicArn,
      PublishBatchRequestEntries: this.prepareBatch(messages),
    };

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
