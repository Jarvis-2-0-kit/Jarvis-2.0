/**
 * Shared SSRF protection utilities.
 * Used by browser, web-fetch, and any tool that makes outbound HTTP requests.
 */

/** Check if a URL targets a private/internal network (SSRF protection) */
export function isPrivateUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true; // Malformed URLs are blocked
  }

  // Block non-HTTP(S) protocols (e.g. file://, ftp://)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    return true;
  }

  // Block .local and .internal domains
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true;
  }

  // Block private/reserved IP ranges
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (a === 10) return true;            // 10.0.0.0/8
    if (a === 172 && b! >= 16 && b! <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true;            // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
    if (a === 0) return true;              // 0.0.0.0/8
  }

  return false;
}
