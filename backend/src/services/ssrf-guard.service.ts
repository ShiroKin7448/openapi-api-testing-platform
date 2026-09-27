import http from 'http';
import https from 'https';
import dns from 'dns';
import { isIP } from 'net';
import { SSRFError } from '../utils/AppError';

/**
 * Validates if an IP address falls into a private/restricted CIDR block.
 * Blocks IPv4: 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4
 * Blocks IPv6: ::1/128, fc00::/7, fe80::/10, ff00::/8, ::/128, ::ffff:0:0/96
 */
export function isRestrictedIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isRestrictedIPv4(ip);
  if (family !== 6) return true;
  const words = ipv6Words(ip);
  if (!words) return true;
  const allZeroPrefix = words.slice(0, 7).every((word) => word === 0);
  if (allZeroPrefix && (words[7] === 0 || words[7] === 1)) return true;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isRestrictedIPv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if (words.slice(0, 6).every((word) => word === 0)) return true; // IPv4-compatible and unspecified ranges.
  const first = words[0];
  return (first & 0xfe00) === 0xfc00 // Unique local fc00::/7
    || (first & 0xffc0) === 0xfe80 // Link local fe80::/10
    || (first & 0xffc0) === 0xfec0 // Deprecated site local fec0::/10
    || (first & 0xff00) === 0xff00 // Multicast ff00::/8
    || (first === 0x2001 && words[1] === 0x0db8) // Documentation range
    || (first === 0x0064 && words[1] === 0xff9b); // Well-known NAT64 prefix
}

function isRestrictedIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [first, second, third, fourth] = octets;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true; // Shared address space.
  if (first === 192 && second === 0 && (third === 0 || third === 2)) return true;
  if (first === 198 && (second === 18 || second === 19 || second === 51 && third === 100)) return true;
  if (first === 203 && second === 0 && third === 113) return true;
  if (first === 255 && second === 255 && third === 255 && fourth === 255) return true;
  if (first === 168 && second === 63 && third === 129 && fourth === 16) return true; // Azure platform service.
  if (first === 100 && second === 100 && third === 100 && fourth === 200) return true; // Alibaba metadata.
  return false;
}

function ipv6Words(address: string): number[] | undefined {
  let value = address.toLowerCase().split('%')[0];
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const ipv4 = value.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return undefined;
    const octets = ipv4.split('.').map(Number);
    value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  const tokens = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (tokens.length !== 8 || tokens.some((token) => !/^[\da-f]{1,4}$/.test(token))) return undefined;
  return tokens.map((token) => Number.parseInt(token, 16));
}

export function areResolvedAddressesSafe(addresses: string[]): boolean {
  return addresses.length > 0 && addresses.every((address) => !isRestrictedIP(address));
}

/**
 * Custom DNS Lookup function to prevent TOCTOU DNS Rebinding attacks.
 * It resolves the hostname, immediately validates the IP against SSRF rules,
 * and passes the validated IP back to the socket to connect to directly.
 */
export function secureDnsLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family: number) => void
) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) {
      return callback(err, address, family);
    }

    const resolvedAddresses = typeof address === 'string' ? [address] : address.map((entry) => entry.address);
    if (!areResolvedAddressesSafe(resolvedAddresses)) {
      return callback(new SSRFError('SSRF blocked a hostname resolving to a restricted IP address.'), '', 0);
    }

    // Pass the safe IP to the socket
    callback(null, address, family);
  });
}

/**
 * HTTP Agent with secure SSRF DNS lookup override.
 */
export const ssrfHttpAgent = new http.Agent({
  lookup: secureDnsLookup as unknown as typeof dns.lookup
});

/**
 * HTTPS Agent with secure SSRF DNS lookup override.
 */
export const ssrfHttpsAgent = new https.Agent({
  lookup: secureDnsLookup as unknown as typeof dns.lookup
});
