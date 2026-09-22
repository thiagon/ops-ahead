import { Kafka } from 'kafkajs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublisher } from '../../../src/lib/kafka.ts';

const { producer } = vi.hoisted(() => ({
  producer: {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    send: vi.fn(async () => []),
  },
}));

vi.mock('kafkajs', () => ({
  logLevel: { WARN: 4 },
  Kafka: vi.fn(function Kafka(this: { producer: () => typeof producer }) {
    this.producer = () => producer;
  }),
}));

describe('createPublisher', () => {
  beforeEach(() => {
    vi.mocked(Kafka).mockClear();
    producer.connect.mockReset();
    producer.disconnect.mockReset();
    producer.send.mockReset();
    producer.connect.mockResolvedValue(undefined);
    producer.disconnect.mockResolvedValue(undefined);
    producer.send.mockResolvedValue([]);
  });

  it('builds a Kafka client from clientId and a comma-separated broker list', () => {
    createPublisher({ clientId: 'ui-gateway', brokers: 'a:9092, b:9092' });

    expect(Kafka).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'ui-gateway',
        brokers: ['a:9092', 'b:9092'],
      }),
    );
  });

  it('sends the message to the topic named on the message, keyed for partition affinity', async () => {
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await client.publish({
      topic: 'events.raw.alert',
      key: 'evt-1',
      value: '{"event_id":"evt-1"}',
    });

    expect(producer.send).toHaveBeenCalledWith({
      topic: 'events.raw.alert',
      acks: -1,
      messages: [{ key: 'evt-1', value: '{"event_id":"evt-1"}' }],
    });
  });

  it('sends a batch in one Produce request per topic', async () => {
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await client.publishBatch([
      { topic: 'events.raw.alert', key: 'evt-1', value: '{"n":1}' },
      { topic: 'events.raw.alert', key: 'evt-2', value: '{"n":2}' },
      { topic: 'events.raw.monitor', key: 'evt-3', value: '{"n":3}' },
    ]);

    expect(producer.send).toHaveBeenCalledTimes(2);
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'events.raw.alert',
      acks: -1,
      messages: [
        { key: 'evt-1', value: '{"n":1}' },
        { key: 'evt-2', value: '{"n":2}' },
      ],
    });
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'events.raw.monitor',
      acks: -1,
      messages: [{ key: 'evt-3', value: '{"n":3}' }],
    });
  });

  it('routes different messages to different topics on the same producer', async () => {
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await client.publish({ topic: 'events.raw.alert', key: 'evt-1', value: '{}' });
    await client.publish({ topic: 'events.raw.monitor', key: 'evt-2', value: '{}' });

    expect(producer.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ topic: 'events.raw.alert' }),
    );
    expect(producer.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ topic: 'events.raw.monitor' }),
    );
  });

  it('connects once and reuses the connection across publishes', async () => {
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await client.connect();
    await client.publish({ topic: 'events.raw.alert', key: 'evt-1', value: '{}' });
    await client.publish({ topic: 'events.raw.alert', key: 'evt-2', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  it('connects on the first publish when startup could not reach the broker', async () => {
    producer.connect.mockRejectedValueOnce(new Error('broker down'));
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await expect(client.connect()).rejects.toThrow('broker down');
    await client.publish({ topic: 'events.raw.alert', key: 'evt-1', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(2);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed send and reconnects on the next publish', async () => {
    producer.send.mockRejectedValueOnce(new Error('not leader for partition'));
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await expect(
      client.publish({ topic: 'events.raw.alert', key: 'evt-1', value: '{}' }),
    ).rejects.toThrow('not leader for partition');
    await client.publish({ topic: 'events.raw.alert', key: 'evt-2', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(2);
  });

  it('leaves a producer that never connected alone on shutdown', async () => {
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await client.disconnect();

    expect(producer.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a connected producer on shutdown', async () => {
    const client = createPublisher({ clientId: 'ui-gateway', brokers: 'localhost:9092' });

    await client.connect();
    await client.disconnect();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });
});
