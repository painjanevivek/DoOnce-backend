import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { RE2JS } from "re2js";

export type HostResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const defaultResolver: HostResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export async function assertPublicWorkflowUrl(
  url: URL,
  allowedDomains: readonly string[],
  resolve: HostResolver = defaultResolver,
): Promise<void> {
  if (["about:", "blob:", "data:"].includes(url.protocol)) return;
  if (url.protocol !== "https:") throw new Error("Hosted navigation requires HTTPS.");
  const hostname = url.hostname.toLowerCase();
  if (!allowedDomains.some((domain) => hostname === domain.toLowerCase())) {
    throw new Error("Hosted navigation left the exact approved domain.");
  }
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Hosted navigation resolved to a private or reserved network.");
  }
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]!;
  if (normalized.startsWith("::ffff:")) return isPublicIpv4(normalized.slice(7));
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  return normalized !== "::" && normalized !== "::1"
    && !normalized.startsWith("fc") && !normalized.startsWith("fd")
    && !/^fe[89ab]/.test(normalized)
    && !normalized.startsWith("ff")
    && !normalized.startsWith("2001:db8:");
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [first, second, third] = octets as [number, number, number, number];
  return first !== 0 && first !== 10 && first !== 127 && first < 224
    && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && second === 0 && third === 0)
    && !(first === 192 && second === 0 && third === 2)
    && !(first === 192 && second === 168)
    && !(first === 198 && (second === 18 || second === 19))
    && !(first === 198 && second === 51 && third === 100)
    && !(first === 203 && second === 0 && third === 113);
}

export function compileBoundedPattern(pattern: string): RE2JS {
  if (pattern.length === 0 || pattern.length > 256) throw new Error("The comparison pattern is outside the supported bound.");
  return RE2JS.compile(pattern);
}
