"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { SAFE_MANUAL_JOB_TYPES } from "@/domain/data-operations";

export type QueueState = { status: "idle" | "success" | "error"; message: string };

export async function queueIngestionJob(_previous: QueueState, formData: FormData): Promise<QueueState> {
  const configuredToken = process.env.DATA_OPERATIONS_OPERATOR_TOKEN;
  const suppliedToken = String(formData.get("operatorToken") ?? "");
  const jobKey = String(formData.get("jobKey") ?? "");
  if (!configuredToken) return { status: "error", message: "Manual queueing is disabled until DATA_OPERATIONS_OPERATOR_TOKEN is configured." };
  if (!suppliedToken || suppliedToken !== configuredToken) return { status: "error", message: "Invalid operator token." };
  if (!jobKey || jobKey.length > 120) return { status: "error", message: "Invalid job key." };
  const db = createServiceClient();
  const { data: job, error: readError } = await db.from("scheduled_jobs").select("id,job_type,locked_at,enabled").eq("job_key", jobKey).maybeSingle();
  if (readError || !job) return { status: "error", message: "Job not found." };
  if (!SAFE_MANUAL_JOB_TYPES.has(job.job_type)) return { status: "error", message: "This job is not permitted for manual ingestion." };
  if (!job.enabled) return { status: "error", message: "The job is paused." };
  if (job.locked_at) return { status: "error", message: "The job is already running." };
  const now = new Date().toISOString();
  const { error } = await db.from("scheduled_jobs").update({ next_run_at: now, updated_at: now }).eq("id", job.id).is("locked_at", null);
  if (error) return { status: "error", message: "Could not queue the ingestion job." };
  revalidatePath("/data-collection");
  return { status: "success", message: `${jobKey} queued for the next scheduler cycle.` };
}
