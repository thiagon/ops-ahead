import { describe, expect, it } from 'vitest';
import { classify } from '../app/components/RouteError.tsx';

describe('classify', () => {
  it('reads both spellings of an unreachable service as the same case', () => {
    // The server sees the underlying cause, the client only the wrapper; both
    // must land on the same wording or the page fails to hydrate.
    const onClient = new Error('fetch failed');
    const onServer = Object.assign(new Error('fetch failed'), {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:3999'),
    });

    expect(classify(onClient).kind).toBe('unavailable');
    expect(classify(onServer).kind).toBe('unavailable');
  });

  it('reads a timed-out request as unavailable too', () => {
    expect(classify(new Error('The operation was aborted due to timeout')).kind).toBe(
      'unavailable',
    );
  });

  it('separates a 404 from a service being down — retrying will not help', () => {
    expect(
      classify({ status: 404, statusText: 'Not Found', data: null, internal: false }).kind,
    ).toBe('notFound');
  });

  it('keeps the status of an error response the screen can show', () => {
    expect(
      classify({ status: 502, statusText: 'Bad Gateway', data: null, internal: false }),
    ).toEqual({ kind: 'unexpected', status: 502 });
  });

  it('falls back to unexpected for anything it cannot place', () => {
    expect(classify(new Error('boom')).kind).toBe('unexpected');
    expect(classify('not an error').kind).toBe('unexpected');
  });
});
