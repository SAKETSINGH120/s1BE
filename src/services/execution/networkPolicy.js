import dns from 'node:dns';
import net from 'node:net';
import { AppError } from '../../utils/AppError.js';

function blockList(ipv4Ranges, ipv6Ranges) {
  const list = new net.BlockList();
  for (const range of ipv4Ranges) {
    const [address, prefix] = range.split('/');
    list.addSubnet(address, Number(prefix), 'ipv4');
  }
  for (const range of ipv6Ranges) {
    const [address, prefix] = range.split('/');
    list.addSubnet(address, Number(prefix), 'ipv6');
  }
  return list;
}

// Never reachable, even when private networks are allowed: unspecified, link-local (incl. cloud
// metadata), cloud metadata IPs inside other ranges, documentation/benchmark/reserved, multicast,
// and IPv6 forms that embed IPv4 addresses and could smuggle a private target.
const ALWAYS_BLOCKED = blockList(
  [
    '0.0.0.0/8',
    '169.254.0.0/16',
    '100.100.100.200/32',
    '192.0.0.0/24',
    '192.0.2.0/24',
    '192.88.99.0/24',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '224.0.0.0/4',
    '240.0.0.0/4',
  ],
  [
    '::/128',
    '64:ff9b::/96',
    '64:ff9b:1::/48',
    '100::/64',
    '2001::/23',
    '2001:db8::/32',
    '2002::/16',
    'fd00:ec2::254/128',
    'fe80::/10',
    'fec0::/10',
    'ff00::/8',
  ],
);

// Internal networks: blocked unless EXECUTION_ALLOW_PRIVATE_NETWORKS is enabled.
const PRIVATE = blockList(
  ['10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  ['::1/128', 'fc00::/7'],
);

// IPv4-mapped IPv6 (::ffff:a.b.c.d) can smuggle any IPv4 target, so it is never allowed. It is
// detected on the canonical form because net.BlockList applies ::ffff:0:0/96 rules to plain IPv4
// addresses too, which would block everything.
function canonicalIpv6(address) {
  return new URL(`http://[${address}]/`).hostname;
}

function isIpv4Mapped(address) {
  return canonicalIpv6(address).startsWith('[::ffff:');
}

// Deprecated IPv4-compatible form (::a.b.c.d, canonically ::xxxx:xxxx); ::1 and :: are excluded.
function isIpv4Compatible(address) {
  const canonical = canonicalIpv6(address);
  return /^\[::[0-9a-f]{1,4}(:[0-9a-f]{1,4})?\]$/.test(canonical) && canonical !== '[::1]';
}

export function classifyAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return 'blocked';
  if (family === 6 && (isIpv4Mapped(address) || isIpv4Compatible(address))) return 'blocked';
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (ALWAYS_BLOCKED.check(address, type)) return 'blocked';
  if (PRIVATE.check(address, type)) return 'private';
  return 'public';
}

export function assertAddressAllowed(address, { allowPrivateNetworks }) {
  const classification = classifyAddress(address);
  if (classification === 'public') return;
  if (classification === 'private' && allowPrivateNetworks) return;

  throw new AppError(
    400,
    'Requests to private, internal or reserved network addresses are not allowed',
    { code: 'DESTINATION_BLOCKED' },
  );
}

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

// Parses and validates a target URL. The WHATWG parser also normalizes alternative IPv4
// notations (e.g. http://2130706433, http://0x7f.1) to dotted form before they are checked.
export function parseTargetUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'Enter a valid URL', { code: 'INVALID_URL' });
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new AppError(400, 'Only http:// and https:// URLs are supported', {
      code: 'UNSUPPORTED_PROTOCOL',
    });
  }
  if (url.username || url.password) {
    throw new AppError(400, 'Credentials in the URL are not supported; use Basic Auth instead', {
      code: 'INVALID_URL',
    });
  }
  if (!url.hostname) {
    throw new AppError(400, 'The URL has no host', { code: 'INVALID_URL' });
  }
  return url;
}

// Hostnames are checked at connection time by the lookup below; IP literals skip DNS, so they are
// checked here before connecting.
export function assertIpLiteralAllowed(url, policy) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) assertAddressAllowed(host, policy);
}

// A dns.lookup replacement for http.request. Every resolved address must be allowed, and the
// socket connects to exactly the address that was checked, which prevents DNS rebinding between
// validation and connection.
export function createSafeLookup(policy, resolve = dns.lookup) {
  return function safeLookup(hostname, options, callback) {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!addresses?.length)
        return callback(Object.assign(new Error('No address'), { code: 'ENOTFOUND' }));

      try {
        for (const { address } of addresses) assertAddressAllowed(address, policy);
      } catch (blocked) {
        return callback(blocked);
      }

      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
