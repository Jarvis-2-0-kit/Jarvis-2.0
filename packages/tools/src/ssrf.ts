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

  // Block private/reserved IPv4 ranges (dotted-decimal form)
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 172 && b! >= 16 && b! <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;            // 192.168.0.0/16
    if (a === 127) return true;                         // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true;            // 169.254.0.0/16 (link-local)
    if (a === 0) return true;                           // 0.0.0.0/8
  }

  // Block decimal/octal IPv4 encoding (e.g. 2130706433 = 127.0.0.1)
  // A purely numeric hostname that isn't dotted-decimal is a decimal IP.
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (!isNaN(num)) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }
  }

  // Block private/reserved IPv6 ranges
  // Strip brackets if present (e.g. [fe80::1] → fe80::1)
  const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();

  if (ipv6.startsWith('fe80:')) return true;           // fe80::/10 link-local
  if (ipv6.startsWith('fc00:') || ipv6.startsWith('fd')) return true; // fc00::/7 ULA
  if (ipv6 === '::1') return true;                     // loopback (belt-and-suspenders)

  // Block IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) — extract and check IPv4
  const mappedMatch = ipv6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedMatch) {
    return isPrivateUrl(`http://${mappedMatch[1]}`);
  }

  return false;
}
