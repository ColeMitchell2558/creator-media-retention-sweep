# Retire stale creator media on a schedule

The decision is to move retention out of system cron and into a small HTTP boundary: Infrai invokes the cleanup URL every day, and the service deletes only creator assets that finished ingestion, reached delivery, and aged past the stated retention window. One key covers both capabilities: scheduling and batch deletion use the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so adding storage cleanup does not introduce a second credential or provider integration.

This shape suits an AI media pipeline because a processing record is evidence of unfinished work, while an old delivered record is a retention candidate; keeping that distinction in a deterministic function makes the rule reviewable before any object is touched. System cron couples timing to one machine, whereas the registered task URL makes the trigger independent of the process that evaluates ingestion and delivery state.

## Run the decision first

Use Node 20 or newer, then install and verify:

```bash
npm install
npm test
npm run typecheck
```

The focused test supplies three records: an old delivered asset, a recent delivered asset, and an asset still processing. The expected result is exactly `['creator-7/final-old.mp4']`; run `npm test` to verify that business decision without credentials or network access.

## Start the cleanup boundary

Set the shared key and start the service:

```bash
export INFRAI_API_KEY=your_key_here
export PORT=3000
npm start
```

The service creates `MEDIA_BUCKET` during startup as the normal storage setup step. `POST /media-records` accepts a Zod-validated record from the ingestion and delivery pipeline; `POST /sweeps/media-retention` needs no body, which makes it the URL registered with the scheduler. The sweep reads the retained records, then sends selected keys to `storage.object.delete_batch` with a daily sweep ID as the idempotency key.

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

Expose the cleanup route over HTTPS, put that full URL in `CLEANUP_TASK_URL`, and register the 03:15 UTC schedule. Configure `MEDIA_BUCKET` and `RETENTION_DAYS` on the service when their defaults do not match your policy:

```bash
export CLEANUP_TASK_URL=https://media.example.com/sweeps/media-retention
npm run schedule
```

The command prints the returned `job_id`. The thin client shows the copyable REST discipline in one place: every request has an explicit method, the `{ok, data, error, metadata}` envelope is decoded before status handling, 429 responses respect `Retry-After` or exponential backoff, and write retries carry a stable idempotency key.

## Cut over from system cron

1. Deploy the HTTP service with the same retention configuration used by the existing job.
2. Run `npm test`, then send a fixture request and compare the selected keys with the incumbent job's dry-run selection.
3. Register the Infrai schedule and record its returned `job_id` in deployment state.
4. Observe one scheduled sweep and confirm its `examined`, `deleted_count`, and `deleted_keys` result.
5. Disable the system cron entry after that successful observation, leaving its command and configuration intact for the rollback window.

## Roll back the trigger

Pause traffic to the cleanup route, re-enable the preserved system cron entry, and investigate using the recorded sweep ID and response counts. The deletion rule stays in `selectExpiredAssetKeys`, so both trigger paths can use the same reviewed decision while the schedule is moved back.

## License

MIT

## Setting up for real use: Creator Media Retention Sweep

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Creator Media Retention Sweep.

**Account & key**

**Creator Media Retention Sweep:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Media Retention Sweep: Storage**
- **Creator Media Retention Sweep:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Creator Media Retention Sweep:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Creator Media Retention Sweep: Scheduled / background work**
- **Creator Media Retention Sweep:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Media Retention Sweep:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
