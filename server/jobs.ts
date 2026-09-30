import crypto from 'crypto';
import { parseBuffer } from 'music-metadata';
import { getSupabaseAdmin } from './auth.js';
import { parseMIDIFile } from '../src/utils/midiParser.js';

export const CREDITS_PER_SECOND = 1;
export const MAX_SECONDS = 900;

export interface StartJobParams {
  userId: string;
  sourceName: string;
  seconds: number;
}

export type StartJobResult =
  | { ok: true; jobId: string; cost: number }
  | { ok: false; reason: 'insufficient_credits' };

export interface TranscriptionJobRow {
  id: string;
  user_id: string;
  source_name: string;
  audio_seconds: number;
  credits_reserved: number;
  status: string;
  mirelo_job_id?: string | null;
  note_count?: number | null;
  tempo_bpm?: number | null;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
}

/**
 * Reads the duration of an audio buffer in seconds using music-metadata.
 * Throws friendly user-facing errors if unreadable or exceeds limit.
 */
export async function getAudioSeconds(buffer: Buffer, mime?: string): Promise<number> {
  let metadata;
  try {
    metadata = await parseBuffer(buffer, mime ? { mimeType: mime } : undefined, { duration: true });
  } catch (_err) {
    throw new Error("We couldn't read the length of this audio.");
  }

  const duration = metadata.format.duration;
  if (typeof duration !== 'number' || isNaN(duration) || duration <= 0) {
    throw new Error("We couldn't read the length of this audio.");
  }

  if (duration > MAX_SECONDS) {
    throw new Error("Songs can be up to 15 minutes long.");
  }

  return duration;
}

/**
 * Calculates credit cost for a given audio duration in seconds.
 */
export function costForSeconds(seconds: number): number {
  return Math.ceil(seconds * CREDITS_PER_SECOND);
}

/**
 * Inserts a new transcription_jobs record and reserves credits via RPC.
 * If insufficient credits or RPC error occurs, the job row is deleted.
 */
export async function startJob({
  userId,
  sourceName,
  seconds,
}: StartJobParams): Promise<StartJobResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Service is temporarily unavailable.");
  }

  const cost = costForSeconds(seconds);
  const roundedSeconds = Math.round(seconds * 100) / 100;
  const truncatedName = (sourceName || 'Audio').slice(0, 200);

  const { data: job, error: insertError } = await supabase
    .from('transcription_jobs')
    .insert({
      user_id: userId,
      source_name: truncatedName,
      audio_seconds: roundedSeconds,
      credits_reserved: cost,
      status: 'created',
    })
    .select('id')
    .single();

  if (insertError || !job) {
    throw new Error("Unable to start transcription job.");
  }

  const jobId = job.id;

  try {
    const { data: reserved, error: rpcError } = await supabase.rpc('reserve_credits', {
      p_user_id: userId,
      p_amount: cost,
      p_job_id: jobId,
    });

    if (rpcError) {
      await supabase.from('transcription_jobs').delete().eq('id', jobId);
      throw new Error("Unable to reserve transcription credits.");
    }

    if (!reserved) {
      await supabase.from('transcription_jobs').delete().eq('id', jobId);
      return { ok: false, reason: 'insufficient_credits' };
    }

    return { ok: true, jobId, cost };
  } catch (err: any) {
    try {
      await supabase.from('transcription_jobs').delete().eq('id', jobId);
    } catch (_delErr) {}
    if (err.message && err.message.includes('reserve')) {
      throw err;
    }
    throw new Error("Unable to start transcription job.");
  }
}

/**
 * Associates an upstream Mirelo job ID with the persistent job and marks status 'processing'.
 */
export async function attachMireloJob(jobId: string, mireloJobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Service is temporarily unavailable.");
  }

  const { error } = await supabase
    .from('transcription_jobs')
    .update({
      mirelo_job_id: mireloJobId,
      status: 'processing',
    })
    .eq('id', jobId);

  if (error) {
    throw new Error("Unable to link transcription job.");
  }
}

/**
 * Marks a job as failed (if still in created/uploading/processing) and refunds credits via RPC.
 * Safe to call multiple times.
 */
