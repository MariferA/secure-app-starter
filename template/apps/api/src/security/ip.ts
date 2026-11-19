import { BlockList, isIP } from 'node:net';

export function compileCidrs(cidrs: string[], trustedProxy = false) {
  if (cidrs.length > 32) throw new Error('Too many IP networks');
  const list = new BlockList();
  for (const entry of cidrs) {
    const [address, mask, extra] = entry.trim().split('/');
    const family = isIP(address || '');
    if (!family || extra !== undefined || (mask !== undefined && !/^\d{1,3}$/.test(mask)))
      throw new Error('Invalid IP/CIDR');
    const prefix = mask === undefined ? (family === 4 ? 32 : 128) : Number(mask);
    if (
      prefix < 0 ||
      prefix > (family === 4 ? 32 : 128) ||
      (trustedProxy && prefix < (family === 4 ? 24 : 64))
    )
      throw new Error('Invalid or overly broad proxy network');
    list.addSubnet(address!, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return (address: string) => {
    const normalized =
      address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
    const family = isIP(normalized);
    return Boolean(family && list.check(normalized, family === 4 ? 'ipv4' : 'ipv6'));
  };
}
