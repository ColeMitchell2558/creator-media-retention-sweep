import { infrai } from "./infrai_client.js";

const taskUrl = process.env.CLEANUP_TASK_URL;
if (!taskUrl) throw new Error("CLEANUP_TASK_URL is required");

const job = await infrai.cron.create("15 3 * * *", taskUrl, `media-retention:${taskUrl}`);
console.log(JSON.stringify({ scheduled: true, job_id: job.job_id }));
