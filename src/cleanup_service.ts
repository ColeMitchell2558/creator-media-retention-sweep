import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, infrai } from "./infrai_client.js";
import {
  mediaRecordSchema,
  type MediaRecord,
  selectExpiredAssetKeys,
  sweepRequestSchema,
} from "./media_retention.js";

const port = Number(process.env.PORT ?? "3000");
const bucket = process.env.MEDIA_BUCKET ?? "creator-deliveries";
const retentionDays = Number(process.env.RETENTION_DAYS ?? "30");
const records = new Map<string, MediaRecord>();

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/media-records") {
    try {
      const record = mediaRecordSchema.parse(await readJson(request));
      records.set(record.asset_key, record);
      sendJson(response, 202, { accepted: true, asset_key: record.asset_key });
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        sendJson(response, 400, { error: "invalid_media_record" });
        return;
      }
      sendJson(response, 500, { error: "record_ingestion_failed" });
    }
    return;
  }

  if (request.method !== "POST" || request.url !== "/sweeps/media-retention") {
    sendJson(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const observedAt = new Date();
    const body = sweepRequestSchema.parse({
      sweep_id: `media-retention-${observedAt.toISOString().slice(0, 10)}`,
      bucket,
      retention_days: retentionDays,
      observed_at: observedAt.toISOString(),
      records: [...records.values()],
    });
    const deletedKeys = selectExpiredAssetKeys(body);

    if (deletedKeys.length > 0) {
      await infrai.storage.object.delete_batch(body.bucket, deletedKeys, `sweep:${body.sweep_id}`);
      for (const key of deletedKeys) records.delete(key);
    }

    sendJson(response, 200, {
      sweep_id: body.sweep_id,
      examined: body.records.length,
      deleted_count: deletedKeys.length,
      deleted_keys: deletedKeys,
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      sendJson(response, 400, { error: "invalid_sweep_request" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      sendJson(response, status, { error: error.code });
      return;
    }
    sendJson(response, 500, { error: "cleanup_failed" });
  }
});

await infrai.storage.bucket.create(bucket, `bucket:${bucket}`);

server.listen(port, () => {
  console.log(`media retention service listening on http://localhost:${port}`);
});
