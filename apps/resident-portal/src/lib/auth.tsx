import { useCallback } from 'react';
import { useAuth } from 'zitejs/auth';

/**
 * The signed-in person, if any. Browsing is public; starting an application,
 * the dashboard, tasks, profile and reviews need a sign-in.
 */
export function useSession() {
  const { user, isLoading, loginWithRedirect, logout } = useAuth();

  /** Sign in and come back to `hashPath` (default: exactly where they are). */
  const signIn = useCallback(
    (hashPath?: string) => {
      if (hashPath) {
        const target = `${window.location.origin}${window.location.pathname}${window.location.search}#${hashPath.startsWith('/') ? hashPath : `/${hashPath}`}`;
        // Land on the destination first, so the round trip through sign-in returns there whichever way the platform reads it.
        if (window.location.href !== target) window.location.hash = hashPath;
        loginWithRedirect({ redirectUrl: target });
        return;
      }
      loginWithRedirect({ redirectUrl: window.location.href });
    },
    [loginWithRedirect],
  );

  const signOut = useCallback(() => {
    logout();
  }, [logout]);

  const name = user ? ([user.firstName, user.lastName].filter(Boolean).join(' ').trim() || (user as { name?: string }).name || user.email) : '';
  return { user: user ?? null, isLoading, signIn, signOut, name };
}
