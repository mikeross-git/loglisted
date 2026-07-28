import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { AuthorizationError } from "./errors.js";

export interface TrustedProxyOptions {
  trustedProxyIps: readonly string[];
  trustedProxyHops?: number;
}

export function normalizeIp(input: string): string {
  let value = input.trim().toLowerCase();
  if (value.startsWith("::ffff:") && isIP(value.slice(7)) === 4) value = value.slice(7);
  const zoneIndex = value.indexOf("%");
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);
  if (isIP(value) === 0) throw new AuthorizationError("Client IP address is invalid.");
  return value;
}

export function resolveClientIp(
  directIp: string,
  forwardedFor: string | null,
  options: TrustedProxyOptions,
): string {
  const direct = normalizeIp(directIp);
  if (!options.trustedProxyIps.map(normalizeIp).includes(direct) || !forwardedFor) return direct;
  const chain = forwardedFor.split(",").map(normalizeIp);
  const trustedHops = options.trustedProxyHops ?? 1;
  const selected = chain[chain.length - trustedHops];
  if (!selected) throw new AuthorizationError("Forwarded IP chain is invalid.");
  return selected;
}

export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`ip:v1:${normalizeIp(ip)}`)
    .digest("hex");
}
