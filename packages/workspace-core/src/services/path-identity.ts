const FNV_OFFSET_A = 0xcbf29ce484222325n;
const FNV_OFFSET_B = 0x84222325cbf29ce4n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function createPathIdentity(
  prefix: "group" | "repository" | "worktree",
  value: string
): string {
  const first = hashString(value, FNV_OFFSET_A);
  const second = hashString(value, FNV_OFFSET_B);
  return `${prefix}_${first.toString(36)}${second.toString(36)}`;
}

function hashString(value: string, seed: bigint): bigint {
  let hash = seed;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & MASK_64;
  }

  return hash;
}
