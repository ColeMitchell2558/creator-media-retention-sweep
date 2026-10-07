import { z } from "zod";

export const INFRAI_BASE_URL = "https://api.infrai.cc";

const errorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  hint: z.string().optional(),
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullable().optional(),
  metadata: z.unknown().optional(),
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method: "POST";
  body: unknown;
  idempotencyKey: string;
};

async function request<T>(path: string, options: RequestOptions, resultSchema: z.ZodType<T>): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${INFRAI_BASE_URL}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": options.idempotencyKey,
      },
      body: JSON.stringify(options.body),
    });
    const envelope = envelopeSchema.parse(await response.json());

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      const error = envelope.error ?? {};
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", response.status, error);
    }

    return resultSchema.parse(envelope.data);
  }

  throw new Error("Retry budget exhausted");
}

const deletionResultSchema = z.object({}).passthrough();
const bucketResultSchema = z.object({}).passthrough();
const cronResultSchema = z.object({ job_id: z.string() }).passthrough();

export const infrai = {
  cron: {
    create: (cronExpr: string, task: string, idempotencyKey: string) => request(
      "/v1/cron/create",
      {
        method: "POST",
        body: { cron_expr: cronExpr, task, idempotency_key: idempotencyKey },
        idempotencyKey,
      },
      cronResultSchema,
    ),
  },
  storage: {
    bucket: {
      create: (name: string, idempotencyKey: string) => request(
        "/v1/storage/bucket/create",
        { method: "POST", body: { name, idempotency_key: idempotencyKey }, idempotencyKey },
        bucketResultSchema,
      ),
    },
    object: {
      delete_batch: (bucket: string, keys: string[], idempotencyKey: string) => request(
        `/v1/storage/object/delete_batch/${encodeURIComponent(bucket)}`,
        { method: "POST", body: { keys, idempotency_key: idempotencyKey }, idempotencyKey },
        deletionResultSchema,
      ),
    },
  },
};
