/**
 * In-memory token manager for Google Workspace / Drive OAuth access tokens.
 *
 * CRITICAL SECURITY & COMPLIANCE RULES:
 * 1. Tokens are kept in volatile memory ONLY.
 * 2. Never persisted to localStorage, sessionStorage, cookies, or IndexedDB.
 * 3. Never logged or exposed in console outputs.
 * 4. Used by both GSI (Google Identity Services) and Firebase auth paths.
 */

let inMemoryAccessToken: string | null = null;
let tokenExpiresAt: number | null = null;

export const tokenManager = {
  /**
   * Sets the current Drive access token in memory.
   * Never logs the token value.
   */
  setAccessToken: (token: string | null, expiresInSeconds: number = 3600): void => {
    inMemoryAccessToken = token && token.trim().length > 0 ? token.trim() : null;
    if (inMemoryAccessToken) {
      if (expiresInSeconds <= 0) {
        tokenExpiresAt = Date.now() - 1000; // expired
      } else {
        tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
      }
    } else {
      tokenExpiresAt = null;
    }
  },

  /**
   * Retrieves the current in-memory access token, or null if unset or expired.
   */
  getAccessToken: (): string | null => {
    if (!inMemoryAccessToken) return null;
    if (tokenExpiresAt && Date.now() >= tokenExpiresAt) {
      inMemoryAccessToken = null;
      tokenExpiresAt = null;
      return null;
    }
    return inMemoryAccessToken;
  },

  /**
   * Clears the access token from volatile memory immediately.
   */
  clearAccessToken: (): void => {
    inMemoryAccessToken = null;
    tokenExpiresAt = null;
  },

  /**
   * Checks whether a valid in-memory token exists without exposing it.
   */
  hasAccessToken: (): boolean => {
    return tokenManager.getAccessToken() !== null;
  },

  /**
   * Alias for hasAccessToken.
   */
  hasValidAccessToken: (): boolean => {
    return tokenManager.getAccessToken() !== null;
  },

  /**
   * Returns remaining valid time in ms.
   */
  getTimeToLiveMs: (): number => {
    if (!inMemoryAccessToken || !tokenExpiresAt) return 0;
    return Math.max(0, tokenExpiresAt - Date.now());
  },

  /**
   * Checks if the token is expired or within 60 seconds of expiring.
   */
  isAccessTokenExpired: (): boolean => {
    if (!inMemoryAccessToken) return true;
    if (!tokenExpiresAt) return false;
    return Date.now() >= tokenExpiresAt;
  },
};