export async function failJob(jobId: string, userId: string, message: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const safeMessage = (message || 'Transcription failed').slice(0, 200);

  // (a) read the job's current status; if it is not created/uploading/processing, return;
  const { data: job, error: fetchError } = await supabase
    .from('transcription_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle();

  if (fetchError || !job) {
    return;
  }

  const validStatuses = ['created', 'uploading', 'processing'];
  if (!validStatuses.includes(job.status)) {
    return;
  }

  // (b) call rpc('refund_credits') and check { error }; if there is an error, log the job id and THROW, leaving the status unchanged so the sweeper retries;
  const { error: rpcError } = await supabase.rpc('refund_credits', {
    p_user_id: userId,
    p_job_id: jobId,
  });

  if (rpcError) {
    console.error(`[Jobs:Refund] Failed to refund credits for job ${jobId}`);
    throw new Error("Unable to refund credits.");
  }

  // (c) only then update status to 'failed' with the guard on the previous statuses.
  const { error: updateError } = await supabase
    .from('transcription_jobs')
    .update({
      status: 'failed',
      error_message: safeMessage,
    })
    .eq('id', jobId)
    .in('status', ['created', 'uploading', 'processing']);

  if (updateError) {
    console.error(`[Jobs:Status] Failed to update status to failed for job ${jobId}`);
  }
}

/**
 * Retrieves the newest transcription_jobs row matching the user ID and Mirelo job ID, or null.
 */
export async function getOwnedJob(
  userId: string,
  mireloJobId: string
): Promise<TranscriptionJobRow | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('transcription_jobs')
    .select('*')
    .eq('user_id', userId)
    .eq('mirelo_job_id', mireloJobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as TranscriptionJobRow;
}

/**
 * Completes a job idempotently:
 * - If already succeeded, returns immediately.
 * - Parses MIDI for note count and tempo; if 0 notes, fails job.
 * - Uploads .mid to storage bucket 'midi-files' at `${userId}/${job.id}.mid`.
 * - Upserts midi_files table row.
 * - Updates transcription_jobs status to 'succeeded' and finalizes credits.
 */
export async function completeJob(
  job: TranscriptionJobRow,
  midiBuffer: Buffer
): Promise<void> {
  if (job.status === 'succeeded') {
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Service is temporarily unavailable.");
  }

  const arrayBuffer = midiBuffer.buffer.slice(
    midiBuffer.byteOffset,
    midiBuffer.byteOffset + midiBuffer.byteLength
  ) as ArrayBuffer;

  let parsed: any;
  try {
    parsed = parseMIDIFile(arrayBuffer, job.source_name || 'Transcription');
  } catch (_err) {
    await failJob(job.id, job.user_id, "We were unable to process the notes in this audio.");
    return;
  }

  const noteCount = parsed.notes ? parsed.notes.length : 0;
  const bpm = parsed.bpm ? Math.round(parsed.bpm) : null;

  if (noteCount === 0) {
    await failJob(job.id, job.user_id, "No notes could be found in this audio.");
    return;
  }

  const sha256 = crypto.createHash('sha256').update(midiBuffer).digest('hex');
  const storagePath = `${job.user_id}/${job.id}.mid`;

  // 1. Upload buffer to storage bucket 'midi-files'
  const { error: storageError } = await supabase.storage
    .from('midi-files')
    .upload(storagePath, midiBuffer, {
      contentType: 'audio/midi',
      upsert: true,
    });

  if (storageError) {
    console.error(`[Jobs:Storage] Upload failed for job ${job.id}`);
    throw new Error("We couldn't save your MIDI right now. Please try again.");
  }

  // 2. Upsert midi_files row
  const { error: midiFileError } = await supabase
    .from('midi_files')
    .upsert(
      {
        job_id: job.id,
        user_id: job.user_id,
        storage_path: storagePath,
        size_bytes: midiBuffer.byteLength,
        note_count: noteCount,
        sha256,
      },
      { onConflict: 'job_id' }
    );

  if (midiFileError) {
    console.error(`[Jobs:DB] midi_files upsert failed for job ${job.id}`);
    throw new Error("We couldn't save your MIDI right now. Please try again.");
  }

  // 3. Update status to succeeded ONLY if still in created/uploading/processing
  const now = new Date().toISOString();
  const { data: updatedRows, error: updateError } = await supabase
    .from('transcription_jobs')
    .update({
      status: 'succeeded',
      note_count: noteCount,
      tempo_bpm: bpm,
      completed_at: now,
    })
    .eq('id', job.id)
    .in('status', ['created', 'uploading', 'processing'])
    .select('id, credits_reserved');

  if (updateError || !updatedRows || updatedRows.length === 0) {
    return;
  }

  const creditsToFinalize = updatedRows[0].credits_reserved ?? job.credits_reserved;
  const { error: finalizeError } = await supabase.rpc('finalize_job_credits', {
    p_user_id: job.user_id,
    p_job_id: job.id,
    p_final: creditsToFinalize,
  });

  if (finalizeError) {
    console.error(`[Jobs:Credits] finalize_job_credits failed for job ${job.id}`);
  }
}

/**
 * Finds jobs in created/uploading/processing older than 30 minutes and fails + refunds each.
 */
export async function sweepStaleJobs(): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: staleJobs, error } = await supabase
    .from('transcription_jobs')
    .select('id, user_id')
    .in('status', ['created', 'uploading', 'processing'])
    .lt('created_at', thirtyMinutesAgo);

  if (error || !staleJobs || staleJobs.length === 0) {
    return;
  }

  for (const job of staleJobs) {
    try {
      await failJob(job.id, job.user_id, "Job timed out before completion.");
    } catch (_err) {
      // Continue sweeping remaining jobs
    }
  }
}
