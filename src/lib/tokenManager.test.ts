import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tokenManager } from './tokenManager';

describe('tokenManager (In-Memory Token Security)', () => {
  beforeEach(() => {
    tokenManager.clearAccessToken();
    vi.restoreAllMocks();
  });

  it('stores and retrieves access tokens in volatile memory only', () => {
    expect(tokenManager.hasValidAccessToken()).toBe(false);
    expect(tokenManager.getAccessToken()).toBeNull();

    tokenManager.setAccessToken('test-token-abc-123', 3600);

    expect(tokenManager.hasValidAccessToken()).toBe(true);
    expect(tokenManager.getAccessToken()).toBe('test-token-abc-123');
  });

  it('reports expired tokens properly and clears them', () => {
    // Set token with 0 seconds duration (immediately expired)
    tokenManager.setAccessToken('expired-token', 0);

    expect(tokenManager.hasValidAccessToken()).toBe(false);
    expect(tokenManager.getAccessToken()).toBeNull();
  });

  it('clears access token upon signout/invalidation', () => {
    tokenManager.setAccessToken('active-token', 3600);
    expect(tokenManager.hasValidAccessToken()).toBe(true);

    tokenManager.clearAccessToken();
    expect(tokenManager.hasValidAccessToken()).toBe(false);
    expect(tokenManager.getAccessToken()).toBeNull();
  });

  it('never persists tokens to localStorage or sessionStorage or cookies', () => {
    const mockStorage = {
      setItem: vi.fn(),
      getItem: vi.fn(),
      removeItem: vi.fn(),
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = mockStorage;
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = mockStorage;

    tokenManager.setAccessToken('secret-token-xyz', 3600);
    const token = tokenManager.getAccessToken();
    tokenManager.clearAccessToken();

    expect(token).toBe('secret-token-xyz');
    expect(mockStorage.setItem).not.toHaveBeenCalled();
    expect(mockStorage.getItem).not.toHaveBeenCalled();
  });

  it('calculates remaining TTL correctly', () => {
    tokenManager.setAccessToken('timed-token', 60);
    const ttl = tokenManager.getTimeToLiveMs();
    expect(ttl).toBeGreaterThan(50000);
    expect(ttl).toBeLessThanOrEqual(60000);
  });
});
