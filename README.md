# AutoSNSProducerService

AutoSNSProducerService is a NestJS module that automatically batches and publishes messages to an AWS SNS topic. It is designed to be flexible and easy to use, with options for custom serialization and message preparation.

## Features

- Batching of messages to reduce the number of requests to AWS SNS
- Customizable serialization and message preparation
- Lifecycle management with NestJS module lifecycle hooks
- Logging integration with NestJS logger

## Installation

First, install the package using your package manager:

```bash
npm i @raphaabreu/nestjs-auto-sns-producer
```

## Usage

To use this utility, import the `AutoSNSProducerModule` it into your NestJS module and provide the necessary options.
You can import it as many times as you have SNS topics to publish to.

```typescript
import { Module } from '@nestjs/common';
import { AutoSNSProducerModule } from '@raphaabreu/nestjs-auto-sns-producer';

@Module({
  imports: [
    AutoSNSProducerModule.register({
      eventName: 'event-1',
      topicArn: 'arn:aws:sns:us-east-1:123456789012:event-1',
    }),
    AutoSNSProducerModule.register({
      eventName: 'event-2',
      topicArn: 'arn:aws:sns:us-east-1:123456789012:event-2',
    }),
  ],
})
export class AppModule {}
```

Now, you can emit events with the specified eventName using the `EventEmitter2` instance:

```typescript
eventEmitter.emit('event-1', { foo: 'bar' });
```

The `AutoSNSProducerService` will automatically batch and publish messages to the specified SNS topic.

### Custom Serialization

To use a custom serializer, provide a `serializer` function in the options:

```typescript
return new AutoSNSProducerService(awsSns, eventEmitter, {
  eventName: 'event-1',
  topicArn: 'arn:aws:sns:us-east-1:123456789012:event-1,
  serializer: (event) => `Custom: ${JSON.stringify(event)}`,
});
```

### Custom Message Preparation

To customize how messages are prepared for publishing, provide a `prepareEntry` function in the options:

```typescript
return new AutoSNSProducerService(awsSns, eventEmitter, {
  eventName: 'event-1',
  topicArn: 'arn:aws:sns:us-east-1:123456789012:event-1,
  prepareEntry: (event, index) => ({
    Id: `custom-${index}`,
    Message: JSON.stringify(event),
  }),
});
```

## Tests

To run the provided unit tests just execute `npm run tests`.

## License

MIT License

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

## Support

If you have any issues or questions, please open an issue on the project repository.
