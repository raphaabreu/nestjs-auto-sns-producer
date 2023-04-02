# AutoSNSProducer and SNSProducer

`AutoSNSProducer` and `SNSProducer` are two a NestJS utility classes that simplifies the process of publishing messages to AWS SNS.

- `SNSProducer`: Responsible for publishing messages to Amazon SNS in batches. This class allows easier publishing and testing by delegating configuration to the dependency injection registration.

- `AutoSNSProducer`: Built on top of `SNSProducer`, this class will register an `EventEmitter2` listener to the event you indicate, will batch messages automatically waiting up to the indicated maximum interval and will handle any errors silently.

## Installation

Install the package using your package manager:

```bash
npm i @raphaabreu/nestjs-auto-sns-producer
```

## Using `AutoSNSProducer`

Register the `AutoSNSProducer` with your NestJS module:

```typescript
import { AutoSNSProducer } from '@raphaabreu/nestjs-auto-sns-producer-producer';

@Module({
  providers: [
    AutoSNSProducer.register({
      eventName: 'your-event-name',
      topicArn: 'your-topic-arn',
      maxBatchIntervalMs: 10000, // Optional, default is 10000ms
    }),
  ],
})
export class YourModule {}
```

Now you can produce events and they will be batched then published to SNS automatically:

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class YourService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async doWork() {
    // do something

    this.eventEmitter.emit('your-event-name', yourEventData); // Events will be batched to reduce the number of calls to AWS
  }
}
```

## Using `SNSProducer`

Register the `SNSProducer` with your NestJS module:

```typescript
import { SNSProducer } from '@raphaabreu/nestjs-auto-sns-producer';

@Module({
  providers: [
    SNSProducer.register({
      name: 'your-producer-name',
      topicArn: 'your-topic-arn',
      serializer: JSON.stringify, // Optional, default is JSON.stringify
    }),
  ],
})
export class YourModule {}
```

Inject the `SNSProducer` into your service and use the `publishBatch(messages: T | T[])` method to publish messages:

```typescript
import { SNSProducer } from '@raphaabreu/nestjs-auto-sns-producer';

@Injectable()
export class YourService {
  constructor(
    @Inject(SNSProducer.getServiceName('your-producer-name'))
    private readonly snsProducer: SNSProducer<YourMessageType>,
  ) {}

  async doWork() {
    const messages: YourMessageType[] = [];

    // ... fill the messages array

    // Messages will be broken down into batches and will be published immediately.
    // The promise returned will complete once all messages are published and will fail if there are any errors.
    await this.snsProducer.publishBatch(messages);
  }
}
```

## Advanced use

### Custom Serialization

To use a custom serializer, provide a `serializer` function in the options:

```typescript
AutoSNSProducer.register({
  eventName: 'event-1',
  topicArn: 'arn:aws:sns:us-east-1:123456789012:event-1',
  serializer: (event) => `Custom: ${JSON.stringify(event)}`,
});
```

### Custom Message Preparation

To customize how messages are prepared for publishing, provide a `prepareEntry` function in the options:

```typescript
AutoSNSProducer.register({
  eventName: 'event-1',
  topicArn: 'arn:aws:sns:us-east-1:123456789012:event-1',
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
