import { z } from "zod";

export const mediaRecordSchema = z.object({
  asset_key: z.string().min(1),
  creator_id: z.string().min(1),
  ingestion_state: z.enum(["processing", "ready", "failed"]),
  delivery_state: z.enum(["pending", "delivered"]),
  delivered_at: z.string().datetime().nullable(),
});

export const sweepRequestSchema = z.object({
  sweep_id: z.string().min(1),
  bucket: z.string().min(1),
  retention_days: z.number().int().positive(),
  observed_at: z.string().datetime(),
  records: z.array(mediaRecordSchema),
});

export type MediaRecord = z.infer<typeof mediaRecordSchema>;
export type SweepRequest = z.infer<typeof sweepRequestSchema>;

export function selectExpiredAssetKeys(request: SweepRequest): string[] {
  const cutoff = Date.parse(request.observed_at) - request.retention_days * 86_400_000;

  return request.records
    .filter((record) =>
      record.ingestion_state === "ready"
      && record.delivery_state === "delivered"
      && record.delivered_at !== null
      && Date.parse(record.delivered_at) < cutoff)
    .map((record) => record.asset_key);
}
