import crypto from 'crypto';
import { 
  NormalizedTranscription, 
  NormalizedTrack, 
  NormalizedNote, 
  NormalizedChord,
  normalizedNotesToMIDINotes
} from '../src/types/transcription.js';
import { parseMIDIFile, ParsedMIDITrack } from '../src/utils/midiParser.js';
import { createMIDIFileBuffer, EncodableTrack } from '../src/utils/midiEncoder.js';

export interface MireloConfig {
  apiKey?: string;
  baseUrl: string;
}

export function parsePitch(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number' && !isNaN(val)) {
    const rounded = Math.round(val);
    return rounded >= 0 && rounded <= 127 ? rounded : null;
  }
  const str = String(val).trim();
  if (!str) return null;

  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    return num >= 0 && num <= 127 ? num : null;
  }

  const match = str.match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)$/);
  if (match) {
    const noteLetter = match[1].toUpperCase();
    const accidental = match[2];
    const octave = parseInt(match[3], 10);

    const basePitches: Record<string, number> = {
      'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
    };

    let semitone = basePitches[noteLetter];
    if (semitone === undefined) return null;

    if (accidental === '#' || accidental === '♯') semitone += 1;
    else if (accidental === 'b' || accidental === '♭') semitone -= 1;

    const midiPitch = (octave + 1) * 12 + semitone;
    return midiPitch >= 0 && midiPitch <= 127 ? midiPitch : null;
  }

  return null;
}

export function getMireloConfig(): MireloConfig {
  const apiKey = process.env.MIRELO_API_KEY?.trim();
  const baseUrl = (process.env.MIRELO_BASE_URL || 'https://api.mirelo.ai').replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

export interface MireloMidiDebugInfo {
  jobId: string;
  status: string;
  hasMidiUrl: boolean;
  midiUrl: string | null;
  midiDomain: string | null;
  sourceType: 'official_url' | 'base64' | 'encoded_fallback' | 'none';
  sourcePath: string | null;
  httpStatus: number | null;
  contentType: string | null;
  contentLength: string | null;
  fileSizeBytes: number | null;
  hasMThdSignature: boolean;
  firstFourBytesHex: string | null;
  firstFourBytesAscii: string | null;
  first16BytesHex: string | null;
  payloadPreviewText: string | null;
  isBinaryObtained: boolean;
  parsedSuccessfully: boolean;
  numTracks: number | null;
  totalNotes: number | null;
  durationMs: number | null;
  firstNotes: Array<{ pitch: number; noteName: string; timeMs: number; durationMs: number; velocity: number }> | null;
  parserError: string | null;
  rawResponseKeys: string[];
}

// In-memory caches
const completedJobsCache = new Map<string, NormalizedTranscription>();
const jobMetadataCache = new Map<string, { fileName: string; mimeType: string; createdAt: number }>();
const failedJobsCache = new Map<string, string>();
const rawResponseCache = new Map<string, any>();
const rawMidiBufferCache = new Map<string, Buffer>();
const midiDebugCache = new Map<string, MireloMidiDebugInfo>();

// Deduplication maps to prevent duplicate credit spend
const audioHashToJobId = new Map<string, string>();
const jobStateMap = new Map<string, 'pending' | 'processing' | 'succeeded' | 'failed'>();

export interface ArtifactCandidate {
  type: 'url' | 'base64';
  value: string;
  path: string;
}

/**
 * Deep inspection of Mirelo API raw response to locate the official MIDI artifact.
 * Inspects all known top-level and nested properties.
 */
export function findMireloMidiArtifactCandidates(raw: any): ArtifactCandidate[] {
  if (!raw || typeof raw !== 'object') return [];
  const candidates: ArtifactCandidate[] = [];
  const visited = new Set<any>();

  function search(obj: any, currentPath: string, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8 || visited.has(obj)) return;
    visited.add(obj);

    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => search(item, `${currentPath}[${idx}]`, depth + 1));
      return;
    }

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const p = currentPath ? `${currentPath}.${key}` : key;

      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || (trimmed.startsWith('/') && trimmed.length > 2)) {
          if (!trimmed.endsWith('.png') && !trimmed.endsWith('.jpg') && !trimmed.endsWith('.svg') && !trimmed.endsWith('.html')) {
            candidates.push({ type: 'url', value: trimmed, path: p });
          }
        } else if (trimmed.startsWith('data:audio/midi;base64,') || (trimmed.startsWith('TVRo') && trimmed.length > 20)) {
          candidates.push({ type: 'base64', value: trimmed, path: p });
        }
      } else if (val && typeof val === 'object') {
        search(val, p, depth + 1);
      }
    }
  }

  search(raw, 'raw');

  const uniqueMap = new Map<string, ArtifactCandidate>();
  for (const c of candidates) {
    if (!uniqueMap.has(c.value)) {
      uniqueMap.set(c.value, c);
    }
  }
  const result = Array.from(uniqueMap.values());

  result.sort((a, b) => {
    const aLower = a.value.toLowerCase();
    const bLower = b.value.toLowerCase();
    const aIsMidi = aLower.includes('.mid') || aLower.includes('midi');
    const bIsMidi = bLower.includes('.mid') || bLower.includes('midi');
    if (aIsMidi && !bIsMidi) return -1;
    if (!aIsMidi && bIsMidi) return 1;
    return 0;
  });

  return result;
}

export function extractMidiUrlFromRawResponse(raw: any): string | null {
  const candidates = findMireloMidiArtifactCandidates(raw);
  const urlCandidate = candidates.find(c => c.type === 'url');
  return urlCandidate ? urlCandidate.value : null;
}

export function cleanJobId(rawId?: string | null): string {
  if (!rawId) return '';
  let cleaned = String(rawId).trim();
  while (/^job[:_\s]*/i.test(cleaned)) {
    cleaned = cleaned.replace(/^job[:_\s]*/i, '').trim();
  }
  return cleaned;
}

export function getMireloRawResponse(rawJobId: string): any {
  const jobId = cleanJobId(rawJobId);
  return rawResponseCache.get(jobId) || null;
}

export function getMireloMidiBuffer(rawJobId: string): Buffer | null {
  const jobId = cleanJobId(rawJobId);
  const cached = rawMidiBufferCache.get(jobId);
  if (cached && cached.length >= 14) {
    const isMThd = cached[0] === 0x4D && cached[1] === 0x54 && cached[2] === 0x68 && cached[3] === 0x64;
    if (isMThd) {
      return cached;
    }
  }

  // Fallback: If not found or invalid, check if completedJobsCache has normalized notes to encode on-the-fly
  const completed = completedJobsCache.get(jobId);
  if (completed) {
    console.log(`[Mirelo:Buffer] Encoding binary .mid buffer from completed cache notes for job ${jobId}...`);
    try {
      const encodableTracks: EncodableTrack[] = (completed.tracks && completed.tracks.length > 0)
        ? completed.tracks.map((t, idx) => ({
            name: t.name,
            notes: normalizedNotesToMIDINotes(t.notes || []),
            channel: idx % 16,
          }))
        : [];
      
      const midiNotes = normalizedNotesToMIDINotes(completed.notes || []);
      const ab = createMIDIFileBuffer(
        midiNotes,
        completed.tempo || 120,
        completed.title || 'Mirelo Transcription',
        encodableTracks.length > 1 ? encodableTracks : undefined
      );
      const buf = Buffer.from(ab);
      rawMidiBufferCache.set(jobId, buf);
      return buf;
    } catch (err: any) {
      console.error(`[Mirelo:BufferError] Failed to generate fallback MIDI buffer for ${jobId}:`, err.message);
    }
  }

  return null;
}

export function getMireloMidiDebug(rawJobId: string): MireloMidiDebugInfo | null {
  const jobId = cleanJobId(rawJobId);
  return midiDebugCache.get(jobId) || null;
}

export interface SubmitJobResult {
  jobId: string;
  status: 'processing' | 'succeeded';
  fileName: string;
  data?: NormalizedTranscription;
}

export interface JobStatusResult {
  jobId: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  progress?: number;
  message?: string;
  data?: NormalizedTranscription;
  midiDebug?: MireloMidiDebugInfo;
  error?: string;
}

/**
 * Downloads / decodes the official MIDI artifact, rigorously verifies the MThd header,
 * and parses the binary into real multi-track MIDI data.
 */
export async function retrieveAndProcessMireloMidi(
  jobId: string,
  rawResult: any,
  fileName: string,
  normalized: NormalizedTranscription
): Promise<{ debugInfo: MireloMidiDebugInfo; parsedTracks?: ParsedMIDITrack[]; parsedNotes?: any[]; durationMs?: number; bpm?: number }> {
  const { apiKey } = getMireloConfig();
  rawResponseCache.set(jobId, rawResult);

  const rawKeys = Object.keys(rawResult || {});
  const candidates = findMireloMidiArtifactCandidates(rawResult);

  console.log(`[Mirelo:Artifact] Job ${jobId}: Found ${candidates.length} candidate artifacts in response:`, 
    candidates.map(c => `${c.path} (${c.type})`).join(', ') || 'None');

  let chosenCandidate: ArtifactCandidate | null = null;
  let binaryBuffer: Buffer | null = null;
  let httpStatus: number | null = null;
  let contentType: string | null = null;
  let contentLength: string | null = null;
  let midiDomain: string | null = null;
  let lastFetchError: string | null = null;
  let payloadPreviewText: string | null = null;

  // Attempt each candidate until a valid binary buffer is obtained
  for (const candidate of candidates) {
    if (candidate.type === 'base64') {
      try {
        let b64Str = candidate.value;
        if (b64Str.startsWith('data:')) {
          b64Str = b64Str.split(',')[1] || b64Str;
        }
        const decoded = Buffer.from(b64Str, 'base64');
        if (decoded.length >= 14 && decoded[0] === 0x4D && decoded[1] === 0x54 && decoded[2] === 0x68 && decoded[3] === 0x64) {
          chosenCandidate = candidate;
          binaryBuffer = decoded;
          httpStatus = 200;
          contentType = 'audio/midi;base64';
          contentLength = String(decoded.length);
          break;
        }
      } catch (err: any) {
        console.warn(`[Mirelo:Base64Error] Failed decoding candidate ${candidate.path}: ${err.message}`);
      }
    } else if (candidate.type === 'url') {
      const url = candidate.value;
      try {
        const u = new URL(url.startsWith('http') ? url : `https://api.mirelo.ai${url}`);
        midiDomain = u.hostname;
      } catch (_) {
        midiDomain = 'Mirelo Storage';
      }

      console.log(`[Mirelo:Fetch] Downloading candidate MIDI from ${candidate.path}: ${url}`);

      // Strategy: Presigned S3/GCS URLs will fail with HTTP 400 if Bearer Authorization header is passed.
      // 1. First fetch without Auth header
      let res: Response | null = null;
      try {
        res = await fetch(url);
      } catch (fErr: any) {
        console.warn(`[Mirelo:Fetch] Direct fetch failed for ${url}: ${fErr.message}`);
      }

      // 2. If 401 / 403 or failed, and apiKey is available, try with Auth header
      if ((!res || res.status === 401 || res.status === 403) && apiKey) {
        try {
          console.log(`[Mirelo:Fetch] Retrying with Authorization header...`);
          res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
        } catch (fErr: any) {
          console.warn(`[Mirelo:Fetch] Auth fetch failed for ${url}: ${fErr.message}`);
        }
      }

      if (res) {
        httpStatus = res.status;
        contentType = res.headers.get('content-type');
        contentLength = res.headers.get('content-length');

        if (res.ok) {
          const ab = await res.arrayBuffer();
          const buf = Buffer.from(ab);

          // Check if the response is actually binary MIDI ('MThd')
          const isMThd = buf.length >= 14 && buf[0] === 0x4D && buf[1] === 0x54 && buf[2] === 0x68 && buf[3] === 0x64;

          if (isMThd) {
            chosenCandidate = candidate;
            binaryBuffer = buf;
            break;
          } else {
            // Check if downloaded content was Base64 encoded MIDI text
            const textContent = buf.toString('utf-8', 0, Math.min(buf.length, 500)).trim();
            if (textContent.startsWith('TVRo') || textContent.startsWith('data:audio/midi;base64,')) {
              let cleanB64 = textContent;
              if (cleanB64.startsWith('data:')) cleanB64 = cleanB64.split(',')[1] || cleanB64;
              const decoded = Buffer.from(cleanB64, 'base64');
              if (decoded.length >= 14 && decoded[0] === 0x4D && decoded[1] === 0x54 && decoded[2] === 0x68 && decoded[3] === 0x64) {
                chosenCandidate = candidate;
                binaryBuffer = decoded;
                break;
              }
            }

            // Not MThd — capture diagnostic preview
            payloadPreviewText = textContent.slice(0, 200);
            const hexDump = buf.subarray(0, Math.min(buf.length, 16)).toString('hex');
            lastFetchError = `Invalid header signature: expected "MThd" (0x4D 0x54 0x68 0x64), but received "${buf.toString('utf-8', 0, 4)}" (hex: ${hexDump}). Payload appears to be ${contentType || 'non-MIDI'}.`;
            console.warn(`[Mirelo:ValidateHeader] Candidate ${candidate.path} failed signature check: ${lastFetchError}`);
          }
        } else {
          lastFetchError = `HTTP ${res.status} fetching ${candidate.path} from ${midiDomain}`;
        }
      }
    }
  }

  let hasMThdSignature = false;
  let isBinaryObtained = false;
  let parsedSuccessfully = false;
  let numTracks: number | null = null;
  let totalNotes: number | null = null;
  let durationMs: number | null = null;
  let firstNotes: Array<{ pitch: number; noteName: string; timeMs: number; durationMs: number; velocity: number }> | null = null;
  let parserError: string | null = null;
  let parsedTracks: ParsedMIDITrack[] | undefined = undefined;
  let parsedNotes: any[] | undefined = undefined;
  let bpm: number | undefined = undefined;

  let firstFourBytesHex: string | null = null;
  let firstFourBytesAscii: string | null = null;
  let first16BytesHex: string | null = null;

  // If a valid official binary was retrieved:
  if (binaryBuffer && binaryBuffer.length >= 14) {
    firstFourBytesHex = binaryBuffer.subarray(0, 4).toString('hex').toUpperCase().match(/../g)?.join(' ') || null;
    firstFourBytesAscii = binaryBuffer.subarray(0, 4).toString('utf-8');
    first16BytesHex = binaryBuffer.subarray(0, Math.min(16, binaryBuffer.length)).toString('hex').toUpperCase().match(/../g)?.join(' ') || null;

    hasMThdSignature = binaryBuffer[0] === 0x4D && binaryBuffer[1] === 0x54 && binaryBuffer[2] === 0x68 && binaryBuffer[3] === 0x64;

    if (hasMThdSignature) {
      try {
        const ab = binaryBuffer.buffer.slice(
          binaryBuffer.byteOffset,
          binaryBuffer.byteOffset + binaryBuffer.byteLength
        ) as ArrayBuffer;

        const parsed = parseMIDIFile(ab, fileName);
        if (parsed.notes.length > 0) {
          isBinaryObtained = true;
          parsedSuccessfully = true;
          numTracks = parsed.numTracks;
          totalNotes = parsed.notes.length;
          durationMs = parsed.durationMs;
          parsedTracks = parsed.tracks;
          parsedNotes = parsed.notes;
          bpm = parsed.bpm;

          rawMidiBufferCache.set(jobId, binaryBuffer);

          const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          firstNotes = parsed.notes.slice(0, 5).map(n => ({
            pitch: n.note,
            noteName: `${NOTE_NAMES[n.note % 12]}${Math.floor(n.note / 12) - 1}`,
            timeMs: Math.round(n.time),
            durationMs: Math.round(n.duration),
            velocity: n.velocity,
          }));

          console.log(`[Mirelo:ParserSuccess] Successfully verified and parsed official Standard MIDI File! ${parsed.notes.length} notes across ${parsed.numTracks} tracks (${binaryBuffer.length} bytes).`);
        } else {
          parserError = 'Downloaded MIDI artifact contained 0 notes.';
        }
      } catch (pErr: any) {
        parsedSuccessfully = false;
        parserError = `parseMIDIFile error: ${pErr.message}`;
        console.error(`[Mirelo:ParserError]`, parserError);
      }
    }
  }

  // Strict check: Throw an error if no valid binary MIDI artifact with >0 notes could be retrieved from Mirelo
  if (!isBinaryObtained || !binaryBuffer || !parsedNotes || parsedNotes.length === 0) {
    const errDetail = parserError || lastFetchError || "No valid binary MIDI artifact ('MThd') could be retrieved from Mirelo";
    throw new Error(errDetail);
  }

  const debugInfo: MireloMidiDebugInfo = {
    jobId,
    status: 'succeeded',
    hasMidiUrl: Boolean(chosenCandidate && chosenCandidate.type === 'url'),
    midiUrl: chosenCandidate && chosenCandidate.type === 'url' ? chosenCandidate.value : null,
    midiDomain,
    sourceType: chosenCandidate 
      ? (chosenCandidate.type === 'url' ? 'official_url' : 'base64') 
      : (isBinaryObtained ? 'encoded_fallback' : 'none'),
    sourcePath: chosenCandidate?.path || null,
    httpStatus,
    contentType,
    contentLength,
    fileSizeBytes: binaryBuffer ? binaryBuffer.length : null,
    hasMThdSignature,
    firstFourBytesHex,
    firstFourBytesAscii,
    first16BytesHex,
    payloadPreviewText,
    isBinaryObtained,
    parsedSuccessfully,
    numTracks,
    totalNotes,
    durationMs,
    firstNotes,
    parserError: parserError || lastFetchError,
    rawResponseKeys: rawKeys,
  };

  midiDebugCache.set(jobId, debugInfo);
  return { debugInfo, parsedTracks, parsedNotes, durationMs: durationMs || undefined, bpm };
}

/**
 * Submits an audio recording to Mirelo Audio-to-MIDI Pro.
 * Includes deduplication by audio hash to prevent duplicate paid requests.
 */
export async function submitMireloJob(
  audioBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<SubmitJobResult> {
  const { apiKey, baseUrl } = getMireloConfig();

  const safeFileName = (fileName || 'audio.wav').replace(/[^\w.-]/g, '_');
  const cleanMime = (mimeType && mimeType.includes('/')) ? mimeType.split(';')[0].trim().toLowerCase() : 'audio/wav';

  // Compute audio content hash for deduplication
  const audioHash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
  console.log(`[Mirelo:Submit] Audio hash: ${audioHash.slice(0, 12)}... for "${safeFileName}" (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  if (audioHashToJobId.has(audioHash)) {
    const existingJobId = audioHashToJobId.get(audioHash)!;
    const existingState = jobStateMap.get(existingJobId);

    if (existingState === 'succeeded' && completedJobsCache.has(existingJobId)) {
      console.log(`[Mirelo:Deduplication] Audio already transcribed as job ${existingJobId}. Returning cached result.`);
      return {
        jobId: existingJobId,
        status: 'succeeded',
        fileName: safeFileName,
        data: completedJobsCache.get(existingJobId)!,
      };
    }

    if (existingState === 'processing' || existingState === 'pending') {
      console.log(`[Mirelo:Deduplication] Audio is currently processing as job ${existingJobId}. Attaching to existing job.`);
      return {
        jobId: existingJobId,
        status: 'processing',
        fileName: safeFileName,
      };
    }
  }

  if (!apiKey) {
    const errMsg = 'MIRELO_API_KEY environment variable is not configured on the server.';
    console.error(`[Mirelo:AuthError] ${errMsg}`);
    throw new Error(errMsg);
  }

  // Step 1: Create Mirelo v3 Asset Ticket
  console.log(`[Mirelo:Upload] Creating asset ticket on ${baseUrl}/v3/assets...`);

  let assetTicketRes: Response;
  try {
    assetTicketRes = await fetch(`${baseUrl}/v3/assets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content_type: cleanMime }),
    });
  } catch (err: any) {
    console.error(`[Mirelo:AssetTicketError]`, err.message);
    throw new Error(`Failed to request Mirelo upload ticket: ${err.message || 'Connection failed'}`);
  }

  if (!assetTicketRes.ok) {
    const ticketErr = await assetTicketRes.text();
    console.warn(`[Mirelo:Upload] /v3/assets returned ${assetTicketRes.status}: ${ticketErr}`);
    throw new Error(`Mirelo asset creation error (${assetTicketRes.status}): ${ticketErr}`);
  }

  const ticketData = await assetTicketRes.json() as { 
    id: string; 
    upload_url: string; 
    fields?: Record<string, string>;
  };

  if (!ticketData.upload_url || !ticketData.id) {
    throw new Error('Mirelo did not return a valid asset upload ticket.');
  }

  // Step 2: Upload file bytes directly to Mirelo storage (S3 presigned POST / PUT)
  let uploadUrl = ticketData.upload_url;
  if (uploadUrl.startsWith('/')) {
    uploadUrl = `${baseUrl.replace(/\/+$/, '')}${uploadUrl}`;
  }

  console.log(`[Mirelo:Upload] Uploading audio bytes to ticket endpoint...`);

  let uploadSuccess = false;
  let lastUploadErr = '';

  // Method A: Multipart FormData POST
  try {
    const form = new FormData();
    if (ticketData.fields) {
      for (const [key, value] of Object.entries(ticketData.fields)) {
        form.append(key, String(value));
      }
    }
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset, 
      audioBuffer.byteOffset + audioBuffer.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: cleanMime });
    form.append('file', blob, safeFileName);

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
    });

    if (uploadRes.ok) {
      uploadSuccess = true;
    } else {
      lastUploadErr = await uploadRes.text();
      console.warn(`[Mirelo:Upload] POST returned ${uploadRes.status}: ${lastUploadErr}`);
    }
  } catch (err: any) {
    console.warn(`[Mirelo:Upload] POST FormData attempt failed: ${err.message}`);
    lastUploadErr = err.message;
  }

  // Method B: Direct PUT request with raw Buffer
  if (!uploadSuccess) {
    try {
      console.log(`[Mirelo:Upload] Attempting direct binary PUT upload...`);
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': cleanMime,
        },
        body: new Uint8Array(audioBuffer),
      });

      if (putRes.ok) {
        uploadSuccess = true;
      } else {
        const putErr = await putRes.text();
        console.warn(`[Mirelo:Upload] PUT returned ${putRes.status}: ${putErr}`);
        if (!lastUploadErr) lastUploadErr = putErr;
      }
    } catch (err: any) {
      console.warn(`[Mirelo:Upload] PUT attempt failed: ${err.message}`);
      if (!lastUploadErr) lastUploadErr = err.message;
    }
  }

  if (!uploadSuccess) {
    throw new Error(`Failed to upload audio to Mirelo storage: ${lastUploadErr || 'Upload failed'}`);
  }

  console.log(`[Mirelo:Upload] Audio bytes successfully uploaded to Mirelo.`);

  // Step 3: Submit Job with timing = "performance"
  console.log(`[Mirelo:JobSubmit] Submitting Audio-to-MIDI Pro job for asset_id: ${ticketData.id} (timing: performance)...`);

  const primaryPayload = {
    audio: {
      type: 'asset',
      asset_id: ticketData.id,
    },
    timing: 'performance',
  };

  const primaryEndpoint = `${baseUrl}/v2/audio-to-midi/v1.0/jobs`;
  let jobSubmitRes: Response | null = null;
  let lastErrorText = '';

  try {
    const res = await fetch(primaryEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(primaryPayload),
    });

    if (res.ok) {
      jobSubmitRes = res;
    } else {
      lastErrorText = await res.text();
      console.warn(`[Mirelo:JobSubmit] Primary endpoint returned ${res.status}: ${lastErrorText}`);

      let parsedErr: any = null;
      try {
        parsedErr = JSON.parse(lastErrorText);
      } catch (_) {}

      const errCode = parsedErr?.error?.code || '';
      const errMsg = parsedErr?.error?.message || lastErrorText;

      if (res.status === 402 || errCode === 'insufficient_credits' || errMsg.toLowerCase().includes('credit')) {
        throw new Error(`Mirelo API Credit Limit (HTTP 402): ${errMsg}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Mirelo API Authentication Error (HTTP ${res.status}): ${errMsg}`);
      }
      if (res.status === 400) {
        throw new Error(`Mirelo API Request Error (HTTP 400): ${errMsg}`);
      }
    }
  } catch (err: any) {
    if (err.message?.includes('Mirelo API')) throw err;
  }

  if (!jobSubmitRes) {
    const fallbackEndpoints = [
      `${baseUrl}/v2/audio-to-midi/v1.0/jobs`,
      `${baseUrl}/v2/audio-to-midi/jobs`,
      `${baseUrl}/v1/audio-to-midi/jobs`,
    ];

    const fallbackPayloads = [
      { audio: { type: 'asset', id: ticketData.id, asset_id: ticketData.id }, timing: 'performance' },
      { audio: { type: 'asset', id: ticketData.id }, timing: 'performance' },
      { audio: { type: 'asset', asset_id: ticketData.id } },
    ];

    fallbackLoop:
    for (const endpoint of fallbackEndpoints) {
      for (const payload of fallbackPayloads) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            jobSubmitRes = res;
            break fallbackLoop;
          } else {
            lastErrorText = await res.text();
          }
        } catch (_) {}
      }
    }
  }

  if (!jobSubmitRes || !jobSubmitRes.ok) {
    let parsedErrorMsg = lastErrorText;
    try {
      const errObj = JSON.parse(lastErrorText);
      if (errObj?.error?.message) parsedErrorMsg = errObj.error.message;
    } catch (_) {}
    throw new Error(`Mirelo API job creation failed: ${parsedErrorMsg || 'Invalid request body'}`);
  }

  const jobData = await jobSubmitRes.json();
  console.log('[Mirelo:JobSubmit] Job created response:', JSON.stringify(jobData));

  const assignedJobId = String(jobData.job_id || jobData.id || jobData.task_id || `job_${ticketData.id}`);

  // Map audio hash to assigned job ID
  audioHashToJobId.set(audioHash, assignedJobId);
  jobStateMap.set(assignedJobId, 'processing');

  jobMetadataCache.set(assignedJobId, {
    fileName: safeFileName,
    mimeType: cleanMime,
    createdAt: Date.now(),
  });

  // If immediate result was returned with terminal success status AND (midi_url exists OR notes > 0)
  const immediateStatus = String(jobData.status || jobData.state || '').toLowerCase();
  const isImmediateSuccess = immediateStatus === 'succeeded' || immediateStatus === 'completed' || immediateStatus === 'success' || immediateStatus === 'done';
  const rawResult = jobData.result || jobData;
  const hasMidiUrl = Boolean(rawResult.midi_url || extractMidiUrlFromRawResponse(rawResult));
  const hasNotes = Array.isArray(rawResult.notes) && rawResult.notes.length > 0;

  if (isImmediateSuccess && (hasMidiUrl || hasNotes)) {
    const normalized = await normalizeMireloResponse(rawResult, safeFileName, 0);
    const { debugInfo, parsedTracks, parsedNotes, bpm } = await retrieveAndProcessMireloMidi(assignedJobId, rawResult, safeFileName, normalized);

    if (parsedTracks && parsedTracks.length > 0) {
      normalized.tracks = parsedTracks.map(t => ({
        id: t.id,
        name: t.name,
        instrument: t.instrument || t.name,
        isPercussion: t.name.toLowerCase().includes('drum') || t.name.toLowerCase().includes('percussion'),
        notes: t.notes.map(n => ({
          note: n.note,
          time: n.time,
          duration: n.duration,
          velocity: n.velocity,
          trackId: t.id,
          trackName: t.name,
          instrument: t.instrument || t.name,
        })),
      }));
    }
    if (parsedNotes && parsedNotes.length > 0) {
      normalized.notes = parsedNotes.map(n => ({
        note: n.note,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      }));
    }
    if (bpm) normalized.tempo = bpm;

    normalized.midiDebug = debugInfo;
    completedJobsCache.set(assignedJobId, normalized);
    jobStateMap.set(assignedJobId, 'succeeded');

    return {
      jobId: assignedJobId,
      status: 'succeeded',
      fileName: safeFileName,
      data: normalized,
    };
  }

  return {
    jobId: assignedJobId,
    status: 'processing',
    fileName: safeFileName,
  };
}

/**
 * Queries the status of an existing Mirelo transcription job.
 * When completed, retrieves the binary MIDI artifact, validates MThd signature,
 * parses with existing MIDI parser, and stores in completed cache.
 */
export async function getMireloJobStatus(
  rawJobId: string,
  fileNameFallback?: string
): Promise<JobStatusResult> {
  const jobId = cleanJobId(rawJobId);
  const { apiKey, baseUrl } = getMireloConfig();

  if (!apiKey) {
    throw new Error('MIRELO_API_KEY environment variable is not configured on server.');
  }

  if (!jobId) {
    return {
      jobId: '',
      status: 'failed',
      error: 'Invalid or empty Job ID provided.',
    };
  }

  // 1. Return from in-memory completed cache if already normalized and valid
  if (completedJobsCache.has(jobId)) {
    const cachedData = completedJobsCache.get(jobId)!;
    const cachedBuf = rawMidiBufferCache.get(jobId);
    const hasNotes = Boolean(cachedData.notes && cachedData.notes.length > 0);
    const hasValidBuf = Boolean(cachedBuf && cachedBuf.length > 100);

    if (hasNotes || hasValidBuf) {
      return {
        jobId,
        status: 'succeeded',
        progress: 100,
        data: cachedData,
        midiDebug: midiDebugCache.get(jobId) || undefined,
        message: 'Transcription ready',
      };
    } else {
      console.log(`[Mirelo:CacheEvict] Evicting empty cache for job ${jobId} (notes=${cachedData.notes?.length || 0}, buf=${cachedBuf?.length || 0} bytes)...`);
      completedJobsCache.delete(jobId);
      rawMidiBufferCache.delete(jobId);
      midiDebugCache.delete(jobId);
    }
  }

  // 2. Return from failure cache if known failed
  if (failedJobsCache.has(jobId)) {
    return {
      jobId,
      status: 'failed',
      error: failedJobsCache.get(jobId)!,
    };
  }

  const meta = jobMetadataCache.get(jobId);
  const fileName = meta?.fileName || fileNameFallback || 'Transcribed Audio';

  // 3. Query Mirelo status endpoints
  const pollUrlsToTry = [
    `${baseUrl}/v2/audio-to-midi/v1.0/jobs/${jobId}`,
    `${baseUrl}/v2/audio-to-midi/jobs/${jobId}`,
    `${baseUrl}/v1/audio-to-midi/jobs/${jobId}`,
    `${baseUrl}/v2/audio-to-midi/${jobId}`,
  ];

  let pollData: any = null;
  let lastStatus = 0;
  let lastErr = '';

  for (const pUrl of pollUrlsToTry) {
    try {
      const res = await fetch(pUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      lastStatus = res.status;
      if (res.ok) {
        pollData = await res.json();
        break;
      } else {
        lastErr = await res.text();
      }
    } catch (e: any) {
      lastErr = e.message;
    }
  }

  if (!pollData) {
    console.warn(`[Mirelo:Status] Query for ${jobId} returned HTTP ${lastStatus}: ${lastErr}`);
    if (lastStatus === 404 && !jobMetadataCache.has(jobId) && !jobStateMap.has(jobId)) {
      failedJobsCache.set(jobId, `Job ID "${jobId}" was not found or has expired on Mirelo.`);
      return {
        jobId,
        status: 'failed',
        error: `Job ID "${jobId}" was not found or has expired on Mirelo. Please check the Job ID or submit an audio file.`,
      };
    }
    return {
      jobId,
      status: 'processing',
      progress: 40,
      message: 'Checking Mirelo neural processing status...',
    };
  }

  const status = String(pollData.status || pollData.state || '').toLowerCase();
  const progressPct = Number(pollData.progress_percent || pollData.progress || 50);

  // Success handling: Only mark succeeded if status is one of: succeeded, completed, success, done
  if (status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done') {
    console.log(`[Mirelo:Status] Job ${jobId} succeeded! Processing MIDI & diagnostic data...`);
    const rawResult = pollData.result || pollData;
    const executionTimeMs = meta?.createdAt ? Date.now() - meta.createdAt : 0;
    const normalized = await normalizeMireloResponse(rawResult, fileName, executionTimeMs);

    const { debugInfo, parsedTracks, parsedNotes, bpm } = await retrieveAndProcessMireloMidi(jobId, rawResult, fileName, normalized);

    // If multi-tracks were parsed directly from valid binary MIDI, prioritize them
    if (parsedTracks && parsedTracks.length > 0) {
      normalized.tracks = parsedTracks.map(t => ({
        id: t.id,
        name: t.name,
        instrument: t.instrument || t.name,
        isPercussion: t.name.toLowerCase().includes('drum') || t.name.toLowerCase().includes('percussion'),
        notes: t.notes.map(n => ({
          note: n.note,
          time: n.time,
          duration: n.duration,
          velocity: n.velocity,
          trackId: t.id,
          trackName: t.name,
          instrument: t.instrument || t.name,
        })),
      }));
    }
    if (parsedNotes && parsedNotes.length > 0) {
      normalized.notes = parsedNotes.map(n => ({
        note: n.note,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      }));
    }
    if (bpm) normalized.tempo = bpm;

    normalized.midiDebug = debugInfo;
    completedJobsCache.set(jobId, normalized);
    jobStateMap.set(jobId, 'succeeded');

    return {
      jobId,
      status: 'succeeded',
      progress: 100,
      data: normalized,
      midiDebug: debugInfo,
      message: `Transcription complete (${normalized.notes.length} notes, ${normalized.tracks.length} tracks)`,
    };
  }

  // Error handling
  if (status === 'errored' || status === 'failed' || status === 'error') {
    const errMessage = pollData.error?.message || pollData.error?.code || pollData.message || 'Mirelo transcription failed';
    console.error(`[Mirelo:Status] Job ${jobId} errored: ${errMessage}`);
    failedJobsCache.set(jobId, errMessage);
    jobStateMap.set(jobId, 'failed');
    return {
      jobId,
      status: 'failed',
      error: errMessage,
    };
  }

  // In-progress handling
  if (status === 'queued' || status === 'pending') {
    jobStateMap.set(jobId, 'pending');
    return {
      jobId,
      status: 'queued',
      progress: Math.max(15, Math.min(40, progressPct)),
      message: 'Queued on Mirelo GPU cluster...',
    };
  }

  jobStateMap.set(jobId, 'processing');
  return {
    jobId,
    status: 'processing',
    progress: Math.max(40, Math.min(95, progressPct)),
    message: pollData.message || 'Mirelo AI analyzing instrument tracks & harmony...',
  };
}

/**
 * Backward-compatible full pipeline execution with server-side timeout protection
 */
export async function transcribeWithMirelo(
  audioBuffer: Buffer,
  fileName: string,
  mimeType: string,
  onProgress?: (stage: string, percent: number, details?: string) => void
): Promise<NormalizedTranscription> {
  const submitRes = await submitMireloJob(audioBuffer, fileName, mimeType);
  if (submitRes.data) return submitRes.data;

  const jobId = submitRes.jobId;
  const pollDeadline = Date.now() + 300_000;

  while (Date.now() < pollDeadline) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await getMireloJobStatus(jobId, fileName);

    if (statusRes.status === 'succeeded' && statusRes.data) {
      return statusRes.data;
    }
    if (statusRes.status === 'failed') {
      throw new Error(statusRes.error || 'Transcription failed on Mirelo server');
    }

    onProgress?.('processing', statusRes.progress || 50, statusRes.message);
  }

  throw new Error('Transcription timed out after 5 minutes.');
}

export function extractAllRawNotes(raw: any): { notes: any[]; sourcePath: string } {
  if (!raw || typeof raw !== 'object') return { notes: [], sourcePath: 'none' };

  const candidatePaths = [
    { p: raw.notes, name: 'raw.notes' },
    { p: raw.result?.notes, name: 'raw.result.notes' },
    { p: raw.data?.notes, name: 'raw.data.notes' },
    { p: raw.output?.notes, name: 'raw.output.notes' },
    { p: raw.transcription?.notes, name: 'raw.transcription.notes' },
    { p: raw.time_grid?.notes, name: 'raw.time_grid.notes' },
    { p: raw.midi_notes, name: 'raw.midi_notes' },
    { p: raw.result?.midi_notes, name: 'raw.result.midi_notes' },
  ];

  for (const item of candidatePaths) {
    if (Array.isArray(item.p) && item.p.length > 0) {
      return { notes: item.p, sourcePath: item.name };
    }
  }

  const containerCandidates = [raw.stems, raw.result?.stems, raw.tracks, raw.result?.tracks, raw.instruments, raw.result?.instruments];
  const combinedNotes: any[] = [];
  for (const container of containerCandidates) {
    if (Array.isArray(container)) {
      container.forEach((item: any) => {
        if (Array.isArray(item.notes)) combinedNotes.push(...item.notes);
      });
    } else if (container && typeof container === 'object') {
      Object.values(container).forEach((item: any) => {
        if (Array.isArray(item)) combinedNotes.push(...item);
        else if (item && Array.isArray(item.notes)) combinedNotes.push(...item.notes);
      });
    }
  }

  if (combinedNotes.length > 0) {
    return { notes: combinedNotes, sourcePath: 'stems/tracks container' };
  }

  return { notes: [], sourcePath: 'none' };
}

/**
 * Normalizes any Mirelo API response into the application's NormalizedTranscription structure.
 */
export async function normalizeMireloResponse(
  raw: any,
  fileName: string,
  executionTimeMs: number
): Promise<NormalizedTranscription> {
  console.log('[Mirelo:Normalize] Raw response keys:', Object.keys(raw || {}));

  const tracks: NormalizedTrack[] = [];
  const allNotes: NormalizedNote[] = [];
  const chords: NormalizedChord[] = [];
  const detectedInstruments: Set<string> = new Set();

  let detectedKey = raw.key || raw.detected_key || raw.tonality || undefined;
  let detectedTempo = raw.time_grid?.tempo_bpm || raw.tempo || raw.bpm || raw.detected_tempo || 120;
  let detectedTimeSignature = raw.time_grid?.time_signature 
    ? `${raw.time_grid.time_signature.numerator}/${raw.time_grid.time_signature.denominator}`
    : (raw.time_signature || raw.meter || '4/4');
  let totalDurationMs = raw.duration_ms 
    || (raw.duration ? Math.round(Number(raw.duration) * 1000) : 0)
    || (raw.duration_seconds ? Math.round(Number(raw.duration_seconds) * 1000) : 0);

  const midiUrl = extractMidiUrlFromRawResponse(raw);

  const { notes: rawNotesArray, sourcePath: notesSourcePath } = extractAllRawNotes(raw);

  if (rawNotesArray && rawNotesArray.length > 0) {
    console.log(`[Mirelo:Normalize] Parsing ${rawNotesArray.length} structured notes from ${notesSourcePath}...`);
    const instrumentMap = new Map<string, NormalizedNote[]>();

    for (const n of rawNotesArray) {
      const rawPitch = n.pitch ?? n.note ?? n.midi ?? n.key ?? n.pitch_name ?? n.name;
      const pitch = parsePitch(rawPitch);
      if (pitch === null) continue;

      const rawStart = Number(n.start ?? n.start_time ?? n.time ?? n.onset ?? 0);
      const startMs = rawStart > 3600 ? Math.round(rawStart) : Math.round(rawStart * 1000);

      let durationMs = 300;
      if (n.end !== undefined || n.end_time !== undefined || n.offset !== undefined) {
        const rawEnd = Number(n.end ?? n.end_time ?? n.offset);
        const endMs = rawEnd > 3600 ? Math.round(rawEnd) : Math.round(rawEnd * 1000);
        durationMs = Math.max(30, endMs - startMs);
      } else if (n.duration !== undefined) {
        const rawDur = Number(n.duration);
        durationMs = rawDur > 100 ? Math.round(rawDur) : Math.round(rawDur * 1000);
      }

      const velocity = Math.round(Number(n.velocity ?? n.volume ?? 80));
      const rawInst = String(n.instrument || n.stem || n.track || 'Acoustic Piano');
      const instName = rawInst
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      detectedInstruments.add(instName);
      const normNote: NormalizedNote = {
        note: pitch,
        time: Math.max(0, startMs),
        duration: Math.max(30, durationMs),
        velocity: Math.max(1, Math.min(127, velocity)),
        trackName: instName,
        instrument: instName,
      };
      allNotes.push(normNote);

      if (!instrumentMap.has(instName)) {
        instrumentMap.set(instName, []);
      }
      instrumentMap.get(instName)!.push(normNote);
    }

    let trackIdx = 0;
    for (const [instName, trackNotes] of instrumentMap.entries()) {
      trackIdx++;
      const trackId = `track-${trackIdx}`;
      const isPerc = instName.toLowerCase().includes('drum') || instName.toLowerCase().includes('percussion');
      
      trackNotes.forEach(n => { n.trackId = trackId; });

      tracks.push({
        id: trackId,
        name: instName,
        instrument: instName,
        isPercussion: isPerc,
        notes: trackNotes,
      });
    }
  }

  // 2. Parse structured tracks if returned directly as tracks[]
  if (tracks.length === 0 && Array.isArray(raw.tracks) && raw.tracks.length > 0) {
    for (let i = 0; i < raw.tracks.length; i++) {
      const trk = raw.tracks[i];
      const instrumentName = trk.instrument || trk.name || `Instrument ${i + 1}`;
      detectedInstruments.add(instrumentName);

      const trackNotes: NormalizedNote[] = [];
      if (Array.isArray(trk.notes)) {
        for (const n of trk.notes) {
          const rawPitch = n.pitch ?? n.note ?? n.midi ?? n.key ?? n.pitch_name ?? n.name;
          const pitch = parsePitch(rawPitch);
          if (pitch === null) continue;

          const startSec = Number(n.start_time ?? n.time ?? n.start ?? 0);
          const time = startSec > 3600 ? Math.round(startSec) : Math.round(startSec * 1000);
          const durSec = Number(n.duration ?? (n.end_time ? n.end_time - startSec : 0.5));
          const duration = durSec > 100 ? Math.round(durSec) : Math.max(30, Math.round(durSec * 1000));
          const velocity = Math.round(Number(n.velocity ?? 80));

          const normalizedNote: NormalizedNote = {
            note: pitch,
            time: Math.max(0, time),
            duration,
            velocity: Math.max(1, Math.min(127, velocity)),
            trackId: trk.id || `track-${i + 1}`,
            trackName: instrumentName,
            instrument: instrumentName,
          };
          trackNotes.push(normalizedNote);
          allNotes.push(normalizedNote);
        }
      }

      tracks.push({
        id: trk.id || `track-${i + 1}`,
        name: instrumentName,
        instrument: instrumentName,
        isPercussion: Boolean(trk.is_percussion || instrumentName.toLowerCase().includes('drum')),
        notes: trackNotes,
      });
    }
  }

  // 3. Parse chords strictly from seconds to milliseconds
  if (Array.isArray(raw.chords)) {
    for (const c of raw.chords) {
      const chordName = String(c.chord || c.name || c.label || '').trim();
      const startSec = Number(c.start_time ?? c.time ?? c.start ?? 0);
      const time = Math.round(startSec * 1000);
      const durSec = Number(c.duration ?? (c.end_time ? c.end_time - startSec : 1.5));
      const duration = Math.max(100, Math.round(durSec * 1000));

      if (chordName) {
        chords.push({
          chord: chordName,
          time: Math.max(0, time),
          duration,
        });
      }
    }
  }

  // 4. If chords are missing, derive harmonic progression from note clusters
  if (chords.length === 0 && allNotes.length > 0) {
    chords.push(...inferChordsFromNotes(allNotes));
  }

  // Sort notes by start time
  allNotes.sort((a, b) => a.time - b.time);
  chords.sort((a, b) => a.time - b.time);

  if (totalDurationMs <= 0 && allNotes.length > 0) {
    const lastNote = allNotes[allNotes.length - 1];
    totalDurationMs = lastNote.time + lastNote.duration + 1000;
  }

  return {
    id: `mirelo-${Date.now()}`,
    source: 'mirelo',
    title: raw.title || fileName.replace(/\.[^/.]+$/, ""),
    durationMs: totalDurationMs > 0 ? totalDurationMs : (allNotes.length > 0 ? allNotes[allNotes.length - 1].time + 2000 : 60000),
    key: detectedKey,
    tempo: detectedTempo,
    timeSignature: detectedTimeSignature,
    instruments: Array.from(detectedInstruments),
    tracks,
    notes: allNotes,
    chords,
    rawMidiUrl: midiUrl || undefined,
    transcriptionTimeMs: executionTimeMs,
    metadata: {
      model: 'Mirelo Audio-to-MIDI Pro',
      jobId: raw.job_id || raw.id,
      notesCount: allNotes.length,
      chordsCount: chords.length,
    },
  };
}

/**
 * Harmonic analysis helper: infers fundamental chords from note clusters
 * when the API returns raw notes without an explicit chord array.
 */
function inferChordsFromNotes(notes: NormalizedNote[]): NormalizedChord[] {
  if (notes.length === 0) return [];
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const chords: NormalizedChord[] = [];
  const windowMs = 2000; // 2-second harmonic windows
  const maxTime = notes[notes.length - 1].time + notes[notes.length - 1].duration;

  for (let t = 0; t < maxTime; t += windowMs) {
    const windowNotes = notes.filter(n => n.time < t + windowMs && n.time + n.duration > t);
    if (windowNotes.length === 0) continue;

    const pitchClasses = new Set(windowNotes.map(n => n.note % 12));
    let detectedChord = '';

    // Check major/minor triads
    for (let root = 0; root < 12; root++) {
      const rootName = NOTE_NAMES[root];
      const majorThird = (root + 4) % 12;
      const minorThird = (root + 3) % 12;
      const fifth = (root + 7) % 12;

      if (pitchClasses.has(root) && pitchClasses.has(majorThird) && pitchClasses.has(fifth)) {
        detectedChord = `${rootName} Major`;
        break;
      } else if (pitchClasses.has(root) && pitchClasses.has(minorThird) && pitchClasses.has(fifth)) {
        detectedChord = `${rootName}m`;
        break;
      }
    }

    if (!detectedChord && windowNotes.length > 0) {
      const bassNote = windowNotes.reduce((min, n) => n.note < min.note ? n : min, windowNotes[0]);
      detectedChord = NOTE_NAMES[bassNote.note % 12];
    }

    if (detectedChord && (chords.length === 0 || chords[chords.length - 1].chord !== detectedChord)) {
      chords.push({
        chord: detectedChord,
        time: t,
        duration: windowMs,
      });
    }
  }

  return chords;
}
