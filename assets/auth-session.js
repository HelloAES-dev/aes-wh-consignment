/**
 * Share a short-lived authenticated session between pages in the same tab.
 *
 * sessionStorage is used instead of localStorage so closing the tab removes the
 * credential. The backend verifies the Google token and permissions again for
 * every request; this browser state never grants authorization by itself.
 */
const AUTH_SESSION_STORAGE_KEY = 'aes-consignment-auth-session';

function saveAuthenticationSession(idToken, user) {
  if (!idToken || !user || typeof user !== 'object') {
    clearAuthenticationSession();
    return;
  }

  const session = {
    idToken: String(idToken),
    user: user
  };

  window.sessionStorage.setItem(
    AUTH_SESSION_STORAGE_KEY,
    JSON.stringify(session)
  );
}

function readAuthenticationSession() {
  const storedSession = window.sessionStorage.getItem(
    AUTH_SESSION_STORAGE_KEY
  );

  if (!storedSession) {
    return null;
  }

  try {
    const session = JSON.parse(storedSession);

    if (!session.idToken || !session.user) {
      clearAuthenticationSession();
      return null;
    }

    return session;
  } catch (error) {
    console.error('Stored authentication session is invalid:', error);
    clearAuthenticationSession();
    return null;
  }
}

function clearAuthenticationSession() {
  window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

window.authenticationSession = Object.freeze({
  save: saveAuthenticationSession,
  read: readAuthenticationSession,
  clear: clearAuthenticationSession
});
