/**
 * Validates a redirect URL to prevent Open Redirect vulnerabilities.
 * Only allows relative paths starting with '/'.
 * 
 * @param url The redirect URL to validate
 * @param fallback The fallback URL if the provided URL is invalid
 * @returns A safe redirect URL
 */
export const getSafeRedirect = (url: string | null | undefined, fallback = '/'): string => {
  if (!url) return fallback;
  
  // Basic validation: must start with / but not //
  if (!url.startsWith('/') || url.startsWith('//')) {
    return fallback;
  }

  // Prevent backslash redirection (some browsers treat \ as /)
  if (url.includes('\\')) {
    return fallback;
  }

  // Prevent control characters and other dangerous characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(url)) {
    return fallback;
  }

  return url;
};
