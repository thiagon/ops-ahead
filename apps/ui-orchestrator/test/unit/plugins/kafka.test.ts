import type { Admin, Consumer, Producer } from 'kafkajs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublisher, createStatusConsumer } from '../../../src/plugins/kafka.ts';

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

  it('sends the message to whichever topic the caller names', async () => {
    const publisher = createPublisher(producer as unknown as Producer);

    await publisher.publish('trigger.ml', { key: 'run-1', value: '{"run_id":"run-1"}' });
    await publisher.publish('trigger.data', { key: 'run-2', value: '{"run_id":"run-2"}' });

    expect(producer.send).toHaveBeenNthCalledWith(1, {
      topic: 'trigger.ml',
      acks: -1,
      messages: [{ key: 'run-1', value: '{"run_id":"run-1"}' }],
    });
    expect(producer.send).toHaveBeenNthCalledWith(2, {
      topic: 'trigger.data',
      acks: -1,
      messages: [{ key: 'run-2', value: '{"run_id":"run-2"}' }],
    });
  });

  it('connects once and reuses the connection across publishes', async () => {
    const publisher = createPublisher(producer as unknown as Producer);

    await publisher.connect();
    await publisher.publish('trigger.ml', { key: 'run-1', value: '{}' });
    await publisher.publish('trigger.ml', { key: 'run-2', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  it('connects on the first publish when startup could not reach the broker', async () => {
    producer.connect.mockRejectedValueOnce(new Error('broker down'));
    const publisher = createPublisher(producer as unknown as Producer);

    await expect(publisher.connect()).rejects.toThrow('broker down');
    await publisher.publish('trigger.ml', { key: 'run-1', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(2);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed send and reconnects on the next publish', async () => {
    producer.send.mockRejectedValueOnce(new Error('not leader for partition'));
    const publisher = createPublisher(producer as unknown as Producer);

    await expect(publisher.publish('trigger.ml', { key: 'run-1', value: '{}' })).rejects.toThrow(
      'not leader for partition',
    );
    await publisher.publish('trigger.ml', { key: 'run-2', value: '{}' });

    expect(producer.connect).toHaveBeenCalledTimes(2);
  });

  it('disconnects a connected producer on shutdown', async () => {
    const publisher = createPublisher(producer as unknown as Producer);

    await publisher.connect();
    await publisher.disconnect();

    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });
});

type EachMessageHandler = (payload: {
  partition: number;
  message: { offset: string; value: Buffer | null };
}) => Promise<void>;

function fakeConsumer() {
  let handler: EachMessageHandler | undefined;
  let resolveRunning: () => void;
  const running = new Promise<void>(resolve => {
    resolveRunning = resolve;
  });

  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => undefined),
    run: vi.fn(async ({ eachMessage }: { eachMessage: EachMessageHandler }) => {
      handler = eachMessage;
      resolveRunning();
    }),
    // Test-only helper: resolves once run() has installed its handler — the
    // real client's connect/fetchTopicOffsets/subscribe chain takes several
    // microtask ticks, so a delivery before this would silently no-op.
    whenRunning: () => running,
    // Test-only helper: deliver a message as if it came off the wire.
    async deliver(partition: number, offset: string, value: Record<string, unknown> | null) {
      await handler?.({
        partition,
        message: { offset, value: value === null ? null : Buffer.from(JSON.stringify(value)) },
      });
    },
  };
}

function fakeAdmin(offsets: Array<{ partition: number; offset: string; low: string }>) {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    fetchTopicOffsets: vi.fn(async () => offsets),
  };
}

describe('createStatusConsumer', () => {
  it('resolves start() immediately when the topic is empty', async () => {
    const consumer = fakeConsumer();
    const admin = fakeAdmin([{ partition: 0, offset: '0', low: '0' }]);
    const statusConsumer = createStatusConsumer(
      consumer as unknown as Consumer,
      admin as unknown as Admin,
      'trigger.status',
    );

    await statusConsumer.start();

    expect(consumer.subscribe).toHaveBeenCalledWith({
      topic: 'trigger.status',
      fromBeginning: true,
    });
    expect(statusConsumer.get('run-1')).toBeUndefined();
  });

  it('replays the backlog into the map before start() resolves', async () => {
    const consumer = fakeConsumer();
    // High watermark 2 → offsets 0 and 1 already exist; last is 1.
    const admin = fakeAdmin([{ partition: 0, offset: '2', low: '0' }]);
    const statusConsumer = createStatusConsumer(
      consumer as unknown as Consumer,
      admin as unknown as Admin,
      'trigger.status',
    );

    const started = statusConsumer.start();
    await consumer.whenRunning();
    await consumer.deliver(0, '0', { run_id: 'run-1', status: 'Running', started_at: 't0' });
    await consumer.deliver(0, '1', {
      run_id: 'run-1',
      status: 'Succeeded',
      started_at: 't0',
      finished_at: 't1',
    });
    await started;

    expect(statusConsumer.get('run-1')).toMatchObject({ status: 'Succeeded' });
  });

  it('keeps consuming live after the backlog is caught up', async () => {
    const consumer = fakeConsumer();
    const admin = fakeAdmin([{ partition: 0, offset: '0', low: '0' }]);
    const statusConsumer = createStatusConsumer(
      consumer as unknown as Consumer,
      admin as unknown as Admin,
      'trigger.status',
    );

    await statusConsumer.start();
    await consumer.deliver(0, '0', { run_id: 'run-2', status: 'Running', started_at: 't0' });

    expect(statusConsumer.get('run-2')).toMatchObject({ status: 'Running' });
  });

  it('ignores a malformed message instead of crashing the consumer', async () => {
    const consumer = fakeConsumer();
    const admin = fakeAdmin([{ partition: 0, offset: '1', low: '0' }]);
    const statusConsumer = createStatusConsumer(
      consumer as unknown as Consumer,
      admin as unknown as Admin,
      'trigger.status',
    );

    const started = statusConsumer.start();
    await consumer.whenRunning();
    await consumer.deliver(0, '0', { no_run_id: true });
    await started;

    expect(statusConsumer.get('run-1')).toBeUndefined();
  });
});
