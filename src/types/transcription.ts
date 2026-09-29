import { MIDINote } from '../data/sampleSongs';

export interface NormalizedNote {
  note: number; // MIDI pitch (0 - 127)
  time: number; // Note start time in milliseconds
  duration: number; // Note duration in milliseconds
  velocity: number; // Dynamic velocity (0 - 127)
  trackId?: string;
  trackName?: string;
  instrument?: string;
}

export interface NormalizedChord {
  chord: string; // e.g. "Cmaj7", "Am", "G/B", "D7"
  time: number; // Start time in milliseconds
  duration: number; // Duration in milliseconds
}

export interface NormalizedTrack {
  id: string;
  name: string; // e.g. "Acoustic Grand Piano", "Electric Bass", "Vocals", "Drums"
  instrument: string;
  isPercussion?: boolean;
  notes: NormalizedNote[];
}

export interface MireloMidiDebugInfo {
  jobId: string;
  status: string;
  hasMidiUrl: boolean;
  midiUrl: string | null;
  midiDomain: string | null;
  sourceType?: 'official_url' | 'base64' | 'encoded_fallback' | 'none';
  sourcePath?: string | null;
  httpStatus: number | null;
  contentType: string | null;
  contentLength?: string | null;
  fileSizeBytes: number | null;
  hasMThdSignature: boolean;
  firstFourBytesHex?: string | null;
  firstFourBytesAscii?: string | null;
  first16BytesHex?: string | null;
  payloadPreviewText?: string | null;
  isBinaryObtained: boolean;
  parsedSuccessfully: boolean;
  numTracks: number | null;
  totalNotes: number | null;
  durationMs: number | null;
  firstNotes: Array<{ pitch: number; noteName: string; timeMs: number; durationMs: number; velocity: number }> | null;
  parserError: string | null;
  rawResponseKeys: string[];
}

export interface NormalizedTranscription {
  id: string;
  source: 'mirelo' | 'sample';
  title: string;
  durationMs: number;
  key?: string; // e.g. "C Major", "A Minor"
  tempo?: number; // Detected BPM
  timeSignature?: string; // e.g. "4/4", "3/4"
  instruments: string[];
  tracks: NormalizedTrack[];
  notes: NormalizedNote[]; // Consolidated/playable MIDI notes
  chords: NormalizedChord[]; // Detected musical harmony
  rawMidiUrl?: string;
  audioUrl?: string; // Authoritative original audio recording URL (Object URL or stream)
  transcriptionTimeMs?: number;
  midiDebug?: MireloMidiDebugInfo;
  metadata?: {
    model?: string;
    jobId?: string;
    confidence?: number;
    notesCount?: number;
    chordsCount?: number;
  };
}

export interface TranscriptionProgress {
  stage: 'uploading' | 'submitting-job' | 'processing' | 'downloading-result' | 'normalizing' | 'complete' | 'error';
  percent: number;
  message: string;
  jobId?: string;
  status?: string;
  elapsedSec?: number;
}

export interface ServerConfigResponse {
  hasApiKey: boolean;
  provider: string;
  baseUrl: string;
  model: string;
}

/**
 * Converts NormalizedNotes into AuraMIDI player MIDINote format.
 */
export function normalizedNotesToMIDINotes(notes: NormalizedNote[]): MIDINote[] {
  return notes
    .filter(n => typeof n.note === 'number' && !isNaN(n.note) && n.note >= 0 && n.note <= 127 && n.duration > 5)
    .map(n => ({
      note: Math.round(n.note),
      time: Math.round(n.time),
      duration: Math.max(30, Math.round(n.duration)),
      velocity: Math.max(20, Math.min(127, Math.round(n.velocity || 80))),
    }))
    .sort((a, b) => a.time - b.time);
}
