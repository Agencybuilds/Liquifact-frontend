import { executeConcurrentSafe, clearCache, cache, inflight } from './constants';

describe('constants concurrent execution', () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    clearCache();
  });

  it('handles valid inputs and caches the result (duplicate work)', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ data: 'ok' });
    
    const p1 = executeConcurrentSafe('test1', fetchFn);
    const p2 = executeConcurrentSafe('test1', fetchFn);
    
    const [res1, res2] = await Promise.all([p1, p2]);
    
    expect(res1).toEqual({ data: 'ok' });
    expect(res2).toEqual({ data: 'ok' });
    expect(res1).toBe(res2); // Same frozen object
    expect(Object.isFrozen(res1)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid inputs deterministically', async () => {
    await expect(executeConcurrentSafe('', jest.fn())).rejects.toThrow('valid key is required');
    await expect(executeConcurrentSafe('   ', jest.fn())).rejects.toThrow('valid key is required');
    // @ts-ignore
    await expect(executeConcurrentSafe(null, jest.fn())).rejects.toThrow('valid key is required');
  });

  it('enforces timing boundaries (timeouts)', async () => {
    const fetchFn = jest.fn().mockImplementation(() => {
      return new Promise(resolve => setTimeout(() => resolve('late'), 100));
    });

    const promise = executeConcurrentSafe('timeout-key', fetchFn, { timeoutMs: 10, retries: 0 });
    
    await expect(promise).rejects.toThrow('Concurrent execution failed: Timeout');
    expect(cache.has('timeout-key')).toBe(false);
  });

  it('handles idempotent retries on partial failure', async () => {
    let attempts = 0;
    const fetchFn = jest.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Network error');
      }
      return { success: true };
    });

    const promise = executeConcurrentSafe('retry-key', fetchFn, { retries: 3, timeoutMs: 50 });
    const result = await promise;
    
    expect(result).toEqual({ success: true });
    expect(attempts).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('prevents stale or inconsistent results with racing requests', async () => {
    let callCount = 0;
    const fetchFn = jest.fn().mockImplementation(async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 10)); // simulate async
      return { val: callCount };
    });

    // Fire 5 concurrent requests
    const promises = Array.from({ length: 5 }).map(() => executeConcurrentSafe('race-key', fetchFn));
    
    const results = await Promise.all(promises);
    
    results.forEach(res => {
      expect(res).toEqual({ val: 1 });
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(inflight.has('race-key')).toBe(false);
    expect(cache.has('race-key')).toBe(true);
  });
  
  it('does not produce inconsistent result on concurrent failures', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('Fatal'));

    const p1 = executeConcurrentSafe('fail-key', fetchFn, { retries: 1, timeoutMs: 50 });
    const p2 = executeConcurrentSafe('fail-key', fetchFn, { retries: 1, timeoutMs: 50 });
    
    await expect(p1).rejects.toThrow('Concurrent execution failed: Fatal');
    await expect(p2).rejects.toThrow('Concurrent execution failed: Fatal');
    
    expect(fetchFn).toHaveBeenCalledTimes(2); // Initial + 1 retry
    expect(inflight.has('fail-key')).toBe(false);
  });
});
