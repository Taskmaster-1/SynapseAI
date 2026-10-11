import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Outbound fetch for URLs chosen by users or models (web_fetch, MCP server URLs).
 * Blocks private, loopback, link-local and metadata addresses, and re-checks every
 * redirect hop. Self-hosters reaching local MCP servers can set
 * SYNAPSE_ALLOW_PRIVATE_NETWORK=true.
 *
 * Note: resolution and connection are separate steps, so a hostile DNS server could
 * rebind between them; run behind an egress proxy if that matters to you.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export class BlockedUrlError extends Error {}

export function allowPrivateNetwork(): boolean {
  return process.env.SYNAPSE_ALLOW_PRIVATE_NETWORK === "true";
}

export function isBlockedAddress(address: string): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked as the IPv4 address it maps to.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isBlockedAddress(mapped[1]!);
  if (/^::ffff:/i.test(address)) return true; // hex-form mapped addresses: refuse outright
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BlockedUrlError(`unsupported protocol ${url.protocol}`);
  }
  if (url.username || url.password)
    throw new BlockedUrlError("credentials in URLs are not allowed");
  if (allowPrivateNetwork()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new BlockedUrlError(`${url.hostname} resolves to a private or reserved address`);
  }
  return url;
}

export async function guardedFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let url = await assertPublicUrl(input instanceof Request ? input.url : input);
  let request = input instanceof Request ? input : undefined;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = request
      ? await fetch(new Request(url.toString(), request), { ...init, redirect: "manual" })
      : await fetch(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400 || !response.headers.get("location"))
      return response;
    url = await assertPublicUrl(new URL(response.headers.get("location")!, url));
    request = undefined;
    init = { ...init, method: "GET", body: undefined };
  }
  throw new BlockedUrlError("too many redirects");
}
