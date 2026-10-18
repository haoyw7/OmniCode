import { networkInterfaces } from "node:os";

export type PairingHostCandidate = {
  url: string;
  kind: "tailscale" | "lan";
  /** This Host answered through the address with its own environment. */
  reachable: boolean;
};

/** Container and VM bridges a phone cannot reach. */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|podman|lxc|lxd|vethernet)/i;

function isTailscaleAddress(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/** Non-loopback IPv4 addresses of this computer's physical and VPN adapters. */
export function adapterAddresses(): string[] {
  const addresses: string[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries ?? [])
      // 169.254.* is link-local: assigned when an adapter has no network.
      if (!entry.internal && entry.family === "IPv4" && !entry.address.startsWith("169.254.") && !addresses.includes(entry.address))
        addresses.push(entry.address);
  }
  return addresses;
}

/** Whether `url` reaches this same Host, proven by its environment identity. */
async function reachesHost(
  url: string,
  token: string,
  protocolVersion: number,
  environmentId: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: protocolVersion, method: "environment.describe", params: {} }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { result?: { environmentId?: unknown } };
    return result.result?.environmentId === environmentId;
  } catch {
    return false;
  }
}

/** Adapter addresses for pairing, each verified against this Host. */
export async function pairingHostCandidates(input: {
  port: number;
  token: string;
  protocolVersion: number;
  environmentId: string;
}): Promise<PairingHostCandidate[]> {
  const candidates = await Promise.all(
    adapterAddresses().map(async (address): Promise<PairingHostCandidate> => {
      const url = `http://${address}:${input.port}`;
      return {
        url,
        kind: isTailscaleAddress(address) ? "tailscale" : "lan",
        reachable: await reachesHost(url, input.token, input.protocolVersion, input.environmentId),
      };
    }),
  );
  return candidates.sort((a, b) => Number(b.reachable) - Number(a.reachable));
}
