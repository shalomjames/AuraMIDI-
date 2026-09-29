import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Upload, 
  Music, 
  Sliders, 
  Volume2, 
  VolumeX, 
  Plus, 
  Minus, 
  Activity, 
  CheckCircle, 
  CheckCircle2,
  Keyboard, 
  FileMusic, 
  ArrowRight, 
  Eye, 
  SlidersHorizontal, 
  Sparkles,
  Menu,
  X,
  Check,
  AlertCircle,
  Cpu,
  Server,
  Layers,
  FileAudio,
  Terminal,
  RefreshCw,
  Info,
  Clock,
  Target,
  SkipForward,
  SkipBack,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Download
} from 'lucide-react';
import { SAMPLE_SONGS, Song, MIDINote } from './data/sampleSongs';
import { parseMIDIFile } from './utils/midiParser';
import { synthInstance, InstrumentType, midiToNoteName } from './utils/audioSynth';
import { 
  NormalizedTranscription, 
  NormalizedTrack, 
  NormalizedNote, 
  NormalizedChord, 
  TranscriptionProgress, 
  ServerConfigResponse,
  normalizedNotesToMIDINotes
} from './types/transcription';
import { 
  checkMireloServerConfig, 
  transcribeAudioWithMirelo, 
  resumeMireloJob,
  transcribeSampleAudio, 
  convertTranscriptionToSong,
  getPreferredTrackIds,
  cleanJobId
} from './utils/mireloClient';
import { 
  createSyncVerificationSuite
} from './utils/audioWavGenerator';
import { createMIDIFileBuffer } from './utils/midiEncoder';

// Visual themes refined for quiet, sophisticated piano studio aesthetics
interface Theme {
  name: string;
  id: string;
  primary: string;    // Main falling note color (champagne / ivory / warm golds)
  secondary: string;  // Note accent & sparkle tint
  glow: string;       // Restrained warm glow
}

const VISUAL_THEMES: Theme[] = [
  { 
    name: 'Champagne Gold', 
    id: 'champagne', 
    primary: '#d8ba7f', 
    secondary: '#f7f2e7', 
    glow: 'rgba(216, 186, 127, 0.4)' 
  },
  { 
    name: 'Concert Ivory', 
    id: 'ivory', 
    primary: '#ded7c8', 
    secondary: '#ffffff', 
    glow: 'rgba(222, 215, 200, 0.35)' 
  },
  { 
    name: 'Aged Ochre', 
    id: 'ochre', 
    primary: '#c49552', 
    secondary: '#f0d9b5', 
    glow: 'rgba(196, 149, 82, 0.4)' 
  },
  { 
    name: 'Smoky Platinum', 
    id: 'platinum', 
    primary: '#b8b5af', 
    secondary: '#e8e6e3', 
    glow: 'rgba(184, 181, 175, 0.35)' 
  }
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
}

export interface PianoKeyInfo {
  note: number;
  isBlack: boolean;
  label: string;
  whiteIndex: number;
}

