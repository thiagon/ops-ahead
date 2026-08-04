import type { Producer } from 'kafkajs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublisher } from '../../../src/plugins/kafka.ts';

function fakeProducer() {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    send: vi.fn(async () => []),
  };
}

describe('createPublisher', () => {
  let producer: ReturnType<typeof fakeProducer>;

  beforeEach(() => {
    producer = fakeProducer();
  });

  it('sends the message to the configured topic, keyed for partition affinity', async () => {
    const publisher = createPublisher(producer as unknown as Producer, 'incidents.received');

    await publisher.publish({ key: 'evt-1', value: '{"event_id":"evt-1"}' });

    expect(producer.send).toHaveBeenCalledWith({
      topic: 'incidents.received',
      acks: -1,
      messages: [{ key: 'evt-1', value: '{"event_id":"evt-1"}' }],
    });
  });

  it('connects once and reuses the connection across publishes', async () => {
    const publisher = createPublisher(producer as unknown as Producer, 'incidents.received');

    await publisher.connect();
    await publisher.publish({ key: 'evt-1', value: '{}' });
    await publisher.publish({ key: 'evt-2', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  it('connects on the first publish when startup could not reach the broker', async () => {
    producer.connect.mockRejectedValueOnce(new Error('broker down'));
    const publisher = createPublisher(producer as unknown as Producer, 'incidents.received');

    await expect(publisher.connect()).rejects.toThrow('broker down');
    await publisher.publish({ key: 'evt-1', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(2);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed send and reconnects on the next publish', async () => {
    producer.send.mockRejectedValueOnce(new Error('not leader for partition'));
    const publisher = createPublisher(producer as unknown as Producer, 'incidents.received');

    await expect(publisher.publish({ key: 'evt-1', value: '{}' })).rejects.toThrow(
      'not leader for partition',
    );
    await publisher.publish({ key: 'evt-2', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(2);
  });

  it('leaves a producer that never connected alone on shutdown', async () => {
    const publisher = createPublisher(producer as unknown as Producer, 'incidents.received');

    await publisher.disconnect();

    expect(producer.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a connected producer on shutdown', async () => {
    const publisher = createPublisher(producer as unknown as Producer, 'incidents.received');

    await publisher.connect();
    await publisher.disconnect();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });
});
