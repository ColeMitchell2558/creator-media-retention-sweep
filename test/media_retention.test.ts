import assert from "node:assert/strict";
import test from "node:test";
import { selectExpiredAssetKeys, sweepRequestSchema } from "../src/media_retention.js";

test("deletes only ready, delivered assets older than retention", () => {
  const request = sweepRequestSchema.parse({
    sweep_id: "sweep-2026-09-22",
    bucket: "creator-deliveries",
    retention_days: 30,
    observed_at: "2026-09-22T03:15:00.000Z",
    records: [
      { asset_key: "creator-7/final-old.mp4", creator_id: "creator-7", ingestion_state: "ready", delivery_state: "delivered", delivered_at: "2026-07-01T12:00:00.000Z" },
      { asset_key: "creator-7/final-new.mp4", creator_id: "creator-7", ingestion_state: "ready", delivery_state: "delivered", delivered_at: "2026-09-10T12:00:00.000Z" },
      { asset_key: "creator-8/rendering.mp4", creator_id: "creator-8", ingestion_state: "processing", delivery_state: "pending", delivered_at: null },
    ],
  });

  assert.deepEqual(selectExpiredAssetKeys(request), ["creator-7/final-old.mp4"]);
});
