const envBackendUrlRaw = (process.env.REACT_APP_BACKEND_URL || '').trim();

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

function isLoopbackHost(hostname) {
  const normalized = (hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isLoopbackUrl(url) {
  try {
    const parsed = new URL(url);
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

const inferredBackendUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : 'http://localhost:8000';

// Ignore localhost override when app is opened from a remote host.
const shouldUseEnvBackendUrl = (() => {
  if (!envBackendUrlRaw) return false;
  if (typeof window === 'undefined') return true;

  const frontendIsLoopback = isLoopbackHost(window.location.hostname);
  const envTargetsLoopback = isLoopbackUrl(envBackendUrlRaw);
  return frontendIsLoopback || !envTargetsLoopback;
})();

export const backendUrl = stripTrailingSlash(
  shouldUseEnvBackendUrl ? envBackendUrlRaw : inferredBackendUrl
);
