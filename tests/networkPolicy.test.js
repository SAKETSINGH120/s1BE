import { describe, expect, it } from 'vitest';
import {
  assertIpLiteralAllowed,
  classifyAddress,
  createSafeLookup,
  parseTargetUrl,
} from '../src/services/execution/networkPolicy.js';

describe('classifyAddress', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],
    ['2606:4700:4700::1111', 'public'],
    ['127.0.0.1', 'private'],
    ['127.255.255.254', 'private'],
    ['10.12.0.1', 'private'],
    ['172.16.5.4', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['169.254.169.254', 'blocked'],
    ['100.100.100.200', 'blocked'],
    ['fd00:ec2::254', 'blocked'],
    ['0.0.0.0', 'blocked'],
    ['::', 'blocked'],
    ['fe80::1', 'blocked'],
    ['224.0.0.1', 'blocked'],
    ['255.255.255.255', 'blocked'],
    ['::ffff:127.0.0.1', 'blocked'],
    ['::127.0.0.1', 'blocked'],
    ['::7f00:1', 'blocked'],
    ['::a00:1', 'blocked'],
    ['::ffff:8.8.8.8', 'blocked'],
    ['64:ff9b::7f00:1', 'blocked'],
    ['2002:7f00:1::', 'blocked'],
    ['not-an-ip', 'blocked'],
  ])('%s is %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  it('keeps 172.15.x and 172.32.x public (outside 172.16.0.0/12)', () => {
    expect(classifyAddress('172.15.0.1')).toBe('public');
    expect(classifyAddress('172.32.0.1')).toBe('public');
  });
});

describe('parseTargetUrl', () => {
  it.each(['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com', 'data:text/plain,x'])(
    'rejects %s',
    (url) => {
      expect(() => parseTargetUrl(url)).toThrow(expect.objectContaining({ status: 400 }));
    },
  );

  it('rejects credentials in the URL', () => {
    expect(() => parseTargetUrl('https://user:pass@example.com')).toThrow(
      expect.objectContaining({ code: 'INVALID_URL' }),
    );
  });

  it.each([
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data/',
  ])('blocks the IP literal in %s', (url) => {
    expect(() =>
      assertIpLiteralAllowed(parseTargetUrl(url), { allowPrivateNetworks: false }),
    ).toThrow(expect.objectContaining({ code: 'DESTINATION_BLOCKED' }));
  });

  it('keeps metadata blocked when private networks are allowed', () => {
    const url = parseTargetUrl('http://169.254.169.254/');
    expect(() => assertIpLiteralAllowed(url, { allowPrivateNetworks: true })).toThrow();
    expect(() =>
      assertIpLiteralAllowed(parseTargetUrl('http://127.0.0.1/'), { allowPrivateNetworks: true }),
    ).not.toThrow();
  });
});

describe('createSafeLookup', () => {
  const resolverReturning = (addresses) => (hostname, options, callback) =>
    callback(null, addresses);

  function lookup(addresses, options = {}) {
    const safeLookup = createSafeLookup(
      { allowPrivateNetworks: false },
      resolverReturning(addresses),
    );
    return new Promise((resolve, reject) => {
      safeLookup('example.test', options, (error, address, family) =>
        error ? reject(error) : resolve({ address, family }),
      );
    });
  }

  it('returns a public address', async () => {
    await expect(lookup([{ address: '93.184.216.34', family: 4 }])).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    });
  });

  it('returns all addresses when asked', async () => {
    const addresses = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ];
    await expect(lookup(addresses, { all: true })).resolves.toEqual({
      address: addresses,
      family: undefined,
    });
  });

  it('rejects a host that resolves to a private address (DNS rebinding)', async () => {
    await expect(lookup([{ address: '10.0.0.5', family: 4 }])).rejects.toMatchObject({
      code: 'DESTINATION_BLOCKED',
    });
  });

  it('rejects a host if any resolved address is private', async () => {
    await expect(
      lookup([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
  });
});