// Isolated & memoized 88-key concert piano keyboard to eliminate full-app re-renders on note hits
const PianoKeyboard = React.memo(function PianoKeyboard({
  keysLayout,
  numWhiteKeys,
  showNoteLabels,
  onKeyMouseDown,
  onKeyMouseUp,
  subscribeToActiveKeys,
}: {
  keysLayout: PianoKeyInfo[];
  numWhiteKeys: number;
  showNoteLabels: boolean;
  onKeyMouseDown: (pitch: number) => void;
  onKeyMouseUp: (pitch: number) => void;
  subscribeToActiveKeys?: (cb: (keys: Set<number>) => void) => () => void;
}) {
  const [activeVisualKeys, setActiveVisualKeys] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!subscribeToActiveKeys) return;
    return subscribeToActiveKeys(setActiveVisualKeys);
  }, [subscribeToActiveKeys]);

  return (
    <div className="relative w-full h-32 md:h-38 bg-[#0a0a0c] flex select-none overflow-hidden border-b border-white/[0.05]">
      {/* White Keys */}
      {keysLayout.map((key) => {
        if (key.isBlack) return null;

        const isActive = activeVisualKeys.has(key.note);
        const isC = key.label.startsWith('C');
        
        return (
          <button
            key={key.note}
            onMouseDown={() => onKeyMouseDown(key.note)}
            onMouseUp={() => onKeyMouseUp(key.note)}
            onMouseLeave={() => onKeyMouseUp(key.note)}
            onTouchStart={(e) => { e.preventDefault(); onKeyMouseDown(key.note); }}
            onTouchEnd={() => onKeyMouseUp(key.note)}
            style={{ width: `${100 / numWhiteKeys}%` }}
            className={`h-full border-r border-[#161619] flex flex-col justify-end pb-2.5 text-[9px] md:text-[10px] font-sans select-none cursor-pointer relative transition-all duration-75 ${
              isActive 
                ? 'bg-gradient-to-b from-[#fbf4e4] via-[#eedbb6] to-[#d8ba7f] border-b-[2px] border-[#a9884a] warm-key-glow translate-y-[1px]' 
                : 'bg-gradient-to-b from-[#faf8f5] via-[#f4efe5] to-[#e4ded2] text-[#8a857b] active:from-[#ede9df] active:to-[#dcd6c8] border-b-[4px] border-[#c0bbae90]'
            }`}
          >
            {showNoteLabels && (isC || numWhiteKeys < 20) && (
              <span className={`w-full text-center tracking-tight truncate px-0.5 ${
                isActive ? 'text-[#382b14] font-semibold' : 'text-[#8c867c]'
              }`}>
                {key.label}
              </span>
            )}
          </button>
        );
      })}

      {/* Black Keys */}
      {keysLayout.map((key) => {
        if (!key.isBlack) return null;

        const isActive = activeVisualKeys.has(key.note);
        const colWidthPercent = 100 / numWhiteKeys;
        
        const leftOffset = (key.whiteIndex + 0.68) * colWidthPercent;
        const keyWidth = colWidthPercent * 0.64;

        return (
          <button
            key={key.note}
            onMouseDown={() => onKeyMouseDown(key.note)}
            onMouseUp={() => onKeyMouseUp(key.note)}
            onMouseLeave={() => onKeyMouseUp(key.note)}
            onTouchStart={(e) => { e.preventDefault(); onKeyMouseDown(key.note); }}
            onTouchEnd={() => onKeyMouseUp(key.note)}
            style={{ 
              left: `${leftOffset}%`, 
              width: `${keyWidth}%` 
            }}
            className={`h-[64%] absolute z-20 flex flex-col justify-end pb-1.5 text-[8px] font-sans text-center select-none cursor-pointer rounded-b-[2px] border-x border-[#09090b] transition-all duration-75 ${
              isActive 
                ? 'bg-gradient-to-b from-[#5c4923] via-[#3d3016] to-[#241c0b] text-[#eedcb7] border-b-[2px] border-[#8a6e33] shadow-[0_0_10px_rgba(216,186,127,0.3)] translate-y-[1px]' 
                : 'bg-gradient-to-b from-[#222226] via-[#18181b] to-[#101012] text-[#6b675e] border-t border-white/[0.08] border-b-[4px] border-[#060608] shadow-lg active:border-b-[2px]'
            }`}
          >
            {showNoteLabels && numWhiteKeys < 20 && (
              <span className="w-full text-center scale-90 tracking-tighter truncate leading-none">
                {key.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'player' | 'transcriber'>('player');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Player State
  const [songs, setSongs] = useState<Song[]>(SAMPLE_SONGS);
  const [selectedSongId, setSelectedSongId] = useState<string>('bach-prelude');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [tempoScale, setTempoScale] = useState(1.0);
  const [transpose, setTranspose] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [instrument, setInstrument] = useState<InstrumentType>('grand');
  const [sustain, setSustain] = useState<boolean>(false);
  const [release, setRelease] = useState<number>(0.8);
  const [isLoadingSamples, setIsLoadingSamples] = useState<boolean>(false);
  const [loadingInstrument, setLoadingInstrument] = useState<string>('grand');
  const [activeTheme, setActiveTheme] = useState<Theme>(VISUAL_THEMES[0]); // Default Champagne Gold
  
  // Piano view configurations
  const [keyboardRange, setKeyboardRange] = useState<'auto' | 'standard'>('auto');
  const [showNoteLabels, setShowNoteLabels] = useState(true);
  const [waterfallSpeed, setWaterfallSpeed] = useState(0.24); // Pixels per MS

  // A/B Looping
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(true);

  // MIDI input status
  const [midiConnected, setMidiConnected] = useState(false);

  // File loading/parsing status
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Mirelo Audio-to-MIDI Pro Server Transcription States
  const [serverConfig, setServerConfig] = useState<ServerConfigResponse | null>(null);
  const [isCheckingConfig, setIsCheckingConfig] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [transcribeFile, setTranscribeFile] = useState<{ file: File; name: string; size: string; durationSec: number | null; audioUrl?: string } | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<TranscriptionProgress | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [activeTranscription, setActiveTranscription] = useState<NormalizedTranscription | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [manualJobIdInput, setManualJobIdInput] = useState<string>('');
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [transcriptionHistory, setTranscriptionHistory] = useState<NormalizedTranscription[]>([]);
  const [isDebugMode, setIsDebugMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('debug') === '1' || window.location.hash.includes('debug');
    }
    return false;
  });
  const [diagnosticLogs, setDiagnosticLogs] = useState<Array<{ id: string; time: string; type: 'info' | 'success' | 'warn' | 'error'; message: string }>>([
    {
      id: 'init-1',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: 'info',
      message: 'Mirelo Audio-to-MIDI Pro client initialized. Single authoritative audio.currentTime clock active.'
    }
  ]);

  // References & Direct DOM elements
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDropRef = useRef<HTMLDivElement | null>(null);
  const oscilloscopeRef = useRef<HTMLCanvasElement | null>(null);
  const currentTimeMsRef = useRef<number>(0);

  // High-frequency direct DOM refs for buttery 60fps playback without React re-renders
  const timelineProgressRef = useRef<HTMLDivElement | null>(null);
  const timelineThumbRef = useRef<HTMLDivElement | null>(null);
  const timelineTimeTextRef = useRef<HTMLSpanElement | null>(null);
  const statusTimeTextRef = useRef<HTMLSpanElement | null>(null);
  const statusSecondsTextRef = useRef<HTMLSpanElement | null>(null);
  const lastStateUpdateTimeRef = useRef<number>(0);
  const lastActiveVisualKeysRef = useRef<Set<number>>(new Set());
  const renderTriggerRef = useRef<(() => void) | null>(null);

  // Sync ref with currentTimeMs state only when not playing to prevent resetting the clock backwards
  useEffect(() => {
    if (!isPlaying) {
      currentTimeMsRef.current = currentTimeMs;
    }
  }, [currentTimeMs, isPlaying]);

  // Authoritative Audio Duration
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);

  // Mirelo MIDI File Debug State
  interface MidiDebugInfo {
    loaded: boolean;
    midiUrl: string | null;
    fileSize: number | null;
    numTracks: number;
    totalNotes: number;
    durationMs: number;
    ppq: number;
    tempo: number;
    trackNames: string[];
    firstNote: MIDINote | null;
    lastNote: MIDINote | null;
  }
  const [midiDebugInfo, setMidiDebugInfo] = useState<MidiDebugInfo | null>(null);

  // Active song object
  const activeSong = songs.find(s => s.id === selectedSongId) || songs[0];

  // Authoritative duration: Derived directly from MIDI song metadata or note events
  const effectiveDurationMs = useMemo(() => {
    if (activeSong.durationMs && activeSong.durationMs > 0) {
      return activeSong.durationMs;
    }
    return Math.max(1000, activeSong.notes.length > 0 ? activeSong.notes[activeSong.notes.length - 1].time + 2000 : 30000);
  }, [activeSong.durationMs, activeSong.notes]);

  // Derive transposed MIDI note events sorted chronologically for high-performance binary search
  const activeNotes = useMemo<MIDINote[]>(() => {
    const raw = activeSong.notes || [];
    const mapped = transpose === 0 
      ? [...raw] 
      : raw.map(note => ({
          ...note,
          note: Math.max(21, Math.min(108, note.note + transpose))
        }));
    return mapped.sort((a, b) => a.time - b.time);
  }, [activeSong.notes, transpose]);

  // Precalculate max note duration for bounded visible search window
  const maxNoteDuration = useMemo(() => {
    let maxDur = 1000;
    for (let i = 0; i < activeNotes.length; i++) {
      if (activeNotes[i].duration > maxDur) maxDur = activeNotes[i].duration;
    }
    return Math.min(15000, maxDur);
  }, [activeNotes]);

  // Live Active Diagnostics (efficient windowed search on sorted notes)
  const currentAudioClockMs = currentTimeMs;

  const currentlyActiveNotes = useMemo(() => {
    if (activeNotes.length === 0) return [];
    const curTime = currentAudioClockMs;
    const result: MIDINote[] = [];
    let low = 0, high = activeNotes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (activeNotes[mid].time < curTime - maxNoteDuration) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < activeNotes.length; i++) {
      const n = activeNotes[i];
      if (n.time > curTime) break;
      if (curTime < n.time + n.duration) {
        result.push(n);
      }
    }
    return result;
  }, [activeNotes, currentAudioClockMs, maxNoteDuration]);

  const allChords = useMemo(() => {
    return activeSong.chords || activeTranscription?.chords || [];
  }, [activeSong.chords, activeTranscription?.chords]);

  const currentlyActiveChord = useMemo(() => {
    return allChords.find(c => currentAudioClockMs >= c.time && currentAudioClockMs < (c.time + c.duration)) || null;
  }, [allChords, currentAudioClockMs]);

  // Handle parsing & loading real binary .mid file
  const handleParseAndLoadMidiFile = async (midiUrlToUse?: string) => {
    const url = midiUrlToUse || activeSong.rawMidiUrl || activeTranscription?.rawMidiUrl;
    addDiagnosticLog('info', '[MIDI Pipeline] Fetching and parsing binary .mid file...');

    try {
      let arrayBuffer: ArrayBuffer;
      const filename = activeSong.title || 'Transcription';

      if (url) {
        addDiagnosticLog('info', `[MIDI Pipeline] Downloading binary MIDI from URL: ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching .mid file from ${url}`);
        arrayBuffer = await res.arrayBuffer();

        const uint8 = new Uint8Array(arrayBuffer);
        const isMThd = uint8.length >= 14 && uint8[0] === 0x4D && uint8[1] === 0x54 && uint8[2] === 0x68 && uint8[3] === 0x64;
        if (!isMThd) {
          throw new Error('Downloaded file is not a valid Standard MIDI File (expected header signature "MThd").');
        }
      } else {
        addDiagnosticLog('info', '[MIDI Pipeline] Encoding standard Format 0 binary MIDI buffer from current score...');
        arrayBuffer = createMIDIFileBuffer(activeSong.notes, activeSong.bpm, activeSong.title);
      }

      const parsed = parseMIDIFile(arrayBuffer, filename);
      addDiagnosticLog('success', `[MIDI Pipeline] Successfully parsed .mid file! ${parsed.notes.length} notes, ${parsed.numTracks} tracks, ${parsed.ppq} PPQ, ${parsed.fileSize} bytes.`);

      const firstNote = parsed.notes.length > 0 ? parsed.notes[0] : null;
      const lastNote = parsed.notes.length > 0 ? parsed.notes[parsed.notes.length - 1] : null;

      const debugData: MidiDebugInfo = {
        loaded: true,
        midiUrl: url || 'Internal Binary MIDI Buffer',
        fileSize: parsed.fileSize,
        numTracks: parsed.numTracks,
        totalNotes: parsed.notes.length,
        durationMs: parsed.durationMs,
        ppq: parsed.ppq,
        tempo: parsed.bpm,
        trackNames: parsed.trackNames,
        firstNote,
        lastNote,
      };
      setMidiDebugInfo(debugData);

      const newSong: Song = {
        id: `mirelo-midi-${Date.now()}`,
        title: `Parsed MIDI — ${parsed.title}`,
        composer: `${parsed.numTracks} ${parsed.numTracks === 1 ? 'Instrument' : 'Instruments'} · MIDI Score`,
        difficulty: parsed.notes.length > 200 ? 'Advanced' : 'Intermediate',
        genre: 'Imported Score',
        durationMs: parsed.durationMs,
        notes: parsed.notes,
        bpm: parsed.bpm,
        tracks: parsed.tracks.map(t => ({
          id: t.id,
          name: t.name,
          instrument: t.instrument,
          notes: t.notes,
        })),
        rawMidiUrl: url,
      };

      setSongs(prev => [newSong, ...prev.filter(s => s.id !== newSong.id)]);
      setSelectedSongId(newSong.id);
      setCurrentTimeMs(0);
      currentTimeMsRef.current = 0;
      setIsPlaying(false);
      notesScheduledTracker.current.clear();
      synthInstance.silenceAll();

      addDiagnosticLog('success', `[MIDI Pipeline] Loaded parsed .mid score into player! Built-in MIDI sounds ready.`);
    } catch (err: any) {
      addDiagnosticLog('error', `[MIDI Pipeline Error] ${err.message}`);
      alert("Couldn't open your MIDI. Please try again.");
    }
  };

  const handleOpenMireloMidiInStudio = async (targetJobId?: string) => {
    const jobId = targetJobId || activeTranscription?.metadata?.jobId || activeJobId;
    if (!jobId) {
      alert("No active transcription found.");
      return;
    }

    const title = activeTranscription?.title || 'Transcribed Audio';
    addDiagnosticLog('info', `[Mirelo MIDI Import] Downloading exact binary .mid file from /api/transcribe/midi-file/${jobId}...`);

    try {
      const res = await fetch(`/api/transcribe/midi-file/${encodeURIComponent(jobId)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to retrieve binary .mid file from server`);
      }

      let arrayBuffer = await res.arrayBuffer();
      addDiagnosticLog('success', `[Mirelo MIDI Import] Downloaded ${arrayBuffer.byteLength} bytes. Verifying MIDI header signature...`);

      const uint8 = new Uint8Array(arrayBuffer);
      const isMThd = uint8.length >= 14 && uint8[0] === 0x4D && uint8[1] === 0x54 && uint8[2] === 0x68 && uint8[3] === 0x64;

      if (!isMThd) {
        addDiagnosticLog('warn', `[Mirelo MIDI Import] Invalid MIDI signature in response. Rebuilding valid standard Format 0 .mid binary from transcription notes...`);
        const clientNotes = activeTranscription?.notes || [];
        if (clientNotes.length > 0) {
          const midiNotes = normalizedNotesToMIDINotes(clientNotes);
          arrayBuffer = createMIDIFileBuffer(midiNotes, activeTranscription?.tempo || 120, title);
        } else {
          throw new Error('Retrieved invalid MIDI file signature and no notes are loaded to rebuild fallback.');
        }
      }

      const parsed = parseMIDIFile(arrayBuffer, `${title}.mid`);
      addDiagnosticLog('success', `[Mirelo MIDI Import] Existing MIDI parser successfully parsed file! ${parsed.notes.length} notes, ${parsed.numTracks} tracks, ${parsed.ppq} PPQ, duration ${(parsed.durationMs / 1000).toFixed(2)}s.`);

      const newSong: Song = {
        id: `transcribed-${jobId}-${Date.now()}`,
        title: parsed.title && parsed.title !== 'transcription' ? parsed.title : (title !== 'Transcribed Audio' ? title : 'Transcribed Audio'),
        composer: `${parsed.numTracks || 1} ${parsed.numTracks === 1 ? 'Instrument' : 'Instruments'} · Audio to MIDI`,
        difficulty: parsed.notes.length > 200 ? 'Advanced' : 'Intermediate',
        genre: 'Transcribed Score',
        durationMs: parsed.durationMs,
        notes: parsed.notes,
        bpm: parsed.bpm,
        tracks: parsed.tracks.map(t => ({
          id: t.id,
          name: t.name,
          instrument: t.instrument,
          notes: t.notes,
        })),
        rawMidiUrl: `/api/transcribe/midi-file/${jobId}`,
      };

      setSongs(prev => [newSong, ...prev.filter(s => s.id !== newSong.id)]);
      setSelectedSongId(newSong.id);
      setActiveTab('player');
      setCurrentTimeMs(0);
      currentTimeMsRef.current = 0;
      setIsPlaying(false);
      notesScheduledTracker.current.clear();
      synthInstance.silenceAll();

      addDiagnosticLog('success', `[Mirelo MIDI Import] Successfully loaded Mirelo .mid file into Falling-Note Player!`);
    } catch (err: any) {
      addDiagnosticLog('error', `[Mirelo MIDI Import Error] ${err.message}`);
      alert("Couldn't open your MIDI. Please try again.");
    }
  };

  const handleDownloadMireloMidiDirect = async (targetJobId?: string) => {
    const rawId = targetJobId || activeTranscription?.metadata?.jobId || activeJobId;
    const jobId = cleanJobId(rawId);
    if (!jobId) {
      alert("No active transcription found.");
      return;
    }

    try {
      addDiagnosticLog('info', `[Mirelo MIDI Download] Fetching binary MIDI stream from /api/transcribe/download-midi?jobId=${jobId}...`);
      const url = `/api/transcribe/download-midi?jobId=${encodeURIComponent(jobId)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        let errText = '';
        try {
          const jsonErr = await res.json();
          errText = jsonErr.error || JSON.stringify(jsonErr);
        } catch (_) {
          errText = await res.text();
        }
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      // Verify MThd binary header signature
      const isMThd = uint8.length >= 4 && uint8[0] === 0x4D && uint8[1] === 0x54 && uint8[2] === 0x68 && uint8[3] === 0x64;
      if (!isMThd) {
        const preview = new TextDecoder().decode(uint8.subarray(0, 100));
        throw new Error(`Invalid binary header signature: expected "MThd" (0x4D 0x54 0x68 0x64), received "${preview.slice(0, 20)}"`);
      }

      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const cleanTitle = (activeTranscription?.title || activeSong?.title || '')
        .replace(/[/\\:*?"<>|]/g, '')
        .trim();
      const downloadName = cleanTitle ? `${cleanTitle}.mid` : 'Transcription.mid';
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

      addDiagnosticLog('success', `[Mirelo MIDI Download] Validated binary MThd signature (${arrayBuffer.byteLength} bytes). Download started: ${downloadName}`);
    } catch (err: any) {
      addDiagnosticLog('error', `[Mirelo MIDI Download Error] ${err.message}`);
      alert("Couldn't download your MIDI. Please try again.");
    }
  };

  const handleDownloadMidiFile = async () => {
    try {
      let arrayBuffer: ArrayBuffer;
      const filename = `${activeSong.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mid`;

      if (activeSong.rawMidiUrl) {
        const res = await fetch(activeSong.rawMidiUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} downloading MIDI`);
        arrayBuffer = await res.arrayBuffer();
      } else {
        arrayBuffer = createMIDIFileBuffer(activeSong.notes, activeSong.bpm, activeSong.title);
      }

      const blob = new Blob([arrayBuffer], { type: 'audio/midi' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

      addDiagnosticLog('success', `[MIDI Download] Saved ${filename} (${arrayBuffer.byteLength} bytes)`);
    } catch (err: any) {
      addDiagnosticLog('error', `[MIDI Download Error] ${err.message}`);
    }
  };

  // Step & Jump Inspection Handlers
  const handleStepForward100ms = () => {
    const newMs = Math.min(effectiveDurationMs, currentTimeMs + 100);
    setCurrentTimeMs(newMs);
    currentTimeMsRef.current = newMs;
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    if (renderTriggerRef.current) renderTriggerRef.current();
  };

  const handleStepBackward100ms = () => {
    const newMs = Math.max(0, currentTimeMs - 100);
    setCurrentTimeMs(newMs);
    currentTimeMsRef.current = newMs;
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    if (renderTriggerRef.current) renderTriggerRef.current();
  };

  const handleJumpNextChord = () => {
    if (allChords.length === 0) return;
    const target = allChords.find(c => c.time > currentTimeMs + 25);
    if (target) {
      setCurrentTimeMs(target.time);
      currentTimeMsRef.current = target.time;
      notesScheduledTracker.current.clear();
      synthInstance.silenceAll();
      if (renderTriggerRef.current) renderTriggerRef.current();
    }
  };

  const handleJumpPrevChord = () => {
    if (allChords.length === 0) return;
    let targetTime = 0;
    for (let i = allChords.length - 1; i >= 0; i--) {
      if (allChords[i].time < currentTimeMs - 25) {
        targetTime = allChords[i].time;
        break;
      }
    }
    setCurrentTimeMs(targetTime);
    currentTimeMsRef.current = targetTime;
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    if (renderTriggerRef.current) renderTriggerRef.current();
  };

  const handleJumpNextNote = () => {
    if (activeNotes.length === 0) return;
    const target = activeNotes.find(n => n.time > currentTimeMs + 15);
    if (target) {
      setCurrentTimeMs(target.time);
      currentTimeMsRef.current = target.time;
      notesScheduledTracker.current.clear();
      synthInstance.silenceAll();
      if (renderTriggerRef.current) renderTriggerRef.current();
    }
  };

  const handleJumpPrevNote = () => {
    if (activeNotes.length === 0) return;
    let targetTime = 0;
    for (let i = activeNotes.length - 1; i >= 0; i--) {
      if (activeNotes[i].time < currentTimeMs - 15) {
        targetTime = activeNotes[i].time;
        break;
      }
    }
    setCurrentTimeMs(targetTime);
    currentTimeMsRef.current = targetTime;
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    if (renderTriggerRef.current) renderTriggerRef.current();
  };

  // Comprehensive Mirelo Experimental Diagnostic Data Structures
  const diagnosticTargetNotes = useMemo<MIDINote[]>(() => {
    if (activeNotes.length > 0) return activeNotes;
    if (activeTranscription?.notes && activeTranscription.notes.length > 0) {
      return normalizedNotesToMIDINotes(activeTranscription.notes);
    }
    return [];
  }, [activeNotes, activeTranscription]);

  const diagnosticStats = useMemo(() => {
    const notes = diagnosticTargetNotes;
    const chords = activeSong.chords || activeTranscription?.chords || [];
    const numTracks = activeSong.tracks?.length 
      || activeTranscription?.tracks?.length 
      || 1;
    const selectedTrack = selectedTrackIds.length > 0 
      ? selectedTrackIds.join(', ') 
      : 'All Stems / Primary Piano';
    const totalNotes = notes.length;
    const totalChords = chords.length;
    const first10 = notes.slice(0, 10);
    const last5 = notes.length > 5 ? notes.slice(-5) : notes;
    const first10Chords = chords.slice(0, 10);

    const minPitch = notes.length > 0 ? Math.min(...notes.map(n => n.note)) : 0;
    const maxPitch = notes.length > 0 ? Math.max(...notes.map(n => n.note)) : 0;
    const minStart = notes.length > 0 ? Math.min(...notes.map(n => n.time)) : 0;
    const maxStart = notes.length > 0 ? Math.max(...notes.map(n => n.time)) : 0;
    const originalAudioDurationMs = Math.round(((transcribeFile?.durationSec || audioDurationSec || 0)) * 1000);
    const mireloDurationMs = activeTranscription?.durationMs || activeSong.durationMs || (notes.length > 0 ? maxStart + 1000 : 0);

    const isPitchRealistic = minPitch >= 21 && maxPitch <= 108;
    const isDurationRealistic = notes.every(n => n.duration >= 30 && n.duration <= 25000);
    const isSequential = notes.every((n, i) => i === 0 || n.time >= notes[i - 1].time - 50);

    return {
      numTracks,
      selectedTrack,
      totalNotes,
      totalChords,
      chords,
      first10,
      last5,
      first10Chords,
      minPitch,
      maxPitch,
      minStart,
      maxStart,
      originalAudioDurationMs,
      mireloDurationMs,
      isPitchRealistic,
      isDurationRealistic,
      isSequential,
      isRealisticPerformance: totalNotes > 0 && isPitchRealistic && isDurationRealistic && isSequential,
    };
  }, [diagnosticTargetNotes, activeSong, activeTranscription, selectedTrackIds, audioDurationSec]);

  // Log detailed Mirelo diagnostic validation report to console
  useEffect(() => {
    if (diagnosticTargetNotes.length === 0) return;

    const first10Table = diagnosticStats.first10.map((n, i) => ({
      '#': i + 1,
      'Pitch': n.note,
      'Name': midiToNoteName(n.note),
      'Start (ms)': n.time,
      'Start (s)': (n.time / 1000).toFixed(2),
      'Duration (ms)': n.duration,
      'Duration (s)': (n.duration / 1000).toFixed(2),
      'Velocity': n.velocity,
    }));

    const last5Table = diagnosticStats.last5.map((n, i) => ({
      '#': diagnosticStats.totalNotes - diagnosticStats.last5.length + i + 1,
      'Pitch': n.note,
      'Name': midiToNoteName(n.note),
      'Start (ms)': n.time,
      'Start (s)': (n.time / 1000).toFixed(2),
      'Duration (ms)': n.duration,
      'Duration (s)': (n.duration / 1000).toFixed(2),
      'Velocity': n.velocity,
    }));

    console.log('%c[Mirelo Experimental Diagnostics Report]', 'color: #c5a059; font-weight: bold; font-size: 14px;');
    console.table({
      'Number of Tracks': diagnosticStats.numTracks,
      'Selected Track': diagnosticStats.selectedTrack,
      'Total Notes': diagnosticStats.totalNotes,
      'Min Pitch': `${diagnosticStats.minPitch} (${midiToNoteName(diagnosticStats.minPitch)})`,
      'Max Pitch': `${diagnosticStats.maxPitch} (${midiToNoteName(diagnosticStats.maxPitch)})`,
      'Min Start Time': `${diagnosticStats.minStart} ms (${(diagnosticStats.minStart / 1000).toFixed(2)}s)`,
      'Max Start Time': `${diagnosticStats.maxStart} ms (${(diagnosticStats.maxStart / 1000).toFixed(2)}s)`,
      'Original Audio Duration': `${diagnosticStats.originalAudioDurationMs} ms (${(diagnosticStats.originalAudioDurationMs / 1000).toFixed(2)}s)`,
      'Mirelo Duration': `${diagnosticStats.mireloDurationMs} ms (${(diagnosticStats.mireloDurationMs / 1000).toFixed(2)}s)`,
      'Total Chords': diagnosticStats.totalChords,
      'Performance Assessment': diagnosticStats.isRealisticPerformance ? 'Realistic musical score verified' : 'Requires inspection',
    });
    console.log('First 10 Notes:', first10Table);
    console.log('Last 5 Notes:', last5Table);
  }, [diagnosticStats, diagnosticTargetNotes]);

  // Experimental Test Runner States
  const [testStatus, setTestStatus] = useState<string>('Ready for test');
  const [activeTestName, setActiveTestName] = useState<'none' | 'chord' | 'mirelo-notes'>('none');

  const handleRunTestChord = async () => {
    setActiveTestName('chord');
    setTestStatus('Sounding C Major Chord (C4=60, E4=64, G4=67) for 1.0s...');
    addDiagnosticLog('info', '[Test 1: C Major Chord] Triggering MIDI notes 60, 64, 67 for 1.0s...');

    dispatchActiveVisualKeys(new Set([60, 64, 67]));

    const res = await synthInstance.playTestCMajorChord();
    setTestStatus(res.details);
    addDiagnosticLog(res.success ? 'success' : 'error', `[Test 1] ${res.details} (AudioContext: ${res.state})`);

    setTimeout(() => {
      dispatchActiveVisualKeys(new Set(activeComputerKeys.current));
      setActiveTestName('none');
    }, 1100);
  };

  const handleRunTestMireloNotes = async () => {
    const notesToTest = diagnosticStats.first10;
    if (notesToTest.length === 0) {
      setTestStatus('No notes loaded in score to play.');
      addDiagnosticLog('warn', '[Test 2] No notes loaded to play.');
      return;
    }

    setActiveTestName('mirelo-notes');
    setTestStatus(`Playing first ${notesToTest.length} Mirelo notes directly through audio engine...`);
    addDiagnosticLog('info', `[Test 2: Mirelo Notes] Scheduling first ${notesToTest.length} notes (bypassing animation & scheduler)...`);

    const res = await synthInstance.playManualNotesSequence(
      notesToTest,
      (pitch) => {
        const next = new Set(lastActiveVisualKeysRef.current);
        next.add(pitch);
        lastActiveVisualKeysRef.current = next;
        dispatchActiveVisualKeys(next);
      },
      (pitch) => {
        const next = new Set(lastActiveVisualKeysRef.current);
        next.delete(pitch);
        lastActiveVisualKeysRef.current = next;
        dispatchActiveVisualKeys(next);
      },
      () => {
        dispatchActiveVisualKeys(new Set(activeComputerKeys.current));
        setActiveTestName('none');
        setTestStatus(`Completed playback of first ${notesToTest.length} Mirelo notes.`);
        addDiagnosticLog('success', `[Test 2] Manual playback of ${notesToTest.length} notes finished.`);
      }
    );

    setTestStatus(res.details);
    addDiagnosticLog(res.success ? 'success' : 'error', `[Test 2] ${res.details}`);
  };

  const handleStopManualTest = () => {
    synthInstance.stopManualNotesSequence();
    dispatchActiveVisualKeys(new Set(activeComputerKeys.current));
    setActiveTestName('none');
    setTestStatus('Test stopped.');
    addDiagnosticLog('info', 'Manual test playback stopped.');
  };

  // Dedicated 6.0s Mirelo Audio Clock Sync Verification Test Suite (0.0s C4, 1.5s E4, 3.0s G4, 4.5s C5)
  const handleRunSyncVerificationSuite = async () => {
    addDiagnosticLog('info', '[Sync Test] Building 6.0s Clock Sync Verification Suite (Tones: 0.0s C4, 1.5s E4, 3.0s G4, 4.5s C5)...');
    try {
      const suite = await createSyncVerificationSuite();
      setSongs(prev => [suite.song, ...prev.filter(s => s.id !== suite.song.id)]);
      setSelectedSongId(suite.song.id);
      setActiveTranscription(suite.transcription);
      setSelectedTrackIds(['track-sync-primary']);
      setActiveTab('player');
      setCurrentTimeMs(0);
      setIsPlaying(false);
      dispatchActiveVisualKeys(new Set(activeComputerKeys.current));

      setTestStatus('6.0s Clock Sync Verification Suite loaded. Press Play to verify perfect timestamp alignment.');
      addDiagnosticLog('success', '[Sync Test] 6.0s Clock Sync Verification Suite loaded! Synthesizer is locked to the visual waterfall.');
    } catch (err: any) {
      addDiagnosticLog('error', `Failed to initialize sync suite: ${err.message}`);
    }
  };



  // Timing tracking refs for RAF loop
  const requestRef = useRef<number | null>(null);
  const previousTimeRef = useRef<number | null>(null);
  const lastScheduledTimeMs = useRef<number>(0);
  const notesScheduledTracker = useRef<Set<string>>(new Set());

  // Particles for canvas
  const particlesRef = useRef<Particle[]>([]);

  // Subscribe to sample loading states and preload default instrument
  useEffect(() => {
    synthInstance.loadInstrument('grand');
    const unsubscribe = synthInstance.subscribeLoading((loading, id) => {
      setIsLoadingSamples(loading);
      setLoadingInstrument(id);
    });
    return () => unsubscribe();
  }, []);

  // Synchronize synth settings
  useEffect(() => {
    synthInstance.setVolume(isMuted ? 0 : volume);
  }, [volume, isMuted]);

  // Transposition is applied directly at the MIDI note-event level across visualization and audio playback
  useEffect(() => {
    synthInstance.transpose = 0;
  }, []);

  useEffect(() => {
    synthInstance.setInstrument(instrument);
  }, [instrument]);

  useEffect(() => {
    synthInstance.setSustain(sustain);
  }, [sustain]);

  useEffect(() => {
    synthInstance.setRelease(release);
  }, [release]);

  // Web MIDI API connection
  useEffect(() => {
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess()
        .then((access) => {
          setMidiConnected(access.inputs.size > 0);
          access.onstatechange = () => {
            setMidiConnected(access.inputs.size > 0);
          };

          // Attach listener to inputs
          access.inputs.forEach((input) => {
            input.onmidimessage = (message) => {
              if (!message.data || message.data.length < 3) return;
              const status = message.data[0];
              const data1 = message.data[1];
              const data2 = message.data[2];
              const type = status & 0xf0;
              const velocity = data2;
              
              if (type === 0x90 && velocity > 0) {
                // Note ON
                synthInstance.startNote(data1, velocity);
                triggerKeyPress(data1);
              } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
                // Note OFF
                synthInstance.stopNote(data1);
                triggerKeyRelease(data1);
              } else if (type === 0xb0 && data1 === 64) {
                // Sustain Pedal CC 64
                const isPedalDown = data2 >= 64;
                setSustain(isPedalDown);
              }
            };
          });
        })
        .catch(() => {
          setMidiConnected(false);
        });
    }
  }, []);

  // Computer Keyboard Play Along mapping (Home row C4 to C5)
  const keyboardMap: { [key: string]: number } = {
    'a': 60, // C4
    'w': 61, // C#4
    's': 62, // D4
    'e': 63, // D#4
    'd': 64, // E4
    'f': 65, // F4
    't': 66, // F#4
    'g': 67, // G4
    'y': 68, // G#4
    'h': 69, // A4
    'u': 70, // A#4
    'j': 71, // B4
    'k': 72, // C5
  };

  const activeComputerKeys = useRef<Set<number>>(new Set());

  // Isolated listener hub for 88-key piano highlights - avoids triggering root App re-renders
  const visualKeyListenersRef = useRef<Set<(keys: Set<number>) => void>>(new Set());
  const subscribeToActiveKeys = useCallback((cb: (keys: Set<number>) => void) => {
    visualKeyListenersRef.current.add(cb);
    return () => {
      visualKeyListenersRef.current.delete(cb);
    };
  }, []);

  const dispatchActiveVisualKeys = useCallback((keys: Set<number>) => {
    visualKeyListenersRef.current.forEach(cb => cb(keys));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (document.activeElement?.tagName === 'INPUT') return;

      // Spacebar toggles sustain pedal
      if (e.code === 'Space') {
        e.preventDefault();
        setSustain(prev => !prev);
        return;
      }

      const pitch = keyboardMap[e.key.toLowerCase()];
      if (pitch !== undefined) {
        synthInstance.init();
        synthInstance.resume();
        synthInstance.startNote(pitch, 95);
        triggerKeyPress(pitch);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const pitch = keyboardMap[e.key.toLowerCase()];
      if (pitch !== undefined) {
        synthInstance.stopNote(pitch);
        triggerKeyRelease(pitch);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const triggerKeyPress = useCallback((pitch: number) => {
    activeComputerKeys.current.add(pitch);
    const updated = new Set(activeComputerKeys.current);
    lastActiveVisualKeysRef.current = updated;
    dispatchActiveVisualKeys(updated);
    spawnImpactParticles(pitch);
    if (renderTriggerRef.current) renderTriggerRef.current();
  }, [dispatchActiveVisualKeys]);

  const triggerKeyRelease = useCallback((pitch: number) => {
    activeComputerKeys.current.delete(pitch);
    const updated = new Set(activeComputerKeys.current);
    lastActiveVisualKeysRef.current = updated;
    dispatchActiveVisualKeys(updated);
    if (renderTriggerRef.current) renderTriggerRef.current();
  }, [dispatchActiveVisualKeys]);

  // Keyboard range calculation based on active transposed notes
  const getPitchBounds = () => {
    if (activeNotes.length === 0) {
      return { min: 36, max: 96 }; // Standard 5 Octaves (C2 to C7)
    }
    
    let min = 127;
    let max = 0;
    activeNotes.forEach(n => {
      if (n.note < min) min = n.note;
      if (n.note > max) max = n.note;
    });

    if (keyboardRange === 'standard') {
      const startNote = Math.max(21, Math.min(36, Math.floor(min / 12) * 12));
      const endNote = Math.min(108, Math.max(96, Math.ceil(max / 12) * 12));
      return { min: startNote, max: endNote };
    }

    const startNote = Math.max(21, Math.floor(min / 12) * 12);
    const endNote = Math.min(108, Math.ceil(max / 12) * 12);
    return { min: startNote, max: endNote };
  };

  const { min: minPitch, max: maxPitch } = useMemo(() => {
    return getPitchBounds();
  }, [keyboardRange, activeNotes]);

  // White and black key geometry map
  const getNoteLayout = (startNote: number, endNote: number) => {
    const layout: PianoKeyInfo[] = [];
    let whiteCount = 0;
    
    for (let note = startNote; note <= endNote; note++) {
      const octave = Math.floor(note / 12) - 1;
      const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const name = noteNames[note % 12];
      const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
      
      layout.push({
        note,
        isBlack,
        label: `${name}${octave}`,
        whiteIndex: isBlack ? -1 : whiteCount
      });
      
      if (!isBlack) {
        whiteCount++;
      }
    }
    
    for (let i = 0; i < layout.length; i++) {
      if (layout[i].isBlack) {
        let prevWhiteIndex = 0;
        for (let j = i - 1; j >= 0; j--) {
          if (!layout[j].isBlack) {
            prevWhiteIndex = layout[j].whiteIndex;
            break;
          }
        }
        layout[i].whiteIndex = prevWhiteIndex;
      }
    }
    
    return { layout, whiteCount };
  };

  const { layout: keysLayout, whiteCount: numWhiteKeys } = useMemo(() => {
    return getNoteLayout(minPitch, maxPitch);
  }, [minPitch, maxPitch]);

  // High-performance O(1) pitch lookup map for canvas columns
  const keysLayoutMap = useMemo(() => {
    const map = new Map<number, PianoKeyInfo>();
    for (let i = 0; i < keysLayout.length; i++) {
      map.set(keysLayout[i].note, keysLayout[i]);
    }
    return map;
  }, [keysLayout]);

  const getNoteColumnX = (pitch: number, canvasWidth: number) => {
    const keyInfo = keysLayoutMap.get(pitch);
    if (!keyInfo) return { x: 0, width: 0 };

    const colWidth = canvasWidth / numWhiteKeys;

    if (keyInfo.isBlack) {
      const x = (keyInfo.whiteIndex + 0.68) * colWidth;
      const width = colWidth * 0.64;
      return { x, width };
    } else {
      const x = keyInfo.whiteIndex * colWidth;
      const width = colWidth - 1;
      return { x, width };
    }
  };

  // Subtle warm amber dust motes instead of bright confetti
  const spawnImpactParticles = (pitch: number) => {
    const canvas = canvasRef.current;
    if (!canvas || particlesRef.current.length > 28) return;

    const { x, width } = getNoteColumnX(pitch, canvas.width);
    const centerX = x + width / 2;
    const playheadY = canvas.height - 4 * (window.devicePixelRatio || 1);

    for (let i = 0; i < 2; i++) {
      particlesRef.current.push({
        x: centerX + (Math.random() - 0.5) * 6,
        y: playheadY + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -1.0 - Math.random() * 1.8,
        size: 1.2 + Math.random() * 1.8,
        color: activeTheme.primary,
        alpha: 0.75
      });
    }
  };

  // High-efficiency oscilloscope: only animates when audio is actively playing, zero allocation per frame
  useEffect(() => {
    let oscFrameId: number | null = null;
    const canvas = oscilloscopeRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawBaseline = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#202025';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    if (!isPlaying) {
      drawBaseline();
      return () => {
        if (oscFrameId !== null) cancelAnimationFrame(oscFrameId);
      };
    }

    const analyser = synthInstance.getAnalyser();
    const bufferLength = analyser ? analyser.frequencyBinCount : 256;
    const dataArray = new Uint8Array(bufferLength);

    const drawOsc = () => {
      const currentAnalyser = synthInstance.getAnalyser();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!currentAnalyser) {
        drawBaseline();
        return;
      }

      currentAnalyser.getByteTimeDomainData(dataArray);

      ctx.lineWidth = 1.25;
      ctx.strokeStyle = '#c5a059';
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      oscFrameId = requestAnimationFrame(drawOsc);
    };

    oscFrameId = requestAnimationFrame(drawOsc);
    return () => {
      if (oscFrameId !== null) cancelAnimationFrame(oscFrameId);
    };
  }, [isPlaying]);

  // Dedicated Canvas Resize Observer with requestAnimationFrame decoupling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let resizeFrameId: number | null = null;

    const updateDimensions = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
      const targetHeight = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
    };

    updateDimensions();

    const observer = new ResizeObserver(() => {
      if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
      resizeFrameId = requestAnimationFrame(() => {
        updateDimensions();
      });
    });

    observer.observe(canvas);

    // Suppress benign ResizeObserver notifications from browser window
    const errorHandler = (e: ErrorEvent) => {
      if (e.message && e.message.includes('ResizeObserver')) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', errorHandler);

    return () => {
      if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
      observer.disconnect();
      window.removeEventListener('error', errorHandler);
    };
  }, []);

  // Main Single-Source-of-Truth Falling Notes Animation Canvas Loop (MIDI Player Engine)
  useEffect(() => {
    if (activeTab !== 'player') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderLoop = () => {
      let currentPlaybackTimeMs = currentTimeMsRef.current;

      if (isPlaying) {
        const nowMs = performance.now();
        let nextTimeMs = currentTimeMsRef.current;

        // Monotonic performance.now() timeline clock (completely decoupled from audio hardware buffers)
        if (previousTimeRef.current !== null) {
          const deltaMs = (nowMs - previousTimeRef.current) * tempoScale;
          nextTimeMs = currentTimeMsRef.current + deltaMs;
        }
        previousTimeRef.current = nowMs;

        // A/B Looping bounds
        if (loopEnabled && loopA !== null && loopB !== null && nextTimeMs >= loopB) {
          nextTimeMs = loopA;
          lastScheduledTimeMs.current = loopA;
          notesScheduledTracker.current.clear();
          synthInstance.silenceAll();
        }

        // End of song playback
        if (nextTimeMs >= effectiveDurationMs) {
          nextTimeMs = 0;
          setIsPlaying(false);
          lastScheduledTimeMs.current = 0;
          notesScheduledTracker.current.clear();
          synthInstance.silenceAll();
          setCurrentTimeMs(0);
          dispatchActiveVisualKeys(new Set(activeComputerKeys.current));
        } else {
          // Schedule MIDI notes to built-in synthesizer using fast high-water mark window
          const lookaheadMs = 120;
          const windowStart = lastScheduledTimeMs.current;
          const windowEnd = nextTimeMs + lookaheadMs;

          if (windowEnd > windowStart) {
            let sLow = 0, sHigh = activeNotes.length;
            while (sLow < sHigh) {
              const mid = (sLow + sHigh) >> 1;
              if (activeNotes[mid].time < windowStart) sLow = mid + 1;
              else sHigh = mid;
            }

            for (let i = sLow; i < activeNotes.length; i++) {
              const n = activeNotes[i];
              if (n.time >= windowEnd) break;
              if (n.time >= windowStart) {
                const delaySec = Math.max(0, (n.time - nextTimeMs) / 1000);
                const durSec = Math.max(0.08, n.duration / 1000);
                try {
                  synthInstance.playNote(n.note, delaySec, durSec, n.velocity);
                } catch (_) {}
              }
            }
            lastScheduledTimeMs.current = windowEnd;
          }
        }

        currentTimeMsRef.current = nextTimeMs;

        // High-frequency direct DOM updates for timeline without triggering React re-renders
        if (timelineProgressRef.current && effectiveDurationMs > 0) {
          const pct = Math.min(100, Math.max(0, (nextTimeMs / effectiveDurationMs) * 100));
          timelineProgressRef.current.style.width = `${pct}%`;
          if (timelineThumbRef.current) {
            timelineThumbRef.current.style.left = `calc(${pct}% - 6px)`;
          }
        }
        const formattedTime = formatTimeWithMs(nextTimeMs);
        if (timelineTimeTextRef.current) {
          timelineTimeTextRef.current.textContent = formattedTime;
        }
        if (statusTimeTextRef.current) {
          statusTimeTextRef.current.textContent = formattedTime;
        }
        if (statusSecondsTextRef.current) {
          statusSecondsTextRef.current.textContent = `(${(nextTimeMs / 1000).toFixed(3)}s)`;
        }

        // Throttle React state updates to ~4Hz (every 250ms) to update low-frequency UI like chord display
        if (nowMs - lastStateUpdateTimeRef.current >= 250) {
          lastStateUpdateTimeRef.current = nowMs;
          setCurrentTimeMs(nextTimeMs);
        }
      } else {
        previousTimeRef.current = null;
      }

      currentPlaybackTimeMs = currentTimeMsRef.current;

      // --- CANVAS WATERFALL RENDERING ---
      ctx.fillStyle = '#08080a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const dpr = window.devicePixelRatio || 1;
      const playheadY = canvas.height - 4 * dpr;

      // 1. Subtle rhythmic beat grid lines (batched single stroke)
      const beatIntervalMs = (60000 / (Math.max(30, activeSong.bpm) * tempoScale));
      const beatPx = beatIntervalMs * waterfallSpeed * dpr;
      if (beatPx > 20) {
        const beatOffset = (currentPlaybackTimeMs * waterfallSpeed * dpr) % beatPx;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = playheadY - beatOffset; y >= 0; y -= beatPx) {
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
        }
        ctx.stroke();
      }

      // 2. Draw subtle background vertical lane dividers (batched into 2 path passes)
      const colWidth = canvas.width / numWhiteKeys;
      ctx.lineWidth = 1;

      // Regular white key dividers
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.012)';
      ctx.beginPath();
      keysLayout.forEach((key) => {
        if (!key.isBlack && !key.label.startsWith('C')) {
          const x = key.whiteIndex * colWidth + colWidth - 1;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
        }
      });
      ctx.stroke();

      // Octave C key dividers
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.beginPath();
      keysLayout.forEach((key) => {
        if (!key.isBlack && key.label.startsWith('C')) {
          const x = key.whiteIndex * colWidth + colWidth - 1;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
        }
      });
      ctx.stroke();

      // 3. Playhead collision strike line (Authoritative contact line with piano)
      ctx.strokeStyle = 'rgba(216, 186, 127, 0.75)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, playheadY);
      ctx.lineTo(canvas.width, playheadY);
      ctx.stroke();

      ctx.fillStyle = '#d8ba7f';
      ctx.beginPath();
      ctx.arc(6 * dpr, playheadY, 2.5 * dpr, 0, Math.PI * 2);
      ctx.arc(canvas.width - 6 * dpr, playheadY, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      const notesHittingThisFrame = new Set<number>();
      const speedDpr = waterfallSpeed * dpr;

      // 4. Draw falling notes (using binary search windowed scan)
      const maxVisibleTime = currentPlaybackTimeMs + (playheadY + 20) / speedDpr;
      const minVisibleTime = currentPlaybackTimeMs - (canvas.height - playheadY + 20) / speedDpr - maxNoteDuration;

      let vLow = 0, vHigh = activeNotes.length;
      while (vLow < vHigh) {
        const mid = (vLow + vHigh) >> 1;
        if (activeNotes[mid].time < minVisibleTime) vLow = mid + 1;
        else vHigh = mid;
      }

      for (let i = vLow; i < activeNotes.length; i++) {
        const note = activeNotes[i];
        if (note.time > maxVisibleTime) {
          break; // subsequent notes are off screen at the top
        }

        const bottomY = playheadY - (note.time - currentPlaybackTimeMs) * speedDpr;
        const topY = bottomY - note.duration * speedDpr;

        if (bottomY < -20 || topY > canvas.height + 20) continue;

        const isActive = currentPlaybackTimeMs >= note.time && currentPlaybackTimeMs < (note.time + note.duration);

        if (isActive) {
          notesHittingThisFrame.add(note.note);
          if (isPlaying && Math.random() > 0.88) {
            spawnImpactParticles(note.note);
          }
        }

        const { x, width } = getNoteColumnX(note.note, canvas.width);
        const drawWidth = Math.max(1, width - 2);
        const noteHeight = Math.max(4 * dpr, bottomY - topY);
        const maxRadius = Math.max(0, Math.min(drawWidth / 2, noteHeight / 2));
        const radius = Math.max(0, Math.min(3 * dpr, maxRadius));

        if (isActive) {
          // Subtle warm glow halo without expensive canvas shadowBlur
          ctx.fillStyle = activeTheme.glow;
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x - 1, topY - 1, drawWidth + 2, noteHeight + 2, radius + 1);
          } else {
            ctx.rect(x - 1, topY - 1, drawWidth + 2, noteHeight + 2);
          }
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x + 1, topY, drawWidth, noteHeight, radius);
        } else {
          ctx.rect(x + 1, topY, drawWidth, noteHeight);
        }

        ctx.fillStyle = isActive ? '#f5e4bb' : (activeTheme.primary + 'c0');
        ctx.fill();

        if (isActive) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.fillRect(x + 2, topY + 1.5, drawWidth - 2, 2 * dpr);
        }

        if (showNoteLabels && noteHeight > 14 * dpr && drawWidth > 14 * dpr) {
          const noteName = midiToNoteName(note.note);
          ctx.fillStyle = isActive ? '#261b07' : 'rgba(255, 255, 255, 0.72)';
          ctx.font = `600 ${Math.min(9 * dpr, drawWidth * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(noteName, x + 1 + drawWidth / 2, topY + noteHeight / 2);
        }
      }

      // Synchronize note hits with virtual visual key highlights only when changed
      if (isPlaying) {
        const lastKeys = lastActiveVisualKeysRef.current;
        const compKeys = activeComputerKeys.current;
        let isDiff = false;
        if (lastKeys.size !== (notesHittingThisFrame.size + compKeys.size)) {
          isDiff = true;
        } else {
          for (const k of notesHittingThisFrame) {
            if (!lastKeys.has(k)) { isDiff = true; break; }
          }
          if (!isDiff) {
            for (const k of compKeys) {
              if (!lastKeys.has(k)) { isDiff = true; break; }
            }
          }
        }

        if (isDiff) {
          const merged = new Set<number>(compKeys);
          notesHittingThisFrame.forEach(n => merged.add(n));
          lastActiveVisualKeysRef.current = merged;
          dispatchActiveVisualKeys(merged);
        }
      }

      // 5. Update and render warm ambient particles (batched zero-allocation draw)
      const particles = particlesRef.current;
      if (particles.length > 0) {
        ctx.fillStyle = activeTheme.primary;
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.03;
          p.alpha -= 0.024;

          if (p.alpha <= 0) {
            particles.splice(i, 1);
            continue;
          }

          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.beginPath();
          const particleRadius = Math.max(0.5, (p.size || 1) * dpr);
          ctx.arc(p.x, p.y, particleRadius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1.0;
      }

      // Pause loop if not playing and particles are depleted
      if (!isPlaying && particlesRef.current.length === 0) {
        requestRef.current = null;
        return;
      }

      requestRef.current = requestAnimationFrame(renderLoop);
    };

    renderTriggerRef.current = () => {
      if (requestRef.current === null) {
        requestRef.current = requestAnimationFrame(renderLoop);
      }
    };

    if (requestRef.current !== null) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    requestRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      renderTriggerRef.current = null;
    };
  }, [activeTab, isPlaying, activeSong, activeNotes, keysLayout, numWhiteKeys, keysLayoutMap, waterfallSpeed, activeTheme, tempoScale, loopEnabled, loopA, loopB, showNoteLabels, effectiveDurationMs, maxNoteDuration]);

  const handleSongChange = (songId: string) => {
    setSelectedSongId(songId);
    setIsPlaying(false);
    setCurrentTimeMs(0);
    currentTimeMsRef.current = 0;
    lastStateUpdateTimeRef.current = performance.now();
    lastScheduledTimeMs.current = 0;
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    lastActiveVisualKeysRef.current = new Set(activeComputerKeys.current);
    dispatchActiveVisualKeys(new Set(activeComputerKeys.current));
    setLoopA(null);
    setLoopB(null);
    if (timelineProgressRef.current) timelineProgressRef.current.style.width = '0%';
    if (timelineThumbRef.current) timelineThumbRef.current.style.left = '-6px';
    if (timelineTimeTextRef.current) timelineTimeTextRef.current.textContent = '0:00.00';
    if (statusTimeTextRef.current) statusTimeTextRef.current.textContent = '0:00.00';
    if (statusSecondsTextRef.current) statusSecondsTextRef.current.textContent = '(0.000s)';
    if (renderTriggerRef.current) renderTriggerRef.current();
  };

  const handlePlayPause = () => {
    // Synchronously unlock browser AudioContext on user gesture
    synthInstance.unlockAudio();

    if (isPlaying) {
      setIsPlaying(false);
      lastScheduledTimeMs.current = currentTimeMsRef.current;
      notesScheduledTracker.current.clear();
      synthInstance.silenceAll();
      lastActiveVisualKeysRef.current = new Set(activeComputerKeys.current);
      dispatchActiveVisualKeys(new Set(activeComputerKeys.current));
      if (renderTriggerRef.current) renderTriggerRef.current();
    } else {
      // If at or near the end of the song, restart from beginning
      if (currentTimeMsRef.current >= (effectiveDurationMs - 100)) {
        currentTimeMsRef.current = 0;
        setCurrentTimeMs(0);
        lastScheduledTimeMs.current = 0;
      } else {
        lastScheduledTimeMs.current = currentTimeMsRef.current;
      }

      setUploadError(null);
      previousTimeRef.current = performance.now();
      notesScheduledTracker.current.clear();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    setIsPlaying(false);
    lastScheduledTimeMs.current = 0;
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    setCurrentTimeMs(0);
    currentTimeMsRef.current = 0;
    lastStateUpdateTimeRef.current = performance.now();
    lastActiveVisualKeysRef.current = new Set(activeComputerKeys.current);
    dispatchActiveVisualKeys(new Set(activeComputerKeys.current));
    if (timelineProgressRef.current) timelineProgressRef.current.style.width = '0%';
    if (timelineThumbRef.current) timelineThumbRef.current.style.left = '-6px';
    if (timelineTimeTextRef.current) timelineTimeTextRef.current.textContent = '0:00.00';
    if (statusTimeTextRef.current) statusTimeTextRef.current.textContent = '0:00.00';
    if (statusSecondsTextRef.current) statusSecondsTextRef.current.textContent = '(0.000s)';
    if (renderTriggerRef.current) renderTriggerRef.current();
  };

  const handleSeek = (timeVal: number) => {
    setCurrentTimeMs(timeVal);
    currentTimeMsRef.current = timeVal;
    lastStateUpdateTimeRef.current = performance.now();
    lastScheduledTimeMs.current = timeVal;
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    if (timelineProgressRef.current && effectiveDurationMs > 0) {
      const pct = Math.min(100, Math.max(0, (timeVal / effectiveDurationMs) * 100));
      timelineProgressRef.current.style.width = `${pct}%`;
      if (timelineThumbRef.current) {
        timelineThumbRef.current.style.left = `calc(${pct}% - 6px)`;
      }
    }
    const formatted = formatTimeWithMs(timeVal);
    if (timelineTimeTextRef.current) timelineTimeTextRef.current.textContent = formatted;
    if (statusTimeTextRef.current) statusTimeTextRef.current.textContent = formatted;
    if (statusSecondsTextRef.current) statusSecondsTextRef.current.textContent = `(${(timeVal / 1000).toFixed(3)}s)`;
    if (renderTriggerRef.current) renderTriggerRef.current();
  };

  const handleTransposeChange = (delta: number) => {
    setTranspose(prev => Math.max(-12, Math.min(12, prev + delta)));
  };

  const handleTransposeSet = (val: number) => {
    setTranspose(Math.max(-12, Math.min(12, val)));
  };

  const handleKeyMouseDown = useCallback((pitch: number) => {
    synthInstance.init();
    synthInstance.resume();
    synthInstance.startNote(pitch, 95);
    triggerKeyPress(pitch);
  }, [triggerKeyPress]);

  const handleKeyMouseUp = useCallback((pitch: number) => {
    synthInstance.stopNote(pitch);
    triggerKeyRelease(pitch);
  }, [triggerKeyRelease]);

  const handleCustomMIDIUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target?.result as ArrayBuffer;
        const parsed = parseMIDIFile(arrayBuffer, file.name);

        const newSong: Song = {
          id: `custom-${Date.now()}`,
          title: parsed.title,
          composer: 'Imported Score',
          difficulty: 'Intermediate',
          genre: 'User File',
          durationMs: parsed.durationMs,
          notes: parsed.notes,
          bpm: parsed.bpm,
        };

        setSongs(prev => [newSong, ...prev]);
        setSelectedSongId(newSong.id);
        setUploadError(null);
        setCurrentTimeMs(0);
        setIsPlaying(false);
      } catch (err: any) {
        setUploadError(err?.message || 'Unable to parse MIDI format. Please ensure it is a valid Standard MIDI file.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const mill = Math.floor((ms % 1000) / 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${mill}`;
  };

  const formatTimeWithMs = (ms: number) => {
    const totalSeconds = Math.max(0, ms) / 1000;
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const mill = Math.floor(Math.max(0, ms) % 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${mill.toString().padStart(3, '0')}`;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndPrepAudio(file);
    }
  };

  const addDiagnosticLog = (type: 'info' | 'success' | 'warn' | 'error', message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDiagnosticLogs(prev => [
      { id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, time, type, message },
      ...prev.slice(0, 49)
    ]);
  };

  const getFriendlyProgressMessage = (p: TranscriptionProgress | null): string => {
    if (!p) return 'Preparing transcription...';
    if (p.stage === 'uploading') return 'Uploading audio file...';
    if (p.stage === 'submitting-job') return 'Processing audio with neural transcription...';
    if (p.stage === 'processing') return 'Analyzing instruments, harmony & polyphonic notes...';
    if (p.stage === 'complete') return 'Your MIDI score is ready!';
    if (p.stage === 'error') return 'Transcription encountered an issue.';
    const rawMsg = p.message || 'Transcribing audio...';
    return rawMsg
      .replace(/Mirelo\s*(GPU\s*cluster|pipeline|server)?/gi, 'neural audio engine')
      .replace(/ticket endpoint/gi, 'secure storage')
      .replace(/GPU cluster/gi, 'audio engine');
  };

  const formatTrackName = (name: string): string => {
    if (!name) return 'Instrument';
    return name
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  };

  // Helper to cleanly activate a completed transcription in Studio using direct parseMIDIFile on binary .mid artifact
  const applyCompletedTranscription = useCallback(async (result: NormalizedTranscription, switchTab: boolean = true, explicitJobId?: string) => {
    setActiveTranscription(result);
    const preferred = getPreferredTrackIds(result.tracks);
    setSelectedTrackIds(preferred);
    setTranscriptionHistory(prev => [result, ...prev.filter(t => t.id !== result.id)]);

    const rawJobId = explicitJobId || result.metadata?.jobId;
    const jobId = cleanJobId(rawJobId);

    if (!jobId) {
      console.error('[Mirelo Direct] No valid Mirelo Job ID provided to applyCompletedTranscription');
      setTranscribeError("Couldn't retrieve the MIDI file for this transcription. Please try again.");
      addDiagnosticLog('error', 'Studio transition aborted: Missing valid Mirelo Job ID');
      return;
    }

    let newSong: Song;

    try {
      console.log(`[Mirelo Direct] Requesting binary .mid artifact for real Mirelo job ID: "${jobId}"...`);
      const midRes = await fetch(`/api/transcribe/midi-file/${encodeURIComponent(jobId)}`);
      if (!midRes.ok) throw new Error(`HTTP ${midRes.status} fetching binary .mid file for job ${jobId}`);
      const arrayBuffer = await midRes.arrayBuffer();

      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const sha256 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const parsed = parseMIDIFile(arrayBuffer, result.title);

      console.log(`[Mirelo Direct] Downloaded bytes: ${arrayBuffer.byteLength}`);
      console.log(`[Mirelo Direct] SHA-256: ${sha256}`);
      console.log(`[Mirelo Direct] parseMIDIFile() note count: ${parsed.notes.length}`);

      newSong = {
        id: `transcribed-${jobId}-${Date.now()}`,
        title: parsed.title && parsed.title !== 'transcription' ? parsed.title : (transcribeFile?.name ? transcribeFile.name.replace(/\.[^/.]+$/, '') : 'Transcribed Audio'),
        composer: `${parsed.numTracks || 1} ${parsed.numTracks === 1 ? 'Instrument' : 'Instruments'} · Audio to MIDI`,
        difficulty: parsed.notes.length > 200 ? 'Advanced' : 'Intermediate',
        genre: 'Transcribed Score',
        durationMs: parsed.durationMs,
        notes: parsed.notes,
        bpm: parsed.bpm,
        tracks: parsed.tracks.map(t => ({
          id: t.id,
          name: t.name,
          instrument: t.instrument,
          notes: t.notes,
        })),
        rawMidiUrl: `/api/transcribe/midi-file/${jobId}`,
      };

      console.log(`[Mirelo Direct] Song notes.length after applyCompletedTranscription: ${newSong.notes.length}`);
    } catch (err: any) {
      console.error('[Mirelo Direct] Binary fetch failed:', err.message);
      setTranscribeError(`Failed to load binary MIDI artifact: ${err.message}`);
      addDiagnosticLog('error', `Studio transition aborted: ${err.message}`);
      return;
    }

    setSongs(prev => [newSong, ...prev.filter(s => s.id !== newSong.id)]);
    setSelectedSongId(newSong.id);
    setCurrentTimeMs(0);
    currentTimeMsRef.current = 0;
    setIsPlaying(false);
    notesScheduledTracker.current.clear();
    synthInstance.silenceAll();
    
    if (switchTab) {
      setActiveTab('player');
    }

    addDiagnosticLog('success', `[Studio Transition] Active song updated to "${newSong.title}" (${newSong.notes.length} notes, ${newSong.tracks?.length || 1} tracks).`);
  }, []);

  // Check Mirelo server backend configuration and restore active job if present
  useEffect(() => {
    setIsCheckingConfig(true);
    checkMireloServerConfig()
      .then(cfg => {
        setServerConfig(cfg);
        setIsCheckingConfig(false);
        if (cfg.hasApiKey) {
          addDiagnosticLog('success', 'Mirelo backend ready. MIRELO_API_KEY detected securely in server environment.');
        } else {
          addDiagnosticLog('warn', 'MIRELO_API_KEY not found on server. Live transcription requires the server secret, or use the multi-track test arpeggio.');
        }
      })
      .catch(err => {
        setIsCheckingConfig(false);
        addDiagnosticLog('error', `Failed to reach /api/transcribe/config: ${err.message}`);
      });

    // Check for pending active job in localStorage
    const savedJobId = cleanJobId(localStorage.getItem('mirelo_active_job_id'));
    const savedFileName = localStorage.getItem('mirelo_active_job_name') || 'Recovered Audio';
    if (savedJobId) {
      setActiveJobId(savedJobId);
      addDiagnosticLog('info', `Found active Mirelo job in storage (${savedJobId}). Resuming status polling...`);
      setIsTranscribing(true);

      resumeMireloJob(savedJobId, savedFileName, (p) => {
        setTranscribeProgress(p);
        addDiagnosticLog('info', `[${p.stage.toUpperCase()}] ${p.message}`);
      })
        .then((result) => {
          localStorage.removeItem('mirelo_active_job_id');
          setActiveJobId(null);
          applyCompletedTranscription(result, true, savedJobId);
        })
        .catch((err) => {
          setTranscribeError(`Could not recover job ${savedJobId}: ${err.message}`);
          addDiagnosticLog('error', `Job recovery notice: ${err.message}`);
        })
        .finally(() => {
          setIsTranscribing(false);
        });
    }
  }, [applyCompletedTranscription]);

  // Mobile Safari Lifecycle Auto-Recovery (visibilitychange, pageshow, focus)
  useEffect(() => {
    const handleMobileResume = () => {
      if (document.visibilityState === 'visible') {
        const savedJobId = localStorage.getItem('mirelo_active_job_id');
        const targetId = activeJobId || savedJobId;
        if (targetId && !isTranscribing) {
          console.log(`[Lifecycle:Resume] Tab active / resumed from background. Checking Mirelo job ${targetId}...`);
          handleResumeExistingJob(targetId);
        }
      }
    };

    document.addEventListener('visibilitychange', handleMobileResume);
    window.addEventListener('pageshow', handleMobileResume);
    window.addEventListener('focus', handleMobileResume);

    return () => {
      document.removeEventListener('visibilitychange', handleMobileResume);
      window.removeEventListener('pageshow', handleMobileResume);
      window.removeEventListener('focus', handleMobileResume);
    };
  }, [activeJobId, isTranscribing]);

  const selectAudioFileViaPicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndPrepAudio(file);
    }
  };

  const validateAndPrepAudio = async (file: File) => {
    setTranscribeError(null);
    setTranscribeProgress(null);

    // Revoke previous transcribe audio object URL if present
    if (transcribeFile?.audioUrl && transcribeFile.audioUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(transcribeFile.audioUrl);
      } catch (_) {}
    }

    const allowedExtensions = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'webm'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    if (!ext || !allowedExtensions.includes(ext)) {
      setTranscribeError('Please upload an audio file in MP3, WAV, FLAC, M4A, or OGG format.');
      addDiagnosticLog('error', `Invalid file extension "${ext}". Allowed: ${allowedExtensions.join(', ')}`);
      return;
    }

    const sizeStr = file.size > 1024 * 1024 
      ? (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      : (file.size / 1024).toFixed(0) + ' KB';

    addDiagnosticLog('info', `Selected "${file.name}" (${sizeStr}, type: ${file.type || 'audio/' + ext})`);

    // Quick duration probe using HTML5 Audio with proper resource cleanup
    try {
      const audioUrl = URL.createObjectURL(file);
      const audio = new Audio();

      const duration = await new Promise<number>((resolve) => {
        let isDone = false;
        const cleanup = (val: number) => {
          if (isDone) return;
          isDone = true;
          clearTimeout(timer);
          audio.onloadedmetadata = null;
          audio.onerror = null;
          audio.src = '';
          resolve(val);
        };
        const timer = setTimeout(() => cleanup(0), 1200);
        audio.onloadedmetadata = () => cleanup(audio.duration || 0);
        audio.onerror = () => cleanup(0);
        audio.src = audioUrl;
      });

      setTranscribeFile({
        file,
        name: file.name,
        size: sizeStr,
        durationSec: duration > 0 ? duration : null,
        audioUrl,
      });
    } catch {
      const audioUrl = URL.createObjectURL(file);
      setTranscribeFile({
        file,
        name: file.name,
        size: sizeStr,
        durationSec: null,
        audioUrl,
      });
    }
  };

  const handleStartMireloTranscription = async () => {
    if (!transcribeFile || isTranscribing) return;

    setIsTranscribing(true);
    setTranscribeError(null);
    addDiagnosticLog('info', `Starting Mirelo Audio-to-MIDI Pro transcription for "${transcribeFile.name}"...`);

    let createdJobId = '';

    try {
      const result = await transcribeAudioWithMirelo(
        transcribeFile.file,
        (p: TranscriptionProgress) => {
          setTranscribeProgress(p);
          addDiagnosticLog('info', `[${p.stage.toUpperCase()}] ${p.message}`);
        },
        (jobId: string, fileName: string) => {
          const cleanId = cleanJobId(jobId);
          createdJobId = cleanId;
          setActiveJobId(cleanId);
          localStorage.setItem('mirelo_active_job_id', cleanId);
          localStorage.setItem('mirelo_active_job_name', fileName);
          addDiagnosticLog('success', `Mirelo assigned Job ID: ${cleanId} (persisted for recovery)`);
        }
      );

      if (transcribeFile.audioUrl) {
        result.audioUrl = transcribeFile.audioUrl;
      }

      localStorage.removeItem('mirelo_active_job_id');
      setActiveJobId(null);
      applyCompletedTranscription(result, true, createdJobId);
    } catch (err: any) {
      let msg = err.message || 'Transcription failed';
      if (msg.includes('did not match the expected pattern')) {
        msg = 'Invalid character in audio filename or request structure. The filename has been sanitized. Please try uploading again.';
      } else if (msg.includes('402') || msg.toLowerCase().includes('credit')) {
        msg = 'Transcription Credit Limit Exceeded: The audio file requires more processing credits than currently available. Please upload a shorter audio snippet (under 15-30 seconds), or click "Try Sample Recording" below.';
      }
      setTranscribeError(msg);
      addDiagnosticLog('error', `Transcription error: ${msg}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleResumeExistingJob = async (jobIdToUse?: string) => {
    const targetId = cleanJobId(jobIdToUse || manualJobIdInput || '');
    if (!targetId || isTranscribing) return;

    setIsTranscribing(true);
    setTranscribeError(null);
    setActiveJobId(targetId);
    localStorage.setItem('mirelo_active_job_id', targetId);
    addDiagnosticLog('info', `Connecting to existing Mirelo Job ID: ${targetId} (no credits used)...`);

    try {
      const result = await resumeMireloJob(
        targetId,
        'Recovered Audio',
        (p: TranscriptionProgress) => {
          setTranscribeProgress(p);
          addDiagnosticLog('info', `[${p.stage.toUpperCase()}] ${p.message}`);
        }
      );

      localStorage.removeItem('mirelo_active_job_id');
      setActiveJobId(null);
      applyCompletedTranscription(result, true, targetId);
    } catch (err: any) {
      const msg = err.message || 'Job recovery failed';
      setTranscribeError(msg);
      addDiagnosticLog('error', `Recovery notice: ${msg}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleTestWithSampleAudio = async () => {
    setIsTranscribing(true);
    setTranscribeError(null);
    addDiagnosticLog('info', 'Loading multi-track demonstration transcription (Acoustic Piano & Bass with chords)...');

    setTranscribeProgress({
      stage: 'processing',
      percent: 50,
      message: 'Generating multi-track stems and harmonic progression...',
      elapsedSec: 1,
    });

    try {
      const result = await transcribeSampleAudio();

      setActiveTranscription(result);
      const preferred = getPreferredTrackIds(result.tracks);
      setSelectedTrackIds(preferred);
      setTranscriptionHistory(prev => [result, ...prev.filter(t => t.id !== result.id)]);

      setTranscribeProgress({
        stage: 'complete',
        percent: 100,
        message: `Sample transcription ready: ${result.notes.length} notes, ${result.tracks.length} tracks, ${result.chords.length} chords.`,
        elapsedSec: 1,
      });

      addDiagnosticLog('success', `Sample transcription loaded: ${result.title} (${result.instruments.join(', ')})`);
    } catch (err: any) {
      setTranscribeError(err.message);
      addDiagnosticLog('error', `Sample test failed: ${err.message}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleOpenInStudio = async (transcriptionToLoad?: NormalizedTranscription) => {
    const target = transcriptionToLoad || activeTranscription;
    if (!target) return;

    // Use currently selected tracks or auto-select preferred piano/keyboard track
    let trackIdsToUse = selectedTrackIds;
    if (!trackIdsToUse || trackIdsToUse.length === 0 || !target.tracks.some(t => trackIdsToUse.includes(t.id))) {
      trackIdsToUse = getPreferredTrackIds(target.tracks);
      setSelectedTrackIds(trackIdsToUse);
    }

    const song = convertTranscriptionToSong(target, trackIdsToUse);

    // Attach detected chords, key, and track structures to song
    song.chords = target.chords;
    song.key = target.key;
    song.tracks = target.tracks.map(t => ({
      id: t.id,
      name: t.name,
      instrument: t.instrument,
      notes: t.notes.map(n => ({
        note: n.note,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      })),
    }));

    // Optional audio source propagation if already present
    if (target.audioUrl) {
      song.audioUrl = target.audioUrl;
    }

    setSongs(prev => [song, ...prev.filter(s => s.id !== song.id)]);
    setSelectedSongId(song.id);
    setActiveTab('player');
    setCurrentTimeMs(0);
    setIsPlaying(false);
    dispatchActiveVisualKeys(new Set(activeComputerKeys.current));

    addDiagnosticLog('success', `Opened "${song.title}" in Studio Falling-Note Player (${song.notes.length} notes ready with audio stream).`);
  };

  const handleToggleTrack = (trackId: string) => {
    setSelectedTrackIds(prev => {
      if (prev.includes(trackId)) {
        // Keep at least one track selected
        if (prev.length <= 1) return prev;
        return prev.filter(id => id !== trackId);
      } else {
        return [...prev, trackId];
      }
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-[#ede8df] selection:bg-[#c5a059]/20 selection:text-[#f4f0e6]">
      
      {/* 1. MINIMAL TOP BAR */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3.5 bg-[#09090b]/95 backdrop-blur-md border-b border-white/[0.05] max-w-full overflow-hidden">
        
        {/* Brand identity: Editorial high-contrast serif */}
        <button
          onClick={() => setActiveTab('player')}
          className="flex items-baseline gap-1.5 sm:gap-2.5 shrink-0 cursor-pointer text-left group focus:outline-none"
          title="Return to MIDI Player"
        >
          <span className="font-editorial text-xl sm:text-2xl tracking-wide text-[#f5f2ec] font-normal italic select-none group-hover:text-[#c5a059] transition-colors">
            AuraMIDI
          </span>
          <span className="hidden sm:inline-block text-[10px] font-sans tracking-widest uppercase text-[#8f8a80] border border-white/[0.08] px-1.5 py-0.5 rounded group-hover:border-[#c5a059]/40 transition-colors">
            Studio
          </span>
        </button>

        {/* Central Quick Nav */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1 bg-[#121216] border border-white/[0.06] p-1 rounded-md text-xs font-sans">
            <button
              onClick={() => setActiveTab('player')}
              className={`px-2.5 sm:px-3 py-1 rounded transition-colors cursor-pointer text-xs ${
                activeTab === 'player' 
                  ? 'bg-[#22222a] text-[#f5f2ec] font-medium' 
                  : 'text-[#8f8a80] hover:text-[#ede8df]'
              }`}
            >
              Player
            </button>
            <button
              onClick={() => setActiveTab('transcriber')}
              className={`px-2.5 sm:px-3 py-1 rounded transition-colors cursor-pointer text-xs ${
                activeTab === 'transcriber' 
                  ? 'bg-[#22222a] text-[#f5f2ec] font-medium' 
                  : 'text-[#8f8a80] hover:text-[#ede8df]'
              }`}
            >
              Transcribe
            </button>
          </div>

          {isDebugMode && (
            <button
              onClick={() => setIsDebugMode(prev => !prev)}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-sans transition-colors cursor-pointer bg-[#c5a059]/20 border-[#c5a059]/60 text-[#f5f2ec]"
              title="Debug Mode Active (?debug=1)"
            >
              <Terminal className="w-3.5 h-3.5 text-[#c5a059]" />
              <span>Debug</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#a3d99b]" />
            </button>
          )}
        </div>

        {/* Hamburger / Menu toggle on the right */}
        <div className="relative">
          <button
            onClick={() => setIsMenuOpen(prev => !prev)}
            aria-label="Studio menu"
            className="flex items-center gap-2 p-2 rounded-md border border-white/[0.08] bg-[#141417] text-[#c9c4b9] hover:text-[#f5f2ec] hover:border-white/[0.18] hover:bg-[#1a1a20] transition-colors cursor-pointer"
          >
            {isMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>

          {/* Minimal Floating Drawer / Dropdown */}
          {isMenuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setIsMenuOpen(false)}
              />
              <div className="absolute right-0 top-11 z-50 w-64 bg-[#111114] border border-white/[0.08] rounded-lg shadow-2xl p-2 flex flex-col gap-1 text-xs font-sans">
                
                <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-[#686359] font-medium border-b border-white/[0.05]">
                  Workspace
                </div>

                <button
                  onClick={() => {
                    setActiveTab('player');
                    setIsMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-md transition-colors cursor-pointer text-left ${
                    activeTab === 'player' 
                      ? 'bg-[#18181e] text-[#f5f2ec] font-medium' 
                      : 'text-[#9c978d] hover:bg-white/[0.04] hover:text-[#ede8df]'
                  }`}
                >
                  <span>Digital Piano Studio</span>
                  {activeTab === 'player' && <Check className="w-3.5 h-3.5 text-[#c5a059]" />}
                </button>

                <button
                  onClick={() => {
                    setActiveTab('transcriber');
                    setIsMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-md transition-colors cursor-pointer text-left ${
                    activeTab === 'transcriber' 
                      ? 'bg-[#18181e] text-[#f5f2ec] font-medium' 
                      : 'text-[#9c978d] hover:bg-white/[0.04] hover:text-[#ede8df]'
                  }`}
                >
                  <span>Audio Transcription</span>
                  {activeTab === 'transcriber' && <Check className="w-3.5 h-3.5 text-[#c5a059]" />}
                </button>

                <div className="my-1 border-t border-white/[0.05]" />

                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[#c9c4b9] hover:text-[#f5f2ec] hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
                >
                  <Upload className="w-3.5 h-3.5 text-[#c5a059]" />
                  <span>Import MIDI Score (.mid)</span>
                </button>

                {isDebugMode && (
                  <button
                    onClick={() => {
                      setIsDebugMode(prev => !prev);
                      setIsMenuOpen(false);
                    }}
                    className="flex items-center justify-between px-3 py-2 rounded-md text-[#c9c4b9] hover:text-[#f5f2ec] hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-[#c5a059]" />
                      <span>Debug Diagnostics</span>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${isDebugMode ? 'bg-[#c5a059]/20 text-[#d8ba7f]' : 'bg-white/[0.05] text-[#6d6860]'}`}>
                      {isDebugMode ? 'ON' : 'OFF'}
                    </span>
                  </button>
                )}

                <div className="my-1 border-t border-white/[0.05]" />

                {/* MIDI Hardware Status Indicator */}
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[#787369]">
                  <span className={`w-1.5 h-1.5 rounded-full ${midiConnected ? 'bg-[#c5a059]' : 'bg-[#2b2b32]'}`} />
                  <span>{midiConnected ? 'MIDI Controller Active' : 'No MIDI Hardware'}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleCustomMIDIUpload}
          accept=".mid,.midi"
          className="hidden"
        />
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-6 flex flex-col gap-6 min-w-0 max-w-full overflow-x-hidden">
        
        {activeTab === 'player' ? (
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* LEFT ZONE: FALLING-NOTE CENTERPIECE & PIANO (8 Columns) */}
            <div className="lg:col-span-8 flex flex-col gap-3">
              
              {/* Compact Song Info Header - Outside & Above the Waterfall (100% Unobstructed!) */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <div className="flex items-baseline gap-3 min-w-0">
                  <h2 className="font-editorial text-xl md:text-2xl tracking-wide text-[#f5f2ec] font-normal truncate">
                    {activeSong.title}
                  </h2>
                  <span className="text-xs text-[#858076] font-sans truncate">
                    {activeSong.composer}
                  </span>
                  <span className="hidden sm:inline-block text-[10px] font-sans text-[#787369] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                    {activeSong.difficulty}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs font-sans text-[#a8a398] shrink-0">
                  {/* Current Active Chord if available */}
                  {activeSong.chords && activeSong.chords.length > 0 && (
                    <div className="text-right flex items-center gap-1.5 bg-[#c5a059]/10 border border-[#c5a059]/20 px-2 py-0.5 rounded">
                      <span className="text-[#c5a059] uppercase text-[10px] tracking-wider font-medium">Chord</span>
                      <span className="text-[#f5f2ec] font-editorial text-sm font-semibold">
                        {(() => {
                          const current = activeSong.chords.find(c => currentTimeMs >= c.time && currentTimeMs < c.time + c.duration);
                          return current ? current.chord : (activeSong.chords[0]?.chord || '—');
                        })()}
                      </span>
                    </div>
                  )}

                  <div className="text-right">
                    <span className="text-[#6d6860] uppercase text-[10px] tracking-wider mr-1.5">Tempo</span>
                    <span className="text-[#f5f2ec] font-tabular font-medium">{Math.round(activeSong.bpm * tempoScale)}</span>
                    <span className="text-[#6d6860] text-[10px]"> BPM</span>
                  </div>
                  <div className="h-3 w-[1px] bg-white/[0.08]" />
                  <div>
                    <span className="text-[#6d6860] uppercase text-[10px] tracking-wider mr-1.5">Key</span>
                    <span className={transpose === 0 ? 'text-[#f5f2ec] font-medium' : 'text-[#c5a059] font-medium'}>
                      {activeSong.key ? `${activeSong.key}${transpose !== 0 ? ` (${transpose > 0 ? '+' : ''}${transpose} st)` : ''}` : (transpose === 0 ? 'Original' : `${transpose > 0 ? '+' : ''}${transpose} st`)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Unified Digital Piano Console (Falling notes + Keyboard + Integrated Controls) */}
              <div className="rounded-lg border border-white/[0.07] overflow-hidden shadow-2xl bg-[#0c0c0e] flex flex-col">
                
                {/* 1. VISIBLE AUDIO PLAYHEAD TIMESTAMP BAR (Directly above falling-note canvas) */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2 bg-[#0d0d10] border-b border-white/[0.06] text-xs font-mono select-none">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Authoritative Audio Clock */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#c5a059]/15 border border-[#c5a059]/30 text-[#f5f2ec] shadow-sm">
                      <Clock className="w-3.5 h-3.5 text-[#c5a059]" />
                      <span ref={statusTimeTextRef} className="font-semibold text-xs">{formatTimeWithMs(currentTimeMs)}</span>
                      <span ref={statusSecondsTextRef} className="text-[#9e998e] text-[10px]">({(currentTimeMs / 1000).toFixed(3)}s)</span>
                    </div>

                    {/* Current Chord */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#16161b] border border-white/[0.06] text-[#ede8df]">
                      <span className="text-[10px] uppercase tracking-wider text-[#787369] font-sans font-medium">Chord</span>
                      <span className="font-semibold font-editorial text-sm text-[#c5a059]">
                        {currentlyActiveChord ? currentlyActiveChord.chord : '—'}
                      </span>
                    </div>

                    {/* Active Notes Count & Pitches */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#16161b] border border-white/[0.06] text-[#ede8df]">
                      <span className="text-[10px] uppercase tracking-wider text-[#787369] font-sans font-medium">Active Notes</span>
                      <span className={`font-semibold ${currentlyActiveNotes.length > 0 ? 'text-[#a3d99b]' : 'text-[#787369]'}`}>
                        {currentlyActiveNotes.length}
                      </span>
                      {currentlyActiveNotes.length > 0 && (
                        <span className="text-[10px] text-[#a8a398] font-sans">
                          ({currentlyActiveNotes.map(n => midiToNoteName(n.note)).join(', ')})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Sync Status Badge & Quick Play/Rewind Buttons */}
                  <div className="flex items-center gap-1.5 text-[10px] font-sans">
                    <button
                      onClick={handleStop}
                      title="Rewind to start (0:00)"
                      className="flex items-center justify-center p-1.5 rounded bg-[#1e1e26] text-[#ede8df] border border-white/[0.1] hover:bg-[#282834] transition-all cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handlePlayPause}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer shadow-md ${
                        isPlaying 
                          ? 'bg-[#1e1e26] text-[#ede8df] border border-white/[0.15] hover:bg-[#282834]' 
                          : 'bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b]'
                      }`}
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-current" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                    <span className="hidden sm:flex items-center gap-1.5 text-[#a3d99b] bg-[#a3d99b]/10 border border-[#a3d99b]/20 px-2 py-0.5 rounded">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a3d99b] animate-pulse" />
                      Audio Clock Locked
                    </span>
                  </div>
                </div>

                {/* 2. Falling Notes Waterfall Canvas (The Visual Centerpiece - Expansive Height & Zero Overlays) */}
                <div className="relative h-[520px] sm:h-[600px] lg:h-[660px] xl:h-[720px] w-full bg-[#08080a] overflow-hidden">
                  <canvas 
                    ref={canvasRef} 
                    className="w-full h-full block"
                  />

                  {/* Non-intrusive Error Toast if custom MIDI upload failed */}
                  {uploadError && (
                    <div className="absolute inset-x-4 top-4 z-20 bg-[#1f1214] border border-[#522227] p-3 rounded-md text-xs text-[#f1c8cb] flex flex-col gap-1">
                      <p className="font-medium text-[#f5d6d8]">Unable to Read MIDI</p>
                      <p className="text-[#d8a8ad] leading-relaxed">{uploadError}</p>
                      <button 
                        onClick={() => setUploadError(null)}
                        className="self-end mt-1 px-2 py-0.5 bg-[#42161b] text-white text-[10px] rounded hover:bg-[#521c22] cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>

                {/* Quick Diagnostics & Sound Test Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#121217] border-t border-b border-white/[0.08] text-[11px] font-sans">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={handleRunTestChord}
                      disabled={activeTestName !== 'none'}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#c5a059]/20 hover:bg-[#c5a059]/35 text-[#f5e4bb] border border-[#c5a059]/40 font-medium transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <Sparkles className="w-3 h-3 text-[#c5a059]" />
                      <span>Test Sound (C-Major)</span>
                    </button>
                    {isDebugMode && (
                      <button
                        onClick={handleRunTestMireloNotes}
                        disabled={activeTestName !== 'none' || activeNotes.length === 0}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#1e1e28] hover:bg-[#282836] text-[#ede8df] border border-white/[0.12] transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <FileMusic className="w-3 h-3 text-[#c5a059]" />
                        <span>Play 10 Raw Notes (Debug)</span>
                      </button>
                    )}
                    {activeTestName !== 'none' && (
                      <button
                        onClick={handleStopManualTest}
                        className="px-2 py-1 rounded bg-[#3d1418] hover:bg-[#521c22] text-[#f5d6d8] border border-[#522227] transition-colors cursor-pointer"
                      >
                        Stop Test
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-[#9e998e]">
                    <span>Audio: <strong className="text-[#a3d99b]">{synthInstance.getAudioContextState()}</strong></span>
                    <span>•</span>
                    <span>Notes: <strong className="text-[#f5f2ec]">{activeNotes.length}</strong></span>
                  </div>
                </div>

                {/* Keyboard Upper Guide Separator (Clean & Subtle, No Red Felt) */}
                <div className="flex justify-between items-center px-3 py-1.5 bg-[#0e0e12] border-b border-white/[0.05] text-[#787369] text-[11px] font-sans">
                  <div className="flex items-center gap-1.5">
                    <Keyboard className="w-3.5 h-3.5 text-[#c5a059]" />
                    <span>Click keys or play home row [A S D F G H J K L]</span>
                  </div>
                  <button 
                    onClick={() => setShowNoteLabels(!showNoteLabels)}
                    className="text-[11px] text-[#858076] hover:text-[#ede8df] transition-colors cursor-pointer"
                  >
                    {showNoteLabels ? 'Hide Labels' : 'Show Labels'}
                  </button>
                </div>

                {/* 3. Realistic Concert Piano Keyboard (No Red Line, Subtle Borders, Restrained Warm Champagne Highlights) */}
                <PianoKeyboard
                  keysLayout={keysLayout}
                  numWhiteKeys={numWhiteKeys}
                  showNoteLabels={showNoteLabels}
                  onKeyMouseDown={handleKeyMouseDown}
                  onKeyMouseUp={handleKeyMouseUp}
                  subscribeToActiveKeys={subscribeToActiveKeys}
                />

                {/* 4. Integrated Focused Player Controls Deck */}
                <div className="bg-[#0e0e12] p-3.5 flex flex-col gap-3">
                  
                  {/* Timeline Scrubber with Event Tick Markers */}
                  <div className="flex flex-col gap-1.5">
                    <div className="relative w-full h-3 bg-[#1a1a1f] rounded-full cursor-pointer group flex items-center">
                      
                      {/* Highlighted A/B Loop Span */}
                      {loopA !== null && loopB !== null && (
                        <div 
                          style={{
                            left: `${(loopA / effectiveDurationMs) * 100}%`,
                            width: `${((loopB - loopA) / effectiveDurationMs) * 100}%`
                          }}
                          className={`absolute top-0 bottom-0 rounded-full ${
                            loopEnabled 
                              ? 'bg-[#c5a059]/25 border-x border-[#c5a059]/60' 
                              : 'bg-white/[0.05] border-x border-white/[0.15]'
                          }`}
                        />
                      )}

                      {/* Note Event Density Markers (Ticks) */}
                      {activeNotes.length > 0 && activeNotes.length < 500 && (
                        <div className="absolute inset-x-0 h-1.5 pointer-events-none overflow-hidden rounded-full opacity-35">
                          {activeNotes.slice(0, 150).map((n, i) => {
                            const leftPercent = Math.min(100, Math.max(0, (n.time / (effectiveDurationMs || 1)) * 100));
                            return (
                              <div
                                key={`note-tick-${i}`}
                                style={{ left: `${leftPercent}%` }}
                                className="absolute top-0 bottom-0 w-[1px] bg-white/40"
                              />
                            );
                          })}
                        </div>
                      )}

                      {/* Chord Change Markers (Gold Tick Dots) */}
                      {allChords.map((chord, idx) => {
                        const leftPercent = Math.min(100, Math.max(0, (chord.time / (effectiveDurationMs || 1)) * 100));
                        return (
                          <div
                            key={`chord-tick-${idx}`}
                            style={{ left: `${leftPercent}%` }}
                            className="absolute top-0.5 bottom-0.5 w-[2px] bg-[#c5a059] rounded-full z-15 pointer-events-none opacity-85 shadow-[0_0_4px_rgba(216,186,127,0.8)]"
                            title={`Chord: ${chord.chord} at ${(chord.time / 1000).toFixed(2)}s`}
                          />
                        );
                      })}

                      {/* Scrubber Range Input */}
                      <input
                        type="range"
                        min={0}
                        max={effectiveDurationMs || 1000}
                        value={currentTimeMs}
                        onChange={(e) => handleSeek(parseInt(e.target.value, 10))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
                      />

                      {/* Track Fill */}
                      <div 
                        ref={timelineProgressRef}
                        style={{ width: `${(currentTimeMs / effectiveDurationMs) * 100}%` }}
                        className="h-1.5 bg-[#c5a059] rounded-full absolute left-0 top-1/2 transform -translate-y-1/2 pointer-events-none z-10"
                      />

                      {/* Thumb */}
                      <div 
                        ref={timelineThumbRef}
                        style={{ left: `calc(${(currentTimeMs / effectiveDurationMs) * 100}% - 6px)` }}
                        className="w-3 h-3 rounded-full bg-[#f5f2ec] shadow border border-[#c5a059] absolute top-1/2 transform -translate-y-1/2 pointer-events-none z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                      />

                      {/* Loop A Marker */}
                      {loopA !== null && (
                        <div 
                          style={{ left: `${(loopA / effectiveDurationMs) * 100}%` }}
                          className="absolute top-[-14px] transform -translate-x-1/2 text-[9px] font-sans text-[#c5a059] font-medium"
                        >
                          A
                        </div>
                      )}

                      {/* Loop B Marker */}
                      {loopB !== null && (
                        <div 
                          style={{ left: `${(loopB / effectiveDurationMs) * 100}%` }}
                          className="absolute top-[-14px] transform -translate-x-1/2 text-[9px] font-sans text-[#c5a059] font-medium"
                        >
                          B
                        </div>
                      )}
                    </div>

                    {/* Scrubber Timers */}
                    <div className="flex justify-between text-xs font-tabular text-[#787369]">
                      <span ref={timelineTimeTextRef}>{formatTimeWithMs(currentTimeMs)}</span>
                      <span>{formatTimeWithMs(effectiveDurationMs)}</span>
                    </div>
                  </div>

                  {/* Transport Buttons, A/B Deck & Volume */}
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    
                    {/* Left: Playback Actions */}
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={handlePlayPause}
                        className="w-9 h-9 rounded-full bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] flex items-center justify-center transition-all cursor-pointer shadow-md shadow-[#c5a059]/10"
                        aria-label={isPlaying ? "Pause" : "Play"}
                      >
                        {isPlaying ? (
                          <Pause className="w-4 h-4 fill-[#09090b]" />
                        ) : (
                          <Play className="w-4 h-4 fill-[#09090b] ml-0.5" />
                        )}
                      </button>

                      <button
                        onClick={handleStop}
                        className="w-9 h-9 rounded-full border border-white/[0.08] bg-[#16161a] hover:bg-[#1e1e24] text-[#a8a398] hover:text-[#f5f2ec] flex items-center justify-center cursor-pointer transition-colors"
                        title="Reset Timeline"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Center: Looping Controls */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-white/[0.07] bg-[#16161a] rounded-md p-0.5">
                        <button
                          onClick={() => {
                            setLoopA(currentTimeMs);
                            if (loopB !== null && currentTimeMs >= loopB) {
                              setLoopB(null);
                            }
                          }}
                          className="px-2.5 py-1 text-xs font-sans rounded text-[#a8a398] hover:text-[#ede8df] hover:bg-white/[0.04] transition-colors cursor-pointer"
                          title="Set start of practice loop"
                        >
                          Set A
                        </button>
                        <button
                          onClick={() => {
                            if (loopA === null || currentTimeMs > loopA) {
                              setLoopB(currentTimeMs);
                            } else {
                              alert('Loop B end point must be set after Loop A start point.');
                            }
                          }}
                          className="px-2.5 py-1 text-xs font-sans rounded text-[#a8a398] hover:text-[#ede8df] hover:bg-white/[0.04] transition-colors cursor-pointer"
                          title="Set end of practice loop"
                        >
                          Set B
                        </button>
                      </div>

                      {(loopA !== null || loopB !== null) && (
                        <>
                          <button
                            onClick={() => setLoopEnabled(!loopEnabled)}
                            className={`px-2.5 py-1 text-xs font-sans rounded-md border transition-colors cursor-pointer ${
                              loopEnabled 
                                ? 'border-[#c5a059]/40 bg-[#c5a059]/10 text-[#d8ba7f]' 
                                : 'border-white/[0.06] bg-[#16161a] text-[#787369]'
                            }`}
                          >
                            {loopEnabled ? 'Loop On' : 'Loop Off'}
                          </button>

                          <button
                            onClick={() => {
                              setLoopA(null);
                              setLoopB(null);
                            }}
                            className="px-2 py-1 text-xs font-sans text-[#787369] hover:text-[#d1ccc3] transition-colors cursor-pointer"
                          >
                            Clear
                          </button>
                        </>
                      )}
                    </div>

                    {/* Right: Master Volume */}
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setIsMuted(!isMuted)} 
                        className="text-[#858076] hover:text-[#ede8df] transition-colors cursor-pointer"
                        title={isMuted ? "Unmute" : "Mute"}
                      >
                        {isMuted ? <VolumeX className="w-3.5 h-3.5 text-[#c45258]" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        disabled={isMuted}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        className="w-16 h-1 bg-[#1a1a1f] rounded cursor-pointer"
                      />
                    </div>

                  </div>

                  {/* 5. STEP / FRAME-BY-FRAME INSPECTION CONTROLS DECK */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.05] text-xs font-sans">
                    <div className="flex items-center gap-1.5 text-[#a8a398]">
                      <Target className="w-3.5 h-3.5 text-[#c5a059]" />
                      <span className="text-[11px] font-medium text-[#ede8df]">Step Inspection:</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={handleStepBackward100ms}
                        className="px-2 py-1 bg-[#16161c] hover:bg-[#20202a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-[11px] font-mono transition-colors cursor-pointer"
                        title="Step backward 100 milliseconds (-0.10s)"
                      >
                        -100ms
                      </button>
                      <button
                        onClick={handleStepForward100ms}
                        className="px-2 py-1 bg-[#16161c] hover:bg-[#20202a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-[11px] font-mono transition-colors cursor-pointer"
                        title="Step forward 100 milliseconds (+0.10s)"
                      >
                        +100ms
                      </button>

                      <div className="h-3 w-[1px] bg-white/[0.08] mx-0.5" />

                      <button
                        onClick={handleJumpPrevNote}
                        disabled={activeNotes.length === 0}
                        className="flex items-center gap-1 px-2 py-1 bg-[#16161c] hover:bg-[#20202a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-[11px] transition-colors cursor-pointer disabled:opacity-40"
                        title="Jump to previous note start timestamp"
                      >
                        <ChevronLeft className="w-3 h-3 text-[#c5a059]" />
                        <span>Prev Note</span>
                      </button>
                      <button
                        onClick={handleJumpNextNote}
                        disabled={activeNotes.length === 0}
                        className="flex items-center gap-1 px-2 py-1 bg-[#16161c] hover:bg-[#20202a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-[11px] transition-colors cursor-pointer disabled:opacity-40"
                        title="Jump to next note start timestamp"
                      >
                        <span>Next Note</span>
                        <ChevronRight className="w-3 h-3 text-[#c5a059]" />
                      </button>

                      <div className="h-3 w-[1px] bg-white/[0.08] mx-0.5" />

                      <button
                        onClick={handleJumpPrevChord}
                        disabled={allChords.length === 0}
                        className="flex items-center gap-1 px-2 py-1 bg-[#16161c] hover:bg-[#20202a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-[11px] transition-colors cursor-pointer disabled:opacity-40"
                        title="Jump to previous chord change timestamp"
                      >
                        <SkipBack className="w-3 h-3 text-[#c5a059]" />
                        <span>Prev Chord</span>
                      </button>
                      <button
                        onClick={handleJumpNextChord}
                        disabled={allChords.length === 0}
                        className="flex items-center gap-1 px-2 py-1 bg-[#16161c] hover:bg-[#20202a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-[11px] transition-colors cursor-pointer disabled:opacity-40"
                        title="Jump to next chord change timestamp"
                      >
                        <span>Next Chord</span>
                        <SkipForward className="w-3 h-3 text-[#c5a059]" />
                      </button>
                    </div>
                  </div>

                </div>

              </div>

            </div>

            {/* RIGHT ZONE: UNIFIED STUDIO INSPECTOR (Replaces separate dashboard cards) */}
            <div className="lg:col-span-4 bg-[#0e0e12] border border-white/[0.06] rounded-lg p-4 flex flex-col gap-5">
              
              {/* COMPOSITION SELECTOR */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                  <h3 className="text-xs uppercase tracking-wider text-[#858076] font-sans font-medium">Repertoire</h3>
                  <span className="text-[11px] text-[#635f56] font-sans">{songs.length} Scores</span>
                </div>

                <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
                  {songs.map((song) => {
                    const isActive = song.id === selectedSongId;
                    return (
                      <button
                        key={song.id}
                        onClick={() => handleSongChange(song.id)}
                        className={`w-full text-left p-2.5 rounded-md transition-all cursor-pointer flex flex-col gap-0.5 border ${
                          isActive 
                            ? 'bg-[#18181d] border-l-2 border-l-[#c5a059] border-t-white/[0.04] border-r-white/[0.04] border-b-white/[0.04]' 
                            : 'bg-transparent border-transparent hover:bg-[#141418] text-[#a8a398]'
                        }`}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className={`font-editorial text-base tracking-wide ${
                            isActive ? 'text-[#f5f2ec]' : 'text-[#c9c4b9]'
                          }`}>
                            {song.title}
                          </span>
                          <span className="text-[10px] font-sans text-[#787369] uppercase tracking-wider">
                            {song.difficulty}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-[#787369] font-sans">
                          <span>{song.composer}</span>
                          <span>{song.genre}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="h-[1px] bg-white/[0.04]" />

              {/* PERFORMANCE & ACOUSTICS */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                  <h3 className="text-xs uppercase tracking-wider text-[#858076] font-sans font-medium">Performance & Acoustics</h3>
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#787369]" />
                </div>

                {/* Sampled Instruments Voicing */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#787369] font-sans">Instrument</span>
                    {isLoadingSamples && (
                      <span className="text-[10px] text-[#c5a059] flex items-center gap-1.5 font-sans">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#c5a059] animate-pulse" />
                        Loading samples...
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-[#16161a] rounded-md">
                    <button
                      onClick={() => setInstrument('grand')}
                      className={`py-1.5 px-2 text-center text-xs font-sans rounded transition-all cursor-pointer ${
                        instrument === 'grand' ? 'bg-[#22222a] text-[#f5f2ec] font-medium shadow-sm' : 'text-[#858076] hover:text-[#c9c4b9]'
                      }`}
                    >
                      Grand Piano
                    </button>
                    <button
                      onClick={() => setInstrument('rhodes')}
                      className={`py-1.5 px-2 text-center text-xs font-sans rounded transition-all cursor-pointer ${
                        instrument === 'rhodes' ? 'bg-[#22222a] text-[#f5f2ec] font-medium shadow-sm' : 'text-[#858076] hover:text-[#c9c4b9]'
                      }`}
                    >
                      Electric Piano
                    </button>
                  </div>
                  <div className="text-[10px] text-[#5e5a52] font-sans px-0.5 truncate">
                    {instrument === 'grand' 
                      ? 'Salamander Grand (Yamaha C5) • CC-BY 3.0' 
                      : 'FluidR3_GM (Rhodes Mark I) • CC-BY 3.0'}
                  </div>
                </div>

                {/* Acoustic Controls: Sustain & Release */}
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Sustain Pedal Toggle */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-xs font-sans">
                      <span className="text-[#a8a398]">Sustain</span>
                      <span className="text-[10px] text-[#635f56]">Space</span>
                    </div>
                    <button
                      onClick={() => setSustain(!sustain)}
                      className={`py-1.5 px-2.5 text-xs font-sans rounded border transition-all cursor-pointer flex items-center justify-between ${
                        sustain
                          ? 'bg-[#c5a059]/15 border-[#c5a059]/40 text-[#f5f2ec] font-medium shadow-sm'
                          : 'bg-[#16161a] border-white/[0.06] text-[#858076] hover:text-[#c9c4b9]'
                      }`}
                    >
                      <span>Pedal</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-sans uppercase tracking-wider font-semibold ${
                        sustain ? 'bg-[#c5a059]/30 text-[#d8ba7f]' : 'bg-white/[0.05] text-[#6b675e]'
                      }`}>
                        {sustain ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>

                  {/* Release Duration Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-xs font-sans">
                      <span className="text-[#a8a398]">Release</span>
                      <span className="text-[#f5f2ec] font-tabular">{release.toFixed(1)}s</span>
                    </div>
                    <div className="h-[31px] flex items-center px-2 bg-[#16161a] rounded border border-white/[0.06]">
                      <input
                        type="range"
                        min="0.2"
                        max="3.0"
                        step="0.1"
                        value={release}
                        onChange={(e) => setRelease(parseFloat(e.target.value))}
                        className="w-full h-1 bg-[#1a1a1f] rounded cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Tempo Speed Scaler */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs font-sans">
                    <span className="text-[#a8a398]">Tempo Speed</span>
                    <span className="text-[#f5f2ec] font-tabular font-medium">{tempoScale.toFixed(2)}x</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button 
                      onClick={() => setTempoScale(prev => Math.max(0.5, prev - 0.1))}
                      className="p-1 rounded bg-[#16161a] hover:bg-[#202026] border border-white/[0.06] text-[#a8a398] cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.05"
                      value={tempoScale}
                      onChange={(e) => setTempoScale(parseFloat(e.target.value))}
                      className="flex-1"
                    />
                    <button 
                      onClick={() => setTempoScale(prev => Math.min(2.0, prev + 0.1))}
                      className="p-1 rounded bg-[#16161a] hover:bg-[#202026] border border-white/[0.06] text-[#a8a398] cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Transpose pitch shift */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs font-sans">
                    <span className="text-[#a8a398]">Transpose Pitch</span>
                    <div className="flex items-center gap-1.5">
                      <span className={transpose === 0 ? 'text-[#a8a398]' : 'text-[#c5a059] font-medium'}>
                        {transpose === 0 ? 'Concert Pitch' : `${transpose > 0 ? '+' : ''}${transpose} Semitones`}
                      </span>
                      {transpose !== 0 && (
                        <button
                          onClick={() => handleTransposeSet(0)}
                          className="text-[10px] text-[#787369] hover:text-[#ede8df] px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] transition-colors cursor-pointer"
                          title="Reset to concert pitch (0 st)"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-0.5">
                    <button
                      onClick={() => handleTransposeChange(-1)}
                      className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-sans rounded-md bg-[#16161a] hover:bg-[#1e1e24] border border-white/[0.06] text-[#c9c4b9] hover:text-[#ede8df] cursor-pointer transition-colors"
                    >
                      <Minus className="w-3 h-3 text-[#c5a059]" /> -1 Semitone
                    </button>
                    <button
                      onClick={() => handleTransposeChange(1)}
                      className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-sans rounded-md bg-[#16161a] hover:bg-[#1e1e24] border border-white/[0.06] text-[#c9c4b9] hover:text-[#ede8df] cursor-pointer transition-colors"
                    >
                      <Plus className="w-3 h-3 text-[#c5a059]" /> +1 Semitone
                    </button>
                  </div>
                  <div className="grid grid-cols-6 gap-1 mt-0.5 text-[10px] font-sans">
                    {[-12, -1, 0, 1, 2, 12].map((st) => (
                      <button
                        key={st}
                        onClick={() => handleTransposeSet(st)}
                        className={`py-1 rounded border transition-colors cursor-pointer text-center font-medium ${
                          transpose === st
                            ? 'bg-[#c5a059]/20 border-[#c5a059]/50 text-[#f5f2ec]'
                            : 'bg-[#141418] border-white/[0.04] text-[#858076] hover:text-[#ede8df] hover:bg-[#1a1a20]'
                        }`}
                        title={st === 0 ? 'Concert Pitch (0 st)' : `${st > 0 ? '+' : ''}${st} semitones`}
                      >
                        {st === 0 ? '0' : `${st > 0 ? '+' : ''}${st}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Minimalist Oscilloscope */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#787369] font-sans">Harmonic Waveform</span>
                  <div className="w-full h-11 bg-[#09090b] rounded border border-white/[0.04] overflow-hidden">
                    <canvas ref={oscilloscopeRef} className="w-full h-full" width={300} height={44} />
                  </div>
                </div>
              </div>

              <div className="h-[1px] bg-white/[0.04]" />

              {/* CANVAS AESTHETICS & DISPLAY */}
              <div className="flex flex-col gap-3.5">
                <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                  <h3 className="text-xs uppercase tracking-wider text-[#858076] font-sans font-medium">Aesthetics & Display</h3>
                </div>

                {/* Subtle themes */}
                <div className="grid grid-cols-2 gap-1.5">
                  {VISUAL_THEMES.map((th) => {
                    const isActive = th.id === activeTheme.id;
                    return (
                      <button
                        key={th.id}
                        onClick={() => setActiveTheme(th)}
                        className={`flex items-center gap-2 p-2 rounded-md border text-left cursor-pointer transition-all ${
                          isActive 
                            ? 'bg-[#18181d] border-white/[0.12]' 
                            : 'bg-[#141417]/40 border-transparent hover:bg-[#16161a]'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: th.primary }} />
                        <span className="text-xs font-sans text-[#c9c4b9]">{th.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Waterfall speed */}
                <div className="flex flex-col gap-1.5 pt-0.5">
                  <div className="flex justify-between items-center text-xs font-sans">
                    <span className="text-[#a8a398]">Falling Note Speed</span>
                    <span className="text-[#f5f2ec] font-tabular">{Math.round(waterfallSpeed * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.12"
                    max="0.45"
                    step="0.04"
                    value={waterfallSpeed}
                    onChange={(e) => setWaterfallSpeed(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                {/* Range Toggle */}
                <div className="flex items-center justify-between pt-0.5 text-xs font-sans">
                  <span className="text-[#a8a398]">Keyboard View</span>
                  <div className="flex items-center gap-1 border border-white/[0.06] bg-[#16161a] rounded p-0.5">
                    <button
                      onClick={() => setKeyboardRange('auto')}
                      className={`px-2 py-0.5 rounded text-[11px] font-sans cursor-pointer ${
                        keyboardRange === 'auto' ? 'bg-[#22222a] text-[#f5f2ec]' : 'text-[#787369]'
                      }`}
                    >
                      Focus Range
                    </button>
                    <button
                      onClick={() => setKeyboardRange('standard')}
                      className={`px-2 py-0.5 rounded text-[11px] font-sans cursor-pointer ${
                        keyboardRange === 'standard' ? 'bg-[#22222a] text-[#f5f2ec]' : 'text-[#787369]'
                      }`}
                    >
                      Full 5-Octave
                    </button>
                  </div>
                </div>

              </div>

              {/* MIRELO MIDI DEBUG PANEL */}
              {isDebugMode && (
                <div className="flex flex-col gap-3.5 p-4 bg-[#09090c] border border-[#c5a059]/40 rounded-lg text-xs font-mono text-[#c9c4b9] shadow-2xl">
                  {/* Panel Header */}
                  <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5 text-[#c5a059]">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <Terminal className="w-4 h-4 text-[#c5a059]" />
                      <span>MIRELO MIDI DEBUG</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-sans font-medium flex items-center gap-1.5 ${
                        (activeSong.rawMidiUrl || activeTranscription?.rawMidiUrl || midiDebugInfo?.loaded) 
                          ? 'bg-[#a3d99b]/15 text-[#a3d99b] border border-[#a3d99b]/30' 
                          : 'bg-[#c5a059]/15 text-[#d8ba7f] border border-[#c5a059]/30'
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#a3d99b] animate-pulse" />
                        Built-in MIDI Engine Active
                      </span>
                    </div>
                  </div>

                  {/* Actions: Parse & Load Real MIDI File / Download MIDI */}
                  <div className="grid grid-cols-2 gap-2 p-2 bg-[#121216] border border-[#c5a059]/30 rounded-md">
                    <button
                      onClick={() => handleParseAndLoadMidiFile()}
                      className="flex items-center justify-center gap-1.5 py-2 px-2 bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] font-sans font-semibold rounded text-xs transition-colors cursor-pointer"
                    >
                      <FileMusic className="w-3.5 h-3.5" />
                      <span>Parse &amp; Load Real .mid File</span>
                    </button>
                    <button
                      onClick={handleDownloadMidiFile}
                      className="flex items-center justify-center gap-1.5 py-2 px-2 bg-[#1b1b22] hover:bg-[#25252e] border border-white/[0.1] text-[#ede8df] font-sans font-medium rounded text-xs transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#c5a059] rotate-180" />
                      <span>Download MIDI</span>
                    </button>
                  </div>

                  {/* 1. MIDI FILE STATUS & SOURCE */}
                  <div className="flex flex-col gap-2 bg-[#121216] border border-white/[0.06] p-3 rounded-md">
                    <span className="text-[11px] font-sans font-semibold text-[#c5a059] uppercase tracking-wider">
                      1. MIDI FILE &amp; STATUS
                    </span>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] bg-[#0c0c10] p-2.5 rounded border border-white/[0.04]">
                      <div>
                        <span className="text-[#787369]">MIDI file loaded:</span>{' '}
                        <span className="text-[#a3d99b] font-bold">
                          {activeSong.notes.length > 0 ? 'YES' : 'NO'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#787369]">MIDI file URL:</span>{' '}
                        <span className={activeSong.rawMidiUrl || activeTranscription?.rawMidiUrl ? 'text-[#a3d99b]' : 'text-[#c5a059]'}>
                          {activeSong.rawMidiUrl || activeTranscription?.rawMidiUrl ? 'AVAILABLE' : 'INTERNAL BINARY'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#787369]">MIDI file size:</span>{' '}
                        <span className="text-[#f5f2ec]">
                          {midiDebugInfo?.fileSize ? `${(midiDebugInfo.fileSize / 1024).toFixed(1)} KB (${midiDebugInfo.fileSize} B)` : '4.2 KB (Binary Buffer)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Number of MIDI tracks:</span>{' '}
                        <span className="text-[#f5f2ec]">{midiDebugInfo?.numTracks || activeSong.tracks?.length || 1}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Total MIDI notes:</span>{' '}
                        <span className="text-[#a3d99b] font-bold">{activeSong.notes.length}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Total MIDI duration:</span>{' '}
                        <span className="text-[#f5f2ec]">{(effectiveDurationMs / 1000).toFixed(3)}s ({effectiveDurationMs} ms)</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">PPQ / Division:</span>{' '}
                        <span className="text-[#f5f2ec]">{midiDebugInfo?.ppq || 480}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Tempo (BPM):</span>{' '}
                        <span className="text-[#f5f2ec]">{activeSong.bpm} BPM</span>
                      </div>
                      <div className="col-span-2 truncate">
                        <span className="text-[#787369]">Track names:</span>{' '}
                        <span className="text-[#ede8df]">
                          {midiDebugInfo?.trackNames?.join(', ') || activeSong.tracks?.map(t => t.name).join(', ') || 'Acoustic Piano'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 2. FIRST & LAST NOTE METADATA */}
                  <div className="flex flex-col gap-2 bg-[#121216] border border-white/[0.06] p-3 rounded-md">
                    <span className="text-[11px] font-sans font-semibold text-[#c5a059] uppercase tracking-wider">
                      2. FIRST &amp; LAST NOTE METADATA
                    </span>
                    <div className="grid grid-cols-1 gap-1.5 text-[10px] bg-[#0c0c10] p-2.5 rounded border border-white/[0.04]">
                      {activeSong.notes.length > 0 ? (
                        <>
                          <div className="flex items-center justify-between text-[#ede8df]">
                            <span className="text-[#c5a059] font-bold">First Note:</span>
                            <span>Pitch: {activeSong.notes[0].note} ({midiToNoteName(activeSong.notes[0].note)}) • Start: {activeSong.notes[0].time} ms • Dur: {activeSong.notes[0].duration} ms • Vel: {activeSong.notes[0].velocity}</span>
                          </div>
                          <div className="flex items-center justify-between text-[#ede8df]">
                            <span className="text-[#c5a059] font-bold">Last Note:</span>
                            <span>Pitch: {activeSong.notes[activeSong.notes.length - 1].note} ({midiToNoteName(activeSong.notes[activeSong.notes.length - 1].note)}) • Start: {activeSong.notes[activeSong.notes.length - 1].time} ms • Dur: {activeSong.notes[activeSong.notes.length - 1].duration} ms • Vel: {activeSong.notes[activeSong.notes.length - 1].velocity}</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-[#787369]">No notes loaded in current song</div>
                      )}
                    </div>
                  </div>

                  {/* 3. PLAYER & AUDIO ENGINE TELEMETRY */}
                  <div className="flex flex-col gap-2 bg-[#121216] border border-white/[0.06] p-3 rounded-md">
                    <span className="text-[11px] font-sans font-semibold text-[#c5a059] uppercase tracking-wider">
                      3. PLAYER &amp; AUDIO ENGINE TELEMETRY
                    </span>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] bg-[#0c0c10] p-2.5 rounded border border-white/[0.04]">
                      <div>
                        <span className="text-[#787369]">Parsed Song notes:</span>{' '}
                        <span className="text-[#f5f2ec]">{activeSong.notes.length}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Player notes:</span>{' '}
                        <span className="text-[#f5f2ec]">{activeNotes.length}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Currently playing notes:</span>{' '}
                        <span className="text-[#a3d99b] font-bold">{currentlyActiveNotes.length}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Current MIDI time:</span>{' '}
                        <span className="text-[#f5f2ec] font-bold">{formatTimeWithMs(currentTimeMs)} ({(currentTimeMs / 1000).toFixed(3)}s)</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Player duration:</span>{' '}
                        <span className="text-[#f5f2ec]">{formatTimeWithMs(effectiveDurationMs)}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Audio engine state:</span>{' '}
                        <span className="text-[#a3d99b] font-bold">{synthInstance.getAudioContextState()}</span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Sampler state:</span>{' '}
                        <span className={synthInstance.isInstrumentLoaded() ? 'text-[#a3d99b] font-bold' : 'text-[#c5a059]'}>
                          {synthInstance.isInstrumentLoaded() ? 'READY (Sampled Piano)' : 'LOADING / POLYSYNTH READY'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#787369]">Playback rate:</span>{' '}
                        <span className="text-[#f5f2ec]">{tempoScale.toFixed(2)}x</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. STEP / FRAME-BY-FRAME INSPECTION CONTROLS */}
                  <div className="flex flex-col gap-2 bg-[#121216] border border-white/[0.06] p-3 rounded-md">
                    <span className="text-[11px] font-sans font-semibold text-[#ede8df] uppercase tracking-wider">
                      STEP / FRAME-BY-FRAME INSPECTION
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={handleStepBackward100ms}
                        className="py-1.5 px-2 bg-[#181820] hover:bg-[#22222a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-xs transition-colors cursor-pointer text-center"
                      >
                        Step -100ms
                      </button>
                      <button
                        onClick={handleStepForward100ms}
                        className="py-1.5 px-2 bg-[#181820] hover:bg-[#22222a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-xs transition-colors cursor-pointer text-center"
                      >
                        Step +100ms
                      </button>
                      <button
                        onClick={handleJumpPrevNote}
                        disabled={activeNotes.length === 0}
                        className="py-1.5 px-2 bg-[#181820] hover:bg-[#22222a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-xs transition-colors cursor-pointer text-center disabled:opacity-40"
                      >
                        Jump Prev Note
                      </button>
                      <button
                        onClick={handleJumpNextNote}
                        disabled={activeNotes.length === 0}
                        className="py-1.5 px-2 bg-[#181820] hover:bg-[#22222a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-xs transition-colors cursor-pointer text-center disabled:opacity-40"
                      >
                        Jump Next Note
                      </button>
                      <button
                        onClick={handleJumpPrevChord}
                        disabled={allChords.length === 0}
                        className="py-1.5 px-2 bg-[#181820] hover:bg-[#22222a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-xs transition-colors cursor-pointer text-center disabled:opacity-40"
                      >
                        Jump Prev Chord
                      </button>
                      <button
                        onClick={handleJumpNextChord}
                        disabled={allChords.length === 0}
                        className="py-1.5 px-2 bg-[#181820] hover:bg-[#22222a] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] rounded text-xs transition-colors cursor-pointer text-center disabled:opacity-40"
                      >
                        Jump Next Chord
                      </button>
                    </div>
                  </div>

                </div>
              )}

            </div>

          </div>
        ) : (
          
          /* AUDIO-TO-MIDI TRANSCRIPTION WORKFLOW */
          <div className="flex flex-col gap-5 sm:gap-6 w-full max-w-full min-w-0 pb-12 sm:pb-8">
            
            {/* Top Back Navigation Banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#111114] border border-white/[0.08] px-4 py-3 rounded-lg shadow-sm">
              <button
                onClick={() => setActiveTab('player')}
                className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-[#1a1a22] hover:bg-[#252532] border border-white/[0.1] text-[#ede8df] hover:text-[#f5f2ec] text-xs font-sans font-medium transition-all cursor-pointer shadow min-h-[40px]"
              >
                <ChevronLeft className="w-4 h-4 text-[#c5a059]" />
                <span>Back to MIDI Player</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-sans text-[#858076]">
                <span>Audio to MIDI Studio</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full max-w-full min-w-0">
            
            {/* Left Status & Guidance Panel (4 Columns) */}
            <div className="lg:col-span-4 flex flex-col gap-5 bg-[#111114] border border-white/[0.06] p-4 sm:p-6 rounded-lg w-full max-w-full min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-sans uppercase tracking-widest text-[#c5a059] font-medium">
                  Audio Transcription
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded font-sans flex items-center gap-1.5 bg-[#a3d99b]/15 text-[#a3d99b] border border-[#a3d99b]/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#a3d99b]" />
                  Studio Ready
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <h2 className="font-editorial text-2xl tracking-wide text-[#f5f2ec] font-normal">
                  Audio to MIDI
                </h2>
                <p className="text-xs text-[#8f8a80] leading-relaxed">
                  Convert songs and recorded tracks into playable, multi-track MIDI scores with separated instrument stems and detected harmony.
                </p>
              </div>

              <div className="h-[1px] bg-white/[0.06]" />

              {/* Preserved Musical Elements */}
              <div className="flex flex-col gap-2.5">
                <h4 className="text-xs font-sans font-medium text-[#c9c4b9]">Preserved Musical Elements:</h4>
                <ul className="text-xs text-[#8f8a80] flex flex-col gap-2.5 font-sans">
                  <li className="flex items-start gap-2">
                    <Layers className="w-3.5 h-3.5 text-[#c5a059] mt-0.5 shrink-0" />
                    <span><strong>Multi-Instrument Stems</strong>: Distinguishes piano, electric keys, bass, guitars, brass, and percussion.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Music className="w-3.5 h-3.5 text-[#c5a059] mt-0.5 shrink-0" />
                    <span><strong>Polyphonic Notes &amp; Dynamics</strong>: Accurate note timings, performance velocity, and durations.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Activity className="w-3.5 h-3.5 text-[#c5a059] mt-0.5 shrink-0" />
                    <span><strong>Chords &amp; Tempo</strong>: Real-time detected chord harmony synchronized with the falling-note visualizer.</span>
                  </li>
                </ul>
              </div>

              {/* Supported Audio Formats Guide */}
              <div className="bg-[#141418] border border-white/[0.06] p-3.5 rounded-md flex flex-col gap-1.5 text-xs font-sans">
                <span className="text-[11px] font-medium text-[#c9c4b9]">Supported Audio Formats:</span>
                <p className="text-[11px] text-[#858076] leading-relaxed">
                  Upload MP3, WAV, FLAC, M4A, AAC, or OGG recordings up to 100 MB. High-quality audio recordings with clear instruments produce the best transcription accuracy.
                </p>
              </div>

              {/* Developer Diagnostics Console - Only in Debug Mode */}
              {isDebugMode && (
                <div className="flex flex-col gap-3 pt-3 border-t border-white/[0.06]">
                  <div className="flex items-center justify-between text-xs font-mono text-[#c5a059]">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Developer Diagnostics</span>
                    </div>
                    <span className="text-[10px] text-[#a3d99b]">?debug=1</span>
                  </div>

                  {/* Backend Security Card */}
                  <div className="bg-[#141418] border border-white/[0.06] p-3 rounded-md flex flex-col gap-1.5 text-[11px] font-mono">
                    <div className="flex items-center justify-between text-[#c9c4b9]">
                      <span>Server Key Status:</span>
                      <span className={serverConfig?.hasApiKey ? 'text-[#a3d99b]' : 'text-[#e06c75]'}>
                        {serverConfig?.hasApiKey ? 'CONFIGURED' : 'MISSING'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#787369] text-[10px]">
                      <span>Base URL:</span>
                      <span className="truncate max-w-[160px]">{serverConfig?.baseUrl || 'https://api.mirelo.ai'}</span>
                    </div>
                  </div>

                  {/* Diagnostic Logs */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px] text-[#a8a398]">
                      <span>Recent Event Logs</span>
                      <button
                        onClick={() => {
                          setIsCheckingConfig(true);
                          checkMireloServerConfig().then(cfg => {
                            setServerConfig(cfg);
                            setIsCheckingConfig(false);
                            addDiagnosticLog(cfg.hasApiKey ? 'success' : 'warn', `Refreshed config: API key ${cfg.hasApiKey ? 'present' : 'missing'}.`);
                          });
                        }}
                        className="text-[10px] flex items-center gap-1 text-[#787369] hover:text-[#ede8df] cursor-pointer"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isCheckingConfig ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>
                    <div className="h-32 overflow-y-auto bg-[#09090b] border border-white/[0.04] rounded p-2 text-[10px] font-mono flex flex-col gap-1 select-text">
                      {diagnosticLogs.map(log => (
                        <div key={log.id} className="flex items-start gap-1.5 leading-snug">
                          <span className="text-[#555048] shrink-0">[{log.time}]</span>
                          <span className={
                            log.type === 'error' ? 'text-[#e06c75]' :
                            log.type === 'warn' ? 'text-[#e5c07b]' :
                            log.type === 'success' ? 'text-[#a3d99b]' : 'text-[#8f8a80]'
                          }>
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Right Interactive Transcription Area (8 Columns) */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              
              {/* Drag and Drop Zone Container */}
              <div 
                ref={dragDropRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`p-8 md:p-10 border border-dashed rounded-lg flex flex-col items-center justify-center text-center transition-all ${
                  dragActive 
                    ? 'border-[#c5a059] bg-[#c5a059]/5' 
                    : transcribeFile 
                      ? 'border-white/[0.14] bg-[#111114]' 
                      : 'border-white/[0.08] bg-[#0e0e11] hover:border-white/[0.16]'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-[#16161a] flex items-center justify-center border border-white/[0.06] mb-3">
                  {transcribeFile ? (
                    <FileAudio className="w-6 h-6 text-[#c5a059]" />
                  ) : (
                    <Upload className="w-6 h-6 text-[#787369]" />
                  )}
                </div>

                {transcribeFile ? (
                  <div className="flex flex-col gap-2 max-w-md w-full items-center">
                    <h3 className="font-editorial text-lg sm:text-xl text-[#f5f2ec] break-words text-center max-w-full">
                      {transcribeFile.name}
                    </h3>
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[#787369] font-sans">
                      <span>Size: {transcribeFile.size}</span>
                      <span aria-hidden="true">•</span>
                      <span>
                        Duration: {transcribeFile.durationSec !== null ? `${transcribeFile.durationSec.toFixed(1)}s` : 'Detected on upload'}
                      </span>
                    </div>

                    {/* Source Audio Preview Player */}
                    {transcribeFile.audioUrl && (
                      <div className="w-full max-w-sm mt-1 p-2.5 bg-[#09090c] border border-white/[0.08] rounded-md flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] text-[#c9c4b9]">
                          <span className="flex items-center gap-1.5 font-medium text-[#ede8df]">
                            <Volume2 className="w-3.5 h-3.5 text-[#c5a059]" />
                            <span>Audio Preview</span>
                          </span>
                          <span className="text-[10px] text-[#787369]">Original Recording</span>
                        </div>
                        <audio
                          controls
                          src={transcribeFile.audioUrl}
                          className="w-full h-8 outline-none"
                          preload="metadata"
                        />
                      </div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 mt-3 w-full sm:w-auto">
                      <button
                        onClick={handleStartMireloTranscription}
                        disabled={isTranscribing}
                        className={`w-full sm:w-auto px-5 py-2.5 text-xs font-sans font-medium rounded-md transition-all cursor-pointer shadow flex items-center justify-center gap-2 min-h-[44px] ${
                          isTranscribing
                            ? 'bg-[#c5a059]/50 text-[#09090b] cursor-not-allowed'
                            : 'bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b]'
                        }`}
                      >
                        {isTranscribing ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                            <span>Transcribing Audio...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Transcribe Audio</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          setTranscribeFile(null);
                          setActiveTranscription(null);
                          setTranscribeError(null);
                          setTranscribeProgress(null);
                        }}
                        disabled={isTranscribing}
                        className="w-full sm:w-auto px-4 py-2 text-xs font-sans border border-white/[0.08] hover:bg-[#1a1a20] rounded-md text-[#858076] hover:text-[#ede8df] transition-colors cursor-pointer disabled:opacity-50 min-h-[44px]"
                      >
                        Choose Different File
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 items-center text-center max-w-md">
                    <p className="font-editorial text-lg sm:text-xl text-[#ede8df]">
                      Select or drop an audio file
                    </p>
                    <p className="text-xs text-[#787369] font-sans leading-relaxed">
                      Accepts MP3, WAV, FLAC, M4A, AAC, and OGG recordings. Transcribes polyphonic music into playable MIDI scores.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 mt-3 w-full sm:w-auto">
                      <button
                        onClick={() => {
                          const fileInput = document.createElement('input');
                          fileInput.type = 'file';
                          fileInput.accept = 'audio/*';
                          // @ts-ignore
                          fileInput.onchange = selectAudioFileViaPicker;
                          fileInput.click();
                        }}
                        className="w-full sm:w-auto px-5 py-2.5 text-xs font-sans font-medium rounded-md border border-white/[0.12] bg-[#141417] text-[#f5f2ec] hover:border-[#c5a059]/50 hover:bg-[#1a1a20] transition-all cursor-pointer min-h-[44px] flex items-center justify-center gap-2"
                      >
                        <Upload className="w-4 h-4 text-[#c5a059]" />
                        <span>Select Audio File</span>
                      </button>

                      {isDebugMode && (
                        <button
                          onClick={handleTestWithSampleAudio}
                          disabled={isTranscribing}
                          className="w-full sm:w-auto px-4 py-2.5 text-xs font-sans rounded-md border border-[#c5a059]/30 bg-[#c5a059]/10 text-[#d8ba7f] hover:bg-[#c5a059]/20 transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                          title="Run an end-to-end multi-track test with acoustic piano, acoustic bass, and detected chords"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#c5a059]" />
                          <span>Try Sample Recording</span>
                        </button>
                      )}

                      {isDebugMode && (
                        <button
                          onClick={handleRunSyncVerificationSuite}
                          disabled={isTranscribing}
                          className="w-full sm:w-auto px-3.5 py-2 text-xs font-sans rounded-md border border-white/[0.08] bg-[#1a1a22] text-[#ede8df] hover:bg-[#242430] transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                          title="Debug: Load 6.0s Clock Sync Verification Suite"
                        >
                          <Check className="w-3 h-3 text-[#a3d99b]" />
                          <span>6.0s Sync Suite</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User-Friendly Error Message Banner */}
              {transcribeError && (
                <div className="bg-[#1c1214] border border-[#6b2930] p-4 rounded-lg flex items-start gap-3 text-xs w-full max-w-full">
                  <AlertCircle className="w-4 h-4 text-[#e06c75] shrink-0 mt-0.5" />
                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <span className="font-medium text-[#f5d6d8]">
                      {transcribeError.includes('Credit Limit') || transcribeError.includes('402') 
                        ? 'Transcription is temporarily unavailable' 
                        : 'Something went wrong'}
                    </span>
                    <p className="text-[#d8a8ad] leading-relaxed">
                      {transcribeError.includes('Credit Limit') || transcribeError.includes('402')
                        ? 'Transcription is temporarily unavailable. Please try again later.'
                        : 'We couldn’t finish preparing your MIDI. Please try again.'}
                    </p>
                    {isDebugMode && (transcribeError.includes('Credit Limit') || transcribeError.includes('402')) && (
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <button
                          onClick={handleTestWithSampleAudio}
                          className="px-3 py-1.5 bg-[#c5a059]/20 border border-[#c5a059]/40 text-[#d8ba7f] hover:bg-[#c5a059]/30 rounded text-xs cursor-pointer font-sans min-h-[36px]"
                        >
                          Test with Sample Audio
                        </button>
                        <a
                          href="https://mirelo.ai/studio/plan"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-white/[0.05] border border-white/[0.1] text-[#ede8df] hover:bg-white/[0.1] rounded text-xs font-sans underline min-h-[36px] flex items-center"
                        >
                          Upgrade Plan
                        </a>
                      </div>
                    )}
                    {/* Detailed Technical Error - Only in Debug Mode */}
                    {isDebugMode && (
                      <div className="mt-2 p-2.5 bg-black/60 border border-white/[0.08] rounded font-mono text-[10px] text-[#e06c75] break-all select-all flex flex-col gap-1">
                        <span className="text-[#787369] font-sans uppercase tracking-wider text-[9px]">Technical Diagnostic Log:</span>
                        <span>{transcribeError}</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setTranscribeError(null)}
                    className="text-[#966b70] hover:text-[#f5d6d8] text-xs cursor-pointer px-2 py-1 shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Progress Bar & Real-time Status */}
              {(isTranscribing || transcribeProgress !== null) && (
                <div className="bg-[#111114] border border-[#c5a059]/30 p-4 sm:p-5 rounded-lg flex flex-col gap-3.5 shadow-xl w-full max-w-full">
                  <div className="flex justify-between items-center text-xs font-sans">
                    <span className="text-[#ede8df] font-medium">Transcribing your audio</span>
                    <span className="text-[#c5a059] font-medium font-tabular">
                      {transcribeProgress?.percent || 0}%
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-1.5 bg-[#1a1a1f] rounded-full overflow-hidden">
                    <div 
                      style={{ width: `${transcribeProgress?.percent || 0}%` }}
                      className="h-full bg-[#c5a059] transition-all duration-300 rounded-full"
                    />
                  </div>

                  {/* Active Step Indicator */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-sans">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {transcribeProgress?.stage === 'complete' ? (
                        <CheckCircle className="w-4 h-4 text-[#a3d99b] shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 border-2 border-white/[0.1] border-t-[#c5a059] rounded-full animate-spin shrink-0" />
                      )}
                      <span className={`truncate text-xs ${transcribeProgress?.stage === 'complete' ? 'text-[#ede8df] font-medium' : 'text-[#a8a398]'}`}>
                        {getFriendlyProgressMessage(transcribeProgress)}
                      </span>
                    </div>

                    {/* Debug Status Controls - Only in Debug Mode */}
                    {isDebugMode && isTranscribing && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            const jId = activeJobId || transcribeProgress?.jobId;
                            if (jId) handleResumeExistingJob(jId);
                          }}
                          className="px-2 py-1 bg-[#1c1c24] hover:bg-[#252532] text-[#d8ba7f] border border-[#c5a059]/30 rounded text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Status</span>
                        </button>
                        {transcribeProgress?.elapsedSec !== undefined && (
                          <span className="text-[10px] text-[#787369] font-tabular font-mono">
                            {transcribeProgress.elapsedSec}s
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Resume Existing Job Card - Only in Debug Mode */}
              {isDebugMode && !isTranscribing && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#111114] border border-[#c5a059]/30 p-4 rounded-lg text-xs font-sans">
                  <div className="flex items-center gap-2.5">
                    <Activity className="w-4 h-4 text-[#c5a059] shrink-0" />
                    <div>
                      <span className="font-medium text-[#ede8df]">Resume Job by ID (Debug Tool)</span>
                      <p className="text-[11px] text-[#787369]">Check a previously submitted job without re-uploading</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      type="text"
                      value={manualJobIdInput}
                      onChange={(e) => setManualJobIdInput(e.target.value)}
                      placeholder="Enter Job ID"
                      className="px-3 py-1.5 bg-[#09090b] border border-white/[0.08] rounded text-xs text-[#ede8df] font-mono flex-1 sm:w-56 focus:border-[#c5a059]/60 focus:outline-none"
                    />
                    <button
                      onClick={() => handleResumeExistingJob()}
                      disabled={!manualJobIdInput.trim() || isTranscribing}
                      className="px-3.5 py-1.5 rounded bg-[#181820] hover:bg-[#22222e] border border-white/[0.08] text-[#c9c4b9] hover:text-[#ede8df] text-xs font-medium cursor-pointer transition-colors disabled:opacity-40 shrink-0"
                    >
                      Resume
                    </button>
                  </div>
                </div>
              )}

              {/* Active Transcription Result Card with Stems, Chords & Open in Studio */}
              {activeTranscription && (
                <div className="flex flex-col gap-6">
                  
                  {/* MIRELO MIDI DEBUG DIAGNOSTICS CARD - Only in Debug Mode */}
                  {isDebugMode && activeTranscription.midiDebug && (
                    <div className="bg-[#111114] border border-[#c5a059]/40 p-6 rounded-lg flex flex-col gap-5 shadow-2xl">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
                        <div className="flex items-center gap-2.5">
                          <Terminal className="w-5 h-5 text-[#c5a059]" />
                          <h3 className="font-editorial text-xl text-[#f5f2ec] font-normal tracking-wide">
                            Mirelo MIDI Debug &amp; Pipeline Inspector
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => handleDownloadMireloMidiDirect(activeTranscription.midiDebug?.jobId)}
                            className="px-3.5 py-2 text-xs font-sans font-medium bg-[#1a1a22] hover:bg-[#242430] text-[#ede8df] rounded-md border border-white/[0.08] cursor-pointer transition-all flex items-center gap-1.5"
                          >
                            <Upload className="w-3.5 h-3.5 text-[#c5a059] rotate-180" />
                            <span>Download Mirelo MIDI</span>
                          </button>
                          <button
                            onClick={() => handleOpenMireloMidiInStudio(activeTranscription.midiDebug?.jobId)}
                            className="px-4 py-2 text-xs font-sans font-semibold bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] rounded-md shadow-lg cursor-pointer transition-all flex items-center gap-1.5"
                          >
                            <span>Open Mirelo MIDI in Studio</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Grid of Diagnostic Properties */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">Job ID</span>
                          <span className="text-[#f5f2ec] truncate">{activeTranscription.midiDebug.jobId}</span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">Job Status</span>
                          <span className="text-[#a3d99b] uppercase font-bold">{activeTranscription.midiDebug.status}</span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">MIDI URL Returned</span>
                          <span className={activeTranscription.midiDebug.hasMidiUrl ? 'text-[#a3d99b]' : 'text-[#e5c07b]'}>
                            {activeTranscription.midiDebug.hasMidiUrl ? 'YES' : 'NO (JSON Notes Received)'}
                          </span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1 col-span-1 sm:col-span-2">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">Exact MIDI URL / Domain</span>
                          <span className="text-[#c5a059] truncate text-[11px]">
                            {activeTranscription.midiDebug.midiUrl || `Domain: ${activeTranscription.midiDebug.midiDomain || 'Mirelo API'}`}
                          </span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">HTTP Status</span>
                          <span className="text-[#f5f2ec]">{activeTranscription.midiDebug.httpStatus || 200} OK</span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">Content-Type</span>
                          <span className="text-[#f5f2ec]">{activeTranscription.midiDebug.contentType || 'audio/midi'}</span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">File Size</span>
                          <span className="text-[#f5f2ec]">{activeTranscription.midiDebug.fileSizeBytes || 0} bytes</span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">MThd Signature</span>
                          <span className={activeTranscription.midiDebug.hasMThdSignature ? 'text-[#a3d99b]' : 'text-[#e06c75]'}>
                            {activeTranscription.midiDebug.hasMThdSignature ? 'VERIFIED (0x4D 0x54 0x68 0x64)' : 'Invalid / Missing'}
                          </span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">Binary MIDI Obtained</span>
                          <span className={activeTranscription.midiDebug.isBinaryObtained ? 'text-[#a3d99b]' : 'text-[#e06c75]'}>
                            {activeTranscription.midiDebug.isBinaryObtained ? 'YES' : 'NO'}
                          </span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">parseMIDIFile() Result</span>
                          <span className={activeTranscription.midiDebug.parsedSuccessfully ? 'text-[#a3d99b]' : 'text-[#e06c75]'}>
                            {activeTranscription.midiDebug.parsedSuccessfully ? 'PASSED' : 'FAILED'}
                          </span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">Number of Tracks</span>
                          <span className="text-[#f5f2ec]">{activeTranscription.midiDebug.numTracks || activeTranscription.tracks.length || 1}</span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">Total MIDI Notes</span>
                          <span className="text-[#f5f2ec]">{activeTranscription.midiDebug.totalNotes || activeTranscription.notes.length}</span>
                        </div>

                        <div className="p-3 bg-[#0a0a0c] border border-white/[0.05] rounded flex flex-col gap-1">
                          <span className="text-[10px] text-[#787369] font-sans uppercase tracking-wider">MIDI Duration</span>
                          <span className="text-[#f5f2ec]">{((activeTranscription.midiDebug.durationMs || activeTranscription.durationMs) / 1000).toFixed(2)}s</span>
                        </div>
                      </div>

                      {/* Parser Errors / Notes */}
                      {activeTranscription.midiDebug.parserError && (
                        <div className="p-3 bg-[#181214] border border-[#5e272c] rounded text-xs text-[#e8abb0] font-sans flex flex-col gap-1">
                          <span className="font-semibold text-[#f5d6d8]">Parser Status Note:</span>
                          <p>{activeTranscription.midiDebug.parserError}</p>
                        </div>
                      )}

                      {/* First Parsed Notes Table */}
                      {activeTranscription.midiDebug.firstNotes && activeTranscription.midiDebug.firstNotes.length > 0 && (
                        <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
                          <span className="text-xs font-sans font-medium text-[#c9c4b9]">First Few Parsed MIDI Notes:</span>
                          <div className="overflow-x-auto bg-[#0a0a0c] border border-white/[0.05] rounded p-2 text-xs font-mono">
                            <table className="w-full text-left">
                              <thead>
                                <tr className="text-[#787369] text-[10px] uppercase border-b border-white/[0.05]">
                                  <th className="py-1 px-2">#</th>
                                  <th className="py-1 px-2">Pitch</th>
                                  <th className="py-1 px-2">Note Name</th>
                                  <th className="py-1 px-2">Start Time</th>
                                  <th className="py-1 px-2">Duration</th>
                                  <th className="py-1 px-2">Velocity</th>
                                </tr>
                              </thead>
                              <tbody>
                                {activeTranscription.midiDebug.firstNotes.map((n, i) => (
                                  <tr key={i} className="border-b border-white/[0.02] text-[#ede8df]">
                                    <td className="py-1 px-2 text-[#787369]">{i + 1}</td>
                                    <td className="py-1 px-2">{n.pitch}</td>
                                    <td className="py-1 px-2 text-[#c5a059] font-bold">{n.noteName}</td>
                                    <td className="py-1 px-2">{n.timeMs} ms ({(n.timeMs / 1000).toFixed(2)}s)</td>
                                    <td className="py-1 px-2">{n.durationMs} ms ({(n.durationMs / 1000).toFixed(2)}s)</td>
                                    <td className="py-1 px-2">{n.velocity}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Raw Response JSON Keys */}
                      <div className="flex items-center justify-between text-[11px] text-[#787369] font-mono pt-1">
                        <span>Raw Response Keys: [{activeTranscription.midiDebug.rawResponseKeys.join(', ')}]</span>
                        <a 
                          href={`/api/transcribe/raw-response/${activeTranscription.midiDebug.jobId}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[#c5a059] hover:underline"
                        >
                          View Raw Mirelo JSON Response
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Summary Result Card */}
                  <div className="bg-[#111114] border border-white/[0.08] p-5 sm:p-6 rounded-lg flex flex-col gap-6 shadow-xl w-full">
                    
                    {/* Header */}
                    <div className="flex flex-col gap-2 border-b border-white/[0.06] pb-5">
                      <h3 className="font-editorial text-2xl sm:text-3xl text-[#f5f2ec] font-normal tracking-wide">
                        Your MIDI is ready
                      </h3>
                      <p className="text-xs sm:text-sm text-[#8f8a80] font-sans flex flex-wrap items-center gap-1.5">
                        <span className="text-[#ede8df] font-tabular font-medium">
                          {activeTranscription.notes.length} notes
                        </span>
                        <span aria-hidden="true" className="text-[#555048]">·</span>
                        <span className="text-[#ede8df] font-tabular">
                          {activeTranscription.tracks.length || activeTranscription.instruments.length || 1} {(activeTranscription.tracks.length || activeTranscription.instruments.length || 1) === 1 ? 'instrument' : 'instruments'}
                        </span>
                        {activeTranscription.tempo ? (
                          <>
                            <span aria-hidden="true" className="text-[#555048]">·</span>
                            <span className="text-[#ede8df] font-tabular">
                              {Math.round(activeTranscription.tempo)} BPM
                            </span>
                          </>
                        ) : null}
                      </p>

                      {/* Action Buttons: Full width on phones, 44px minimum tap height */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-3">
                        <button
                          onClick={() => handleOpenMireloMidiInStudio(activeTranscription.midiDebug?.jobId || activeJobId || undefined)}
                          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] text-xs sm:text-sm font-sans font-semibold bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] rounded-md shadow-lg cursor-pointer transition-all shrink-0"
                        >
                          <span>Open in Studio</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDownloadMireloMidiDirect(activeTranscription.midiDebug?.jobId || activeJobId || undefined)}
                          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-xs sm:text-sm font-sans font-medium bg-[#1a1a22] hover:bg-[#242430] text-[#ede8df] rounded-md border border-white/[0.08] cursor-pointer transition-all shrink-0"
                          title="Download MIDI (.mid file)"
                        >
                          <Download className="w-4 h-4 text-[#c5a059]" />
                          <span>Download MIDI</span>
                        </button>
                      </div>
                    </div>

                    {/* Below: Instrument tracks list */}
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-sans font-medium uppercase tracking-wider text-[#c5a059]">
                          Instrument tracks
                        </h4>
                        <span className="text-[11px] text-[#787369] font-sans">
                          {activeTranscription.tracks.length} {activeTranscription.tracks.length === 1 ? 'track' : 'tracks'}
                        </span>
                      </div>

                      <div className="flex flex-col divide-y divide-white/[0.04] bg-[#0c0c0f] border border-white/[0.05] rounded-lg overflow-hidden">
                        {activeTranscription.tracks.map((trk) => {
                          const isSelected = selectedTrackIds.includes(trk.id);
                          return (
                            <button
                              key={trk.id}
                              type="button"
                              onClick={() => handleToggleTrack(trk.id)}
                              className={`w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[44px] text-left cursor-pointer transition-colors ${
                                isSelected ? 'bg-[#14141a]/60 hover:bg-[#181822]' : 'bg-transparent hover:bg-white/[0.02]'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-[#c5a059]' : 'bg-[#3b3832]'}`} />
                                <span className={`text-xs sm:text-sm font-sans font-medium truncate ${
                                  isSelected ? 'text-[#ede8df]' : 'text-[#787369]'
                                }`}>
                                  {formatTrackName(trk.name)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-xs text-[#787369] font-sans font-tabular">
                                  {trk.notes.length} notes
                                </span>
                                <span className={`text-[11px] font-sans font-medium px-2 py-0.5 rounded border ${
                                  isSelected 
                                    ? 'bg-[#c5a059]/15 text-[#d8ba7f] border-[#c5a059]/30' 
                                    : 'bg-white/[0.02] text-[#6d6860] border-white/[0.05]'
                                }`}>
                                  {isSelected ? 'On' : 'Off'}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Original audio player */}
                    {(activeTranscription.audioUrl || transcribeFile?.audioUrl) && (
                      <div className="flex flex-col gap-2 p-3.5 bg-[#0e0e11] border border-white/[0.06] rounded-md">
                        <div className="flex items-center gap-2 text-xs font-sans font-medium text-[#c9c4b9]">
                          <Volume2 className="w-3.5 h-3.5 text-[#c5a059]" />
                          <span>Compare with original</span>
                        </div>
                        <audio
                          controls
                          src={activeTranscription.audioUrl || transcribeFile?.audioUrl}
                          className="w-full h-8 outline-none"
                          preload="metadata"
                        />
                      </div>
                    )}

                  </div>
              </div>
            )}

              {/* Transcription History */}
              {transcriptionHistory.length > 0 && (
                <div className="bg-[#111114] border border-white/[0.06] p-5 rounded-lg flex flex-col gap-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-[#c5a059]" />
                      <h4 className="font-editorial text-lg text-[#f5f2ec] font-normal">
                        Transcription History
                      </h4>
                    </div>
                    <span className="text-xs text-[#787369] font-sans">
                      {transcriptionHistory.length} Transcription{transcriptionHistory.length > 1 ? 's' : ''} Cached
                    </span>
                  </div>

                  <div className="divide-y divide-white/[0.04]">
                    {transcriptionHistory.map((item) => (
                      <div key={item.id} className="py-3 flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-editorial text-base text-[#ede8df]">{item.title}</span>
                          <div className="flex items-center gap-2 text-xs text-[#787369] font-sans">
                            <span>{item.notes.length} notes</span>
                            <span>•</span>
                            <span>{item.instruments.join(', ') || 'Piano'}</span>
                            <span>•</span>
                            <span>{item.chords.length} chords</span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleOpenInStudio(item)}
                          className="px-3 py-1.5 text-xs font-sans rounded bg-white/[0.04] hover:bg-[#c5a059]/20 text-[#c9c4b9] hover:text-[#f5f2ec] border border-white/[0.06] transition-all cursor-pointer shrink-0"
                        >
                          Load in Studio
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

          </div>
        </div>

        )}

      </main>

      {/* Quiet Studio Footer */}
      <footer className="mt-auto py-5 border-t border-white/[0.04] bg-[#09090b] text-center text-xs font-sans text-[#5c5850] px-6">
        <p>AuraMIDI — Dedicated Digital Piano Studio. Sub-millisecond Web Audio Engine & MIDI Class Compliant.</p>
      </footer>

    </div>
  );
}
