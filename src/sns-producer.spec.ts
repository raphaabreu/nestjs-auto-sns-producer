import { 
  SNSClient, 
  SNSServiceException,
  PublishBatchCommand,
  PublishBatchCommandOutput,
  SNSClientResolvedConfig
} from '@aws-sdk/client-sns';
import { MiddlewareStack } from "@aws-sdk/types";
import { SNSProducer, SNSProducerOptions } from './sns-producer';
describe('SNSProducer', () => {
  let awsSns: jest.Mocked<SNSClient>;
  let options: SNSProducerOptions;
  let snsProducer: SNSProducer<string>;

  beforeEach(() => {
    awsSns = {
      config: {},
      middlewareStack: {} as MiddlewareStack<any, any>,
      destroy: jest.fn(),
      send: jest.fn().mockResolvedValue({ 
        Successful: [], 
        Failed: [], 
        $metadata: {} 
      } as PublishBatchCommandOutput),
    } as unknown as jest.Mocked<SNSClient>;
    options = {
      name: 'TestSNSProducer',
      topicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
    };
    snsProducer = new SNSProducer(awsSns, options);
  });

  describe('send', () => {
    it('should publish messages in batch', async () => {
      // Arrange
      const messages = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

      // Act
      await snsProducer.publishBatch(messages);

      // Assert
      expect(awsSns.send).toHaveBeenCalledTimes(2);
    });

    it('should throw an error when publishing fails', async () => {
      // Arrange
      const messages = ['message1', 'message2', 'message3'];
      const exception = new SNSServiceException({
        name: 'SNSServiceException',
        $fault: 'client',
        $metadata: {},
        message: 'Publishing failed'
      });
      (awsSns.send as jest.Mock).mockRejectedValue(exception);
      // Act
      const result = snsProducer.publishBatch(messages);

      // Assert
      await expect(result).rejects.toBe(exception);
    });
  });

  describe('prepareBatch', () => {
    it('should use provided prepareEntry function if available', () => {
      // Arrange
      const messages = ['message1', 'message2', 'message3'];
      const customPrepareEntry = (event: string, index: number) => ({
        Id: index.toString(),
        Message: event.toUpperCase(),
      });
      options.prepareEntry = customPrepareEntry;
      snsProducer = new SNSProducer(awsSns, options);

      // Act
      const preparedBatch = snsProducer['prepareBatch'](messages);

      // Assert
      expect(preparedBatch).toEqual([
        { Id: '0', Message: 'MESSAGE1' },
        { Id: '1', Message: 'MESSAGE2' },
        { Id: '2', Message: 'MESSAGE3' },
      ]);
    });

    it('should use default serialization method if prepareEntry function is not provided', () => {
      // Arrange
      const messages = ['message1', 'message2', 'message3'];

      // Act
      const preparedBatch = snsProducer['prepareBatch'](messages);

      // Assert
      expect(preparedBatch).toEqual([
        { Id: '0', Message: '"message1"' },
        { Id: '1', Message: '"message2"' },
        { Id: '2', Message: '"message3"' },
      ]);
    });
  });
});
