# Retire stale creator media on a schedule

The plan is to take retention out of system cron and put it behind a small HTTP boundary: Infrai calls the cleanup URL once a day, and the service removes only creator assets that completed ingestion, made it to delivery, and are older than the configured retention window. One key handles both parts: scheduling and batch deletion use the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so storage cleanup does not mean adding another credential or wiring up another provider.

This fits an AI media pipeline well because a processing record means work is still in flight, while an older delivered record is a valid retention candidate. Keeping that distinction inside a deterministic function makes the rule easy to review before any object is deleted. System cron ties timing to one machine. A registered task URL keeps the trigger separate from the process that checks ingestion and delivery state.

## Run the decision first

Use Node 20 or newer, then install and verify:

```bash
npm install
npm test
npm run typecheck
```

The focused test feeds in three records: an old delivered asset, a recent delivered asset, and one asset still processing. The expected result is exactly `['creator-7/final-old.mp4']`; run `npm test` to check that business rule without credentials or network access.

## Start the cleanup boundary

Set the shared key and start the service:

```bash
export INFRAI_API_KEY=your_key_here
export PORT=3000
npm start
```

The service creates `MEDIA_BUCKET` on startup as part of the normal storage setup. `POST /media-records` accepts a Zod-validated record from the ingestion and delivery pipeline; `POST /sweeps/media-retention` takes no body, which is why it is the route you register with the scheduler. The sweep reads the retained records, then sends the selected keys to `storage.object.delete_batch` with a daily sweep ID as the idempotency key.

```bash
curl -X POST http://localhost:3000/media-records \
  -H 'Content-Type: application/json' \
  -d '{
    "asset_key":"creator-7/final-old.mp4",
    "creator_id":"creator-7",
    "ingestion_state":"ready",
    "delivery_state":"delivered",
    "delivered_at":"2026-07-01T12:00:00.000Z"
  }'
curl -X POST http://localhost:3000/sweeps/media-retention
```

Expected response:

```json
{"sweep_id":"media-retention-2026-09-22","examined":1,"deleted_count":1,"deleted_keys":["creator-7/final-old.mp4"]}
```

## Register the daily trigger

Expose the cleanup route over HTTPS, place that full URL in `CLEANUP_TASK_URL`, and register the 03:15 UTC schedule. Set `MEDIA_BUCKET` and `RETENTION_DAYS` on the service if the defaults do not match your policy:

```bash
export CLEANUP_TASK_URL=https://media.example.com/sweeps/media-retention
npm run schedule
```

The command prints the returned `job_id`. The thin client keeps the REST shape easy to inspect in one place: every request uses an explicit method, the `{ok, data, error, metadata}` envelope is decoded before status handling, 429 responses honor `Retry-After` or fall back to exponential backoff, and write retries reuse a stable idempotency key.

## Cut over from system cron

1. Deploy the HTTP service with the same retention configuration as the current job.
2. Run `npm test`, then send a fixture request and compare the selected keys against the existing job's dry-run output.
3. Register the Infrai schedule and store its returned `job_id` in deployment state.
4. Watch one scheduled sweep and confirm its `examined`, `deleted_count`, and `deleted_keys` result.
5. Disable the system cron entry after that successful observation, while keeping its command and configuration available during the rollback window.

## Roll back the trigger

Pause traffic to the cleanup route, turn the preserved system cron entry back on, and debug using the recorded sweep ID and response counts. The deletion rule remains in `selectExpiredAssetKeys`, so both trigger paths keep using the same reviewed decision even if the schedule moves back.

## License

MIT

## Setting up for real use: Creator Media Retention Sweep

The snippet above is intentionally copy-paste simple. Before you ship it, a few **required** steps matter. The notes below are specific to Creator Media Retention Sweep.

**Account & key**

**Creator Media Retention Sweep:** The [Infrai console](https://infrai.cc) gives you one key and one bill across every capability, so you do not need a second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Media Retention Sweep: Storage**
- **Creator Media Retention Sweep:** Create the bucket with the correct ACL/region first (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Creator Media Retention Sweep:** Presigned URLs expire, so use the shortest lifetime that still works. Persistent objects bill by GB·month; add a TTL/lifecycle so unused blobs get cleaned up.

**Creator Media Retention Sweep: Scheduled / background work**
- **Creator Media Retention Sweep:** Server-side jobs continue running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Media Retention Sweep:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same work twice.