import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { tokenManager } from './tokenManager';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Explicitly ensure local browser persistence for Firebase user authentication state
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Could not set browserLocalPersistence for Firebase Auth:', err);
});

// Storage Keys for cached non-sensitive user profile display
export const STORAGE_KEYS = {
  USER: 'drive_workspace_cached_user',
};

export interface CachedUserData {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export const saveCachedUser = (user: User | CachedUserData) => {
  try {
    const userData: CachedUserData = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    };
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData));
  } catch (err) {
    console.warn('Failed to save cached user to localStorage:', err);
  }
};

export const getCachedUser = (): CachedUserData | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const clearStoredAuth = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.USER);
    tokenManager.clearAccessToken();
  } catch (err) {
    console.warn('Failed to clear stored auth in localStorage:', err);
  }
};

let isSigningIn = false;

/**
 * Initializes and monitors auth state across browser sessions.
 * Drive access token is maintained strictly in memory via tokenManager.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      saveCachedUser(user);
      const token = tokenManager.getAccessToken() || '';
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else {
      tokenManager.clearAccessToken();
      const cachedUser = getCachedUser();
      if (!cachedUser) {
        if (onAuthFailure) onAuthFailure();
      }
    }
  });
};

/**
 * Signs in or reconnects Google Drive with OAuth scopes.
 * If loginHint is provided, skips account selection to smoothly refresh the current user.
 * Access token is saved strictly in in-memory tokenManager, never persisted.
 */
export const googleSignIn = async (options?: {
  loginHint?: string;
}): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive');

    if (options?.loginHint) {
      provider.setCustomParameters({
        login_hint: options.loginHint,
      });
    } else {
      provider.setCustomParameters({
        prompt: 'select_account',
      });
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not retrieve access token from Google sign-in.');
    }

    tokenManager.setAccessToken(credential.accessToken);
    saveCachedUser(result.user);

    return { user: result.user, accessToken: credential.accessToken };
  } catch (error) {
    console.error('Sign-in error occurred.');
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => {
  return tokenManager.getAccessToken();
};

export const getStoredToken = (): string | null => {
  return tokenManager.getAccessToken();
};

export const isStoredTokenExpired = (): boolean => {
  return tokenManager.isAccessTokenExpired();
};

export const setAccessToken = (token: string | null) => {
  tokenManager.setAccessToken(token);
};

/**
 * Explicit user logout. Wipes volatile token and signs out of Firebase.
 */
export const logout = async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Sign-out error:', err);
  }
  tokenManager.clearAccessToken();
  clearStoredAuth();
};
