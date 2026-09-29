import { 
  NormalizedTranscription, 
  TranscriptionProgress, 
  ServerConfigResponse,
  normalizedNotesToMIDINotes
} from '../types/transcription';
import { MIDINote, Song } from '../data/sampleSongs';

/**
 * Checks server configuration and whether MIRELO_API_KEY is configured.
 */
export async function checkMireloServerConfig(): Promise<ServerConfigResponse> {
  try {
    const res = await fetch('/api/transcribe/config');
    if (!res.ok) {
      return {
        hasApiKey: false,
        provider: 'Mirelo Audio-to-MIDI Pro',
        baseUrl: 'https://api.mirelo.ai',
        model: 'Audio-to-MIDI Pro',
      };
    }
    return await res.json();
  } catch (_) {
    return {
      hasApiKey: false,
      provider: 'Mirelo Audio-to-MIDI Pro',
      baseUrl: 'https://api.mirelo.ai',
      model: 'Audio-to-MIDI Pro',
    };
  }
}

/**
 * Submits an audio recording to the server-side Mirelo endpoint for asynchronous job creation.
 * Returns the created Mirelo jobId in < 3 seconds so the frontend can track and persist it.
 */
export async function submitAudioToMirelo(file: File): Promise<{
  jobId: string;
  status: string;
  fileName: string;
  data?: NormalizedTranscription;
}> {
  const formData = new FormData();
  const safeName = (file.name || 'audio.wav').replace(/[^\w.-]/g, '_');
  formData.append('audio', file, safeName);

  const maxSubmitAttempts = 5;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxSubmitAttempts; attempt++) {
    try {
      const res = await fetch('/api/transcribe/submit', {
        method: 'POST',
        body: formData,
      });

      const rawText = await res.text();
      let data: any = null;

      try {
        data = JSON.parse(rawText);
      } catch (_) {
        if (rawText.includes('<!DOCTYPE') || rawText.includes('<html') || res.status === 502 || res.status === 503) {
          if (attempt < maxSubmitAttempts) {
            console.warn(`[Mirelo:Submit] Server restarting or returning HTML (attempt ${attempt}/${maxSubmitAttempts}). Retrying in 1.5s...`);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          throw new Error('Server is currently restarting. Please wait a moment and tap "Transcribe Audio File" again.');
        }
        throw new Error(`Server returned invalid response (HTTP ${res.status}): ${rawText.slice(0, 100) || 'Empty body'}`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Server returned ${res.status}: ${res.statusText}`);
      }

      return {
        jobId: data.jobId,
        status: data.status,
        fileName: data.fileName || safeName,
        data: data.data || undefined,
      };
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxSubmitAttempts && (err.message.includes('fetch') || err.message.includes('restarting') || err.message.includes('NetworkError') || err.message.includes('Failed to fetch'))) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Failed to submit audio file after multiple attempts.');
}

export function cleanJobId(rawId?: string | null): string {
  if (!rawId) return '';
  let cleaned = String(rawId).trim();
  while (/^job[:_\s]*/i.test(cleaned)) {
    cleaned = cleaned.replace(/^job[:_\s]*/i, '').trim();
  }
  return cleaned;
}

/**
 * Polls the status of an existing Mirelo job until completion or failure.
 * Retries on transient network drops without creating new jobs or spending credits.
 */
export async function pollMireloJobStatus(
  rawJobId: string,
  fileName: string,
  onProgress?: (p: TranscriptionProgress) => void,
  startTimeMs: number = Date.now()
): Promise<NormalizedTranscription> {
  const jobId = cleanJobId(rawJobId);
  const pollIntervalMs = 2500;
  const maxAttempts = 150; // up to ~6 minutes
  let consecutiveErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsedSec = Math.round((Date.now() - startTimeMs) / 1000);

    try {
      const res = await fetch(`/api/transcribe/status/${encodeURIComponent(jobId)}?fileName=${encodeURIComponent(fileName)}`);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      let rawText = '';
      let json: any = null;
      try {
        rawText = await res.text();
        json = JSON.parse(rawText);
      } catch (_) {
        if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
          throw new Error('Server temporarily reloading (received HTML fallback page)');
        }
        throw new Error(`Invalid server response: ${rawText.slice(0, 100) || 'empty body'}`);
      }
      consecutiveErrors = 0;

      if (!json.success || json.status === 'failed') {
        const errorMsg = json.error || 'Mirelo transcription failed';
        onProgress?.({
          stage: 'error',
          percent: 0,
          message: errorMsg,
          jobId,
          elapsedSec,
        });
        throw new Error(errorMsg);
      }

      if (json.status === 'succeeded' && json.data) {
        const data = json.data as NormalizedTranscription;
        if (json.midiDebug) {
          data.midiDebug = json.midiDebug;
        }
        onProgress?.({
          stage: 'complete',
          percent: 100,
          message: `Transcription complete! ${data.notes.length} notes, ${data.tracks.length} tracks.`,
          jobId,
          elapsedSec,
        });
        return data;
      }

      // In-progress status
      const percent = Math.max(15, Math.min(95, json.progress || (attempt * 2)));
      const stage = json.status === 'queued' ? 'submitting-job' : 'processing';
      const message = json.message || `Mirelo AI analyzing instrument stems & harmony... (${elapsedSec}s)`;

      onProgress?.({
        stage,
        percent,
        message,
        jobId,
        status: json.status,
        elapsedSec,
      });

    } catch (err: any) {
      // Don't count explicit job failures as transient errors
      if (err.message && err.message.includes('Mirelo transcription failed')) {
        throw err;
      }

      consecutiveErrors++;
      console.warn(`[Mirelo:Poll] Network attempt ${attempt} warning for job ${jobId}: ${err.message}`);

      if (consecutiveErrors >= 15) {
        throw new Error(`Connection issue while checking job status: ${err.message}. You can resume tracking job "${jobId}".`);
      }

      const retryMsg = err.message.includes('reloading') || err.message.includes('HTML')
        ? `Server temporarily restarting... Reconnecting status monitor (${elapsedSec}s)`
        : `Mirelo AI processing in background... Reconnecting status monitor (${elapsedSec}s)`;

      onProgress?.({
        stage: 'processing',
        percent: Math.min(90, 20 + attempt * 2),
        message: retryMsg,
        jobId,
        elapsedSec,
      });
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Transcription job ${jobId} timed out after 6 minutes. The job may still finish on Mirelo.`);
}

/**
 * Sends an audio recording to the server-side Mirelo endpoint for asynchronous transcription.
 * Immediately saves the jobId and polls status until completion.
 */
export async function transcribeAudioWithMirelo(
  file: File,
  onProgress: (p: TranscriptionProgress) => void,
  onJobCreated?: (jobId: string, fileName: string) => void
): Promise<NormalizedTranscription> {
  const startTime = Date.now();

  onProgress({
    stage: 'uploading',
    percent: 10,
    message: `Uploading "${file.name}" to Mirelo secure storage...`,
    elapsedSec: 0,
  });

  try {
    // Stage 1: Fast submission
    const submitResult = await submitAudioToMirelo(file);
    const jobId = submitResult.jobId;

    if (onJobCreated) {
      onJobCreated(jobId, file.name);
    }

    onProgress({
      stage: 'submitting-job',
      percent: 25,
      message: `Job ${jobId} queued on Mirelo GPU cluster...`,
      jobId,
      elapsedSec: Math.round((Date.now() - startTime) / 1000),
    });

    // If already normalized immediately
    if (submitResult.data) {
      return submitResult.data;
    }

    // Stage 2: Poll status until complete
    return await pollMireloJobStatus(jobId, file.name, onProgress, startTime);
  } catch (err: any) {
    onProgress({
      stage: 'error',
      percent: 0,
      message: err.message || 'Transcription failed',
    });
    throw err;
  }
}

/**
 * Resumes tracking an existing Mirelo transcription without uploading audio or spending any credits.
 */
export async function resumeMireloJob(
  jobId: string,
  fileName: string = 'Recovered Audio',
  onProgress: (p: TranscriptionProgress) => void
): Promise<NormalizedTranscription> {
  onProgress({
    stage: 'processing',
    percent: 30,
    message: `Reconnecting to existing Mirelo job ${jobId}...`,
    jobId,
    elapsedSec: 0,
  });

  return await pollMireloJobStatus(jobId, fileName, onProgress);
}

/**
 * Development test transcription that runs an end-to-end sample audio with multi-track and chords.
 */
export async function transcribeSampleAudio(): Promise<NormalizedTranscription> {
  const res = await fetch('/api/transcribe/sample', { method: 'POST' });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to generate sample transcription');
  }
  return data.data as NormalizedTranscription;
}

/**
 * Auto-detects the primary/preferred instrument track IDs (preferring keyboard/piano/synth).
 */
export function getPreferredTrackIds(tracks: NormalizedTranscription['tracks']): string[] {
  if (!tracks || tracks.length === 0) return [];

  // Look for piano, keyboard, keys, grand, or synth track first
  const preferred = tracks.find(t => {
    const name = (t.name || '').toLowerCase();
    const inst = (t.instrument || '').toLowerCase();
    return (
      name.includes('piano') || inst.includes('piano') ||
      name.includes('keyboard') || inst.includes('keyboard') ||
      name.includes('keys') || inst.includes('keys') ||
      name.includes('synth') || inst.includes('synth') ||
      name.includes('grand') || inst.includes('grand')
    );
  });

  if (preferred) {
    return [preferred.id];
  }

  // Otherwise pick non-percussion track with the most notes
  const nonPercTracks = tracks.filter(t => !t.isPercussion && t.notes && t.notes.length > 0);
  if (nonPercTracks.length > 0) {
    nonPercTracks.sort((a, b) => b.notes.length - a.notes.length);
    return [nonPercTracks[0].id];
  }

  // Fallback to first track
  return [tracks[0].id];
}

/**
 * Converts a NormalizedTranscription into an AuraMIDI Song object ready for the player.
 */
export function convertTranscriptionToSong(
  transcription: NormalizedTranscription,
  selectedTrackIds?: string[]
): Song {
  let filteredNotes = transcription.notes || [];

  // Filter notes by selected tracks if specified
  if (selectedTrackIds && selectedTrackIds.length > 0 && transcription.tracks && transcription.tracks.length > 0) {
    const trackNotes: typeof transcription.notes = [];
    for (const trk of transcription.tracks) {
      if (selectedTrackIds.includes(trk.id) && trk.notes && trk.notes.length > 0) {
        trackNotes.push(...trk.notes);
      }
    }
    if (trackNotes.length > 0) {
      filteredNotes = trackNotes;
    }
  }

  // If filtered list is empty but transcription has notes, fallback to all notes
  if (filteredNotes.length === 0 && transcription.notes && transcription.notes.length > 0) {
    filteredNotes = transcription.notes;
  }

  const midiNotes: MIDINote[] = normalizedNotesToMIDINotes(filteredNotes);

  const instrumentSummary = transcription.instruments && transcription.instruments.length > 0
    ? transcription.instruments.join(', ')
    : 'Piano';

  return {
    id: transcription.id,
    title: transcription.title,
    composer: `${transcription.tracks?.length || 1} ${transcription.tracks?.length === 1 ? 'Instrument' : 'Instruments'} · MIDI Score`,
    difficulty: midiNotes.length > 250 ? 'Advanced' : midiNotes.length > 100 ? 'Intermediate' : 'Beginner',
    genre: 'AI Transcription',
    durationMs: transcription.durationMs,
    notes: midiNotes,
    bpm: transcription.tempo || 120,
    chords: transcription.chords,
    key: transcription.key,
    audioUrl: transcription.audioUrl,
    rawMidiUrl: transcription.rawMidiUrl,
    tracks: transcription.tracks?.map(t => ({
      id: t.id,
      name: t.name,
      instrument: t.instrument,
      notes: t.notes.map(n => ({
        note: n.note,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      })),
    })),
  };
}
