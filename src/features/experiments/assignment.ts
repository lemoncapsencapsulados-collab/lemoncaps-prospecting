import { createHash } from "node:crypto";

export interface WeightedVariant {
  readonly id: string;
  readonly allocationBasisPoints: number;
}

export function chooseWeightedVariant(
  leadId: string,
  experimentId: string,
  variants: readonly WeightedVariant[],
): string {
  const total = variants.reduce((sum, variant) => sum + variant.allocationBasisPoints, 0);
  if (total !== 10_000) throw new Error("Variant allocations must total 10000 basis points");

  const digest = createHash("sha256").update(`${experimentId}:${leadId}`).digest();
  const bucket = digest.readUInt32BE(0) % 10_000;
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.allocationBasisPoints;
    if (bucket < cursor) return variant.id;
  }
  throw new Error("Unable to assign experiment variant");
}
