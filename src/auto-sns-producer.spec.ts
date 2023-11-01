import { EventEmitter2 } from '@nestjs/event-emitter';
import * as AWS from 'aws-sdk';
import { AutoSNSProducer, AutoSNSProducerOptions } from './auto-sns-producer';

describe('AutoSNSProducerService', () => {
  let eventEmitter: EventEmitter2;
  let awsSns: jest.Mocked<AWS.SNS>;
  let sut: AutoSNSProducer<any>;

  beforeEach(() => {
    eventEmitter = new EventEmitter2();
    awsSns = {
      publishBatch: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({ Successful: [], Failed: [] }),
      }),
    } as unknown as jest.Mocked<AWS.SNS>;
  });

  function createService(options: AutoSNSProducerOptions) {
    sut = new AutoSNSProducer(awsSns, eventEmitter, options);
  }

  it('should return service name from event', () => {
    // Arrange
    // Act
    const name = AutoSNSProducer.getServiceName('MyEvent');

    // Assert
    expect(name).toBe('AutoSNSProducer:MyEvent');
  });

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
    jest.spyOn(sut['batcher'], 'start').mockImplementation(() => {
      // Do nothing
    });

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
});
