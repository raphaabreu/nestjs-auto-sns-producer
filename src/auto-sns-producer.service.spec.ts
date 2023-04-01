import { EventEmitter2 } from '@nestjs/event-emitter';
import * as AWS from 'aws-sdk';
import { AutoSNSProducerService, AutoSNSProducerServiceOptions } from './auto-sns-producer.service';

describe('AutoSNSProducerService', () => {
  let eventEmitter: EventEmitter2;
  let awsSns: jest.Mocked<AWS.SNS>;
  let sut: AutoSNSProducerService<any>;

  beforeEach(() => {
    eventEmitter = new EventEmitter2();
    awsSns = {
      publishBatch: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({ Successful: [], Failed: [] }),
      }),
    } as unknown as jest.Mocked<AWS.SNS>;
  });

  function createService(options: AutoSNSProducerServiceOptions) {
    sut = new AutoSNSProducerService(awsSns, eventEmitter, options);
  }

  it('should add events to batcher and publish messages', async () => {
    // Arrange
    createService({
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      eventName: 'MyEvent',
    });

    eventEmitter.emit('MyEvent', { foo: 'bar' });
    eventEmitter.emit('MyEvent', { foo: 'baz' });

    // Act
    await sut.flush();

    // Assert
    expect(awsSns.publishBatch).toHaveBeenCalled();
  });

  it('should use custom serializer if provided', async () => {
    // Arrange
    createService({
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      eventName: 'MyEvent',
      serializer: (event) => `Custom: ${JSON.stringify(event)}`,
    });

    eventEmitter.emit('MyEvent', { foo: 'bar' });

    // Act
    await sut.flush();

    // Assert
    expect(awsSns.publishBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        PublishBatchRequestEntries: [expect.objectContaining({ Message: 'Custom: {"foo":"bar"}' })],
      }),
    );
  });

  it('should use custom prepareEntry function if provided', async () => {
    // Arrange
    createService({
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      eventName: 'MyEvent',
      prepareEntry: (event, index) => ({
        Id: `custom-${index}`,
        Message: JSON.stringify(event),
      }),
    });

    eventEmitter.emit('MyEvent', { foo: 'bar' });

    // Act
    await sut.flush();

    // Assert
    expect(awsSns.publishBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        PublishBatchRequestEntries: [expect.objectContaining({ Id: 'custom-0' })],
      }),
    );
  });

  it('should start the batcher on module init', async () => {
    // Arrange
    createService({
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      eventName: 'MyEvent',
    });
    jest.spyOn(sut['batcher'], 'start').mockImplementation(() => {});

    // Act
    sut.onModuleInit();

    // Assert
    expect(sut['batcher'].start).toHaveBeenCalled();
  });

  it('should stop the batcher on module destroy', async () => {
    // Arrange
    createService({
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      eventName: 'MyEvent',
    });
    jest.spyOn(sut['batcher'], 'stop');

    // Act
    await sut.onModuleDestroy();

    // Assert
    expect(sut['batcher'].stop).toHaveBeenCalled();
  });

  it('should handle publishBatch errors', async () => {
    // Arrange
    createService({
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      eventName: 'MyEvent',
    });

    awsSns.publishBatch.mockReturnValue({
      promise: () => Promise.reject(new Error('Publish error')),
    } as unknown as any);
    jest.spyOn(sut['logger'], 'error');

    eventEmitter.emit('MyEvent', { foo: 'bar' });

    // Act
    await sut.flush();

    // Assert
    expect(sut['logger'].error).toHaveBeenCalled();
  });

  it('should handle different numbers of successful and failed messages', async () => {
    // Arrange
    createService({
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      eventName: 'MyEvent',
    });
    awsSns.publishBatch.mockReturnValue({
      promise: () =>
        Promise.resolve({
          Successful: [{}, {}],
          Failed: [{}, {}],
        }),
    } as unknown as any);

    jest.spyOn(sut['logger'], 'warn');

    eventEmitter.emit('MyEvent', { foo: 'bar' });
    eventEmitter.emit('MyEvent', { foo: 'baz' });
    eventEmitter.emit('MyEvent', { foo: 'qux' });
    eventEmitter.emit('MyEvent', { foo: 'quux' });

    // Act
    await sut.flush();

    // Assert
    expect(sut['logger'].warn).toHaveBeenCalled();
  });
});
