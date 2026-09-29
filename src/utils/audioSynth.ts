import * as Tone from 'tone';

export type InstrumentType = 'grand' | 'rhodes';

export interface InstrumentInfo {
  id: InstrumentType;
  name: string;
  category: string;
  source: string;
  license: string;
  description: string;
}

export const INSTRUMENT_DEFINITIONS: InstrumentInfo[] = [
  {
    id: 'grand',
    name: 'Grand Piano',
    category: 'Acoustic',
    source: 'Salamander Grand Piano (Yamaha C5)',
    license: 'Creative Commons Attribution 3.0 (CC-BY 3.0) by Alexander Holm',
    description: 'Natural sampled acoustic Yamaha C5 grand piano with authentic hammer response and acoustic resonance.'
  },
  {
    id: 'rhodes',
    name: 'Electric Piano',
    category: 'Vintage Keys',
    source: 'FluidR3_GM Electric Piano 1 (Rhodes Mark I)',
    license: 'Creative Commons Attribution 3.0 (CC-BY 3.0 US) by Frank Wen',
    description: 'Warm, expressive vintage electric piano with chiming bell tines and smooth harmonic decay.'
  }
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteName = NOTE_NAMES[midi % 12];
  return `${noteName}${octave}`;
}

type LoadingListener = (loading: boolean, instrumentId: InstrumentType) => void;

/**
 * High-performance Sample-Based Instrument Audio Engine
 * Powered by Tone.js Sampler with sample pitch interpolation and acoustic envelope modeling.
 * Fully supports MIDI playback, virtual keyboard interaction, sustain pedal, and custom release damping.
 */
export class SampledAudioEngine {
  private isInitialized: boolean = false;
  private masterGain: Tone.Gain | null = null;
  private analyserNode: AnalyserNode | null = null;
  private fallbackSynth: Tone.PolySynth | null = null;

  // Active sampler cache & current selection
  private samplers: Map<InstrumentType, Tone.Sampler> = new Map();
  private loadingStates: Map<InstrumentType, boolean> = new Map();
  private loadingListeners: Set<LoadingListener> = new Set();
  
  public currentInstrument: InstrumentType = 'grand';
  public volume: number = 0.8;
  public transpose: number = 0; // in semitones
  public sustainEnabled: boolean = false;
  public releaseSeconds: number = 0.8;

  // Held and sustained notes for natural acoustic damping & pedal release
  private heldNotes: Set<number> = new Set();
  private sustainedNotes: Set<number> = new Set();

  constructor() {
    this.loadingStates.set('grand', false);
    this.loadingStates.set('rhodes', false);
    this.setupAudioGraph();
  }

  public getAudioContextState(): string {
    try {
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      return rawCtx?.state || Tone.getContext().state || 'unknown';
    } catch (_) {
      return 'uninitialized';
    }
  }

  public unlockAudio(): void {
    this.setupAudioGraph();
    try {
      Tone.start();
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      if (rawCtx && rawCtx.state !== 'running') {
        rawCtx.resume();
      }
      this.isInitialized = true;
    } catch (_) {}
  }

  /**
   * Initialize Tone.js audio graph and unlock browser AudioContext on user interaction
   */
  public async init(): Promise<void> {
    this.unlockAudio();
    if (!this.samplers.has(this.currentInstrument)) {
      this.loadInstrument(this.currentInstrument);
    }
  }

  public async resume(): Promise<void> {
    this.setupAudioGraph();
    try {
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      if (rawCtx && rawCtx.state !== 'running') {
        await rawCtx.resume();
      }
      if (Tone.getContext().state !== 'running') {
        await Tone.start();
      }
    } catch (_) {}
  }

  private setupAudioGraph(): void {
    if (this.masterGain) return;

    try {
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      this.analyserNode = rawCtx.createAnalyser();
      this.analyserNode.fftSize = 256;

      // Master volume gain node
      this.masterGain = new Tone.Gain(this.volume);
      this.masterGain.toDestination();

      // Fallback synthesizer (triangle wave with smooth acoustic piano envelope)
      // Ensures audio ALWAYS plays immediately even while sample buffers are downloading
      this.fallbackSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0.3, release: 0.8 },
      });
      this.fallbackSynth.maxPolyphony = 64;
      this.fallbackSynth.volume.value = -4;
      this.fallbackSynth.connect(this.masterGain);

      // Tap signal into the native analyser for waveform visualization
      Tone.connect(this.masterGain, this.analyserNode);

      // Connect any already created samplers to the master gain
      this.samplers.forEach((sampler) => {
        try {
          sampler.connect(this.masterGain!);
        } catch (_) {}
      });
    } catch (err) {
      console.error('Error creating Audio Graph:', err);
    }
  }

  public getAnalyser(): AnalyserNode | null {
    if (!this.analyserNode) {
      try {
        const rawCtx = Tone.getContext().rawContext as AudioContext;
        if (rawCtx) {
          this.analyserNode = rawCtx.createAnalyser();
          this.analyserNode.fftSize = 256;
          if (this.masterGain) {
            Tone.connect(this.masterGain, this.analyserNode);
          }
        }
      } catch (_) {}
    }
    return this.analyserNode;
  }

  public subscribeLoading(listener: LoadingListener): () => void {
    this.loadingListeners.add(listener);
    return () => {
      this.loadingListeners.delete(listener);
    };
  }

  private notifyLoading(loading: boolean, instrumentId: InstrumentType): void {
    this.loadingStates.set(instrumentId, loading);
    this.loadingListeners.forEach((fn) => fn(loading, instrumentId));
  }

  public isInstrumentLoading(id: InstrumentType = this.currentInstrument): boolean {
    return this.loadingStates.get(id) || false;
  }

  public isInstrumentLoaded(id: InstrumentType = this.currentInstrument): boolean {
    const s = this.samplers.get(id);
    return !!(s && s.loaded);
  }

  /**
   * Load and cache instrument sample buffers using Tone.Sampler
   */
  public async loadInstrument(instrumentId: InstrumentType): Promise<Tone.Sampler> {
    if (this.samplers.has(instrumentId)) {
      return this.samplers.get(instrumentId)!;
    }

    this.notifyLoading(true, instrumentId);

    return new Promise<Tone.Sampler>((resolve) => {
      if (instrumentId === 'grand') {
        // Salamander Grand Piano V3 (CC-BY 3.0 Alexander Holm)
        // Highly optimized mobile sample set covering all 88 keys via intelligent pitch interpolation
        const salamanderSamples: Record<string, string> = {
          A0: 'A0.mp3',
          C1: 'C1.mp3',
          'F#1': 'Fs1.mp3',
          A1: 'A1.mp3',
          C2: 'C2.mp3',
          'F#2': 'Fs2.mp3',
          A2: 'A2.mp3',
          C3: 'C3.mp3',
          'F#3': 'Fs3.mp3',
          A3: 'A3.mp3',
          C4: 'C4.mp3',
          'F#4': 'Fs4.mp3',
          A4: 'A4.mp3',
          C5: 'C5.mp3',
          'F#5': 'Fs5.mp3',
          A5: 'A5.mp3',
          C6: 'C6.mp3',
          'F#6': 'Fs6.mp3',
          A6: 'A6.mp3',
          C7: 'C7.mp3',
          C8: 'C8.mp3'
        };

        const sampler = new Tone.Sampler({
          urls: salamanderSamples,
          baseUrl: 'https://tonejs.github.io/audio/salamander/',
          release: this.releaseSeconds,
          onload: () => {
            this.notifyLoading(false, 'grand');
            resolve(sampler);
          },
          onerror: (err) => {
            console.error('Failed to load Grand Piano samples:', err);
            this.notifyLoading(false, 'grand');
            resolve(sampler);
          }
        });

        if (this.masterGain) {
          sampler.connect(this.masterGain);
        }
        this.samplers.set('grand', sampler);

      } else if (instrumentId === 'rhodes') {
        // FluidR3_GM Electric Piano 1 (CC-BY 3.0 Frank Wen)
        // Dynamically loaded soundfont script with base64 decoded buffers for instant Rhodes playback
        const fetchRhodesSamples = async () => {
          try {
            const res = await fetch('https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/electric_piano_1-mp3.js');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const scriptText = await res.text();
            
            const sandbox: any = {};
            const runner = new Function('MIDI', scriptText);
            runner(sandbox);

            const soundfont = sandbox.Soundfont?.electric_piano_1;
            if (!soundfont) throw new Error('Soundfont parse error');

            // Select key register anchors to optimize memory on mobile devices
            const targetKeys = ['C1', 'G1', 'C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'G5', 'C6', 'G6', 'C7', 'G7', 'C8'];
            const sampleUrls: Record<string, string> = {};
            targetKeys.forEach((k) => {
              if (soundfont[k]) {
                sampleUrls[k] = soundfont[k];
              }
            });

            const sampler = new Tone.Sampler({
              urls: sampleUrls,
              release: this.releaseSeconds,
              onload: () => {
                this.notifyLoading(false, 'rhodes');
                resolve(sampler);
              },
              onerror: (err) => {
                console.error('Failed to decode Electric Piano buffers:', err);
                this.notifyLoading(false, 'rhodes');
                resolve(sampler);
              }
            });

            if (this.masterGain) {
              sampler.connect(this.masterGain);
            }
            this.samplers.set('rhodes', sampler);

          } catch (err) {
            console.error('Error fetching Electric Piano soundfont:', err);
            this.notifyLoading(false, 'rhodes');
            
            // Fallback: If network fails, reuse grand piano or create minimal sampler
            const fallback = this.samplers.get('grand');
            if (fallback) {
              this.samplers.set('rhodes', fallback);
              resolve(fallback);
            }
          }
        };

        fetchRhodesSamples();
      }
    });
  }

  public setInstrument(id: InstrumentType | string): void {
    const targetId: InstrumentType = id === 'rhodes' ? 'rhodes' : 'grand';
    if (this.currentInstrument === targetId) return;

    this.silenceAll();
    this.currentInstrument = targetId;

    if (!this.samplers.has(targetId)) {
      this.loadInstrument(targetId);
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.rampTo(this.volume, 0.05);
    }
  }

  public setSustain(enabled: boolean): void {
    this.sustainEnabled = enabled;

    // If sustain is released, damp all notes that are no longer physically held down
    if (!enabled) {
      const sampler = this.samplers.get(this.currentInstrument);
      if (sampler && sampler.loaded) {
        const toRelease: string[] = [];
        this.sustainedNotes.forEach((pitch) => {
          if (!this.heldNotes.has(pitch)) {
            toRelease.push(midiToNoteName(pitch));
          }
        });

        if (toRelease.length > 0) {
          try {
            sampler.triggerRelease(toRelease, Tone.now());
          } catch (_) {}
        }
      }
      this.sustainedNotes.clear();
    }
  }

  public setRelease(seconds: number): void {
    this.releaseSeconds = Math.max(0.2, Math.min(4.0, seconds));
    this.samplers.forEach((sampler) => {
      sampler.release = this.releaseSeconds;
    });
  }

  /**
   * Schedule a note for playback (used by falling-note player and lookahead sequencer)
   * @param noteNumber MIDI pitch number (e.g. 60 for Middle C)
   * @param startTimeOffsetSec Start delay relative to audio clock (0 for immediate)
   * @param durationSec Duration note should be held before damper release
   * @param velocity Velocity (0 to 127)
   * @returns boolean true if audio event was scheduled/played successfully
   */
  public playNote(
    noteNumber: number,
    startTimeOffsetSec: number,
    durationSec: number,
    velocity: number = 95
  ): boolean {
    if (!this.isInitialized) {
      this.init();
    }

    const pitchedNote = noteNumber + this.transpose;
    if (pitchedNote < 21 || pitchedNote > 108) return false;

    const noteName = midiToNoteName(pitchedNote);
    const startTime = Tone.now() + Math.max(0, startTimeOffsetSec);
    const vel = Math.max(0.05, Math.min(1, velocity / 127));

    // When sustain pedal is held down, let strings vibrate for natural decay
    const effectiveDuration = this.sustainEnabled
      ? Math.max(durationSec, 3.2)
      : Math.max(0.08, durationSec);

    let played = false;
    const sampler = this.samplers.get(this.currentInstrument);
    if (sampler && sampler.loaded) {
      try {
        sampler.triggerAttackRelease(noteName, effectiveDuration, startTime, vel);
        played = true;
      } catch (e) {
        // Fall through to fallback synth if sampler encounters an unmapped pitch or voice issue
      }
    }

    // Fallback to instant PolySynth if sampler is loading or failed
    if (!played && this.fallbackSynth) {
      try {
        this.fallbackSynth.triggerAttackRelease(noteName, effectiveDuration, startTime, vel);
        played = true;
      } catch (_) {}
    }

    return played;
  }

  /**
   * Begin sounding a note immediately on key press (manual keyboard, touch, or MIDI note-on)
   */
  public startNote(noteNumber: number, velocity: number = 95): void {
    this.init();

    const pitchedNote = noteNumber + this.transpose;
    if (pitchedNote < 21 || pitchedNote > 108) return;

    this.heldNotes.add(pitchedNote);

    const noteName = midiToNoteName(pitchedNote);
    const vel = Math.max(0.05, Math.min(1, velocity / 127));

    const sampler = this.samplers.get(this.currentInstrument);
    if (sampler && sampler.loaded) {
      try {
        sampler.triggerAttack(noteName, Tone.now(), vel);
        return;
      } catch (_) {}
    }

    if (this.fallbackSynth) {
      try {
        this.fallbackSynth.triggerAttack(noteName, Tone.now(), vel);
      } catch (_) {}
    }
  }

  /**
   * Release damper for a note (manual keyboard, touch, or MIDI note-off)
   */
  public stopNote(noteNumber: number): void {
    const pitchedNote = noteNumber + this.transpose;
    this.heldNotes.delete(pitchedNote);

    const noteName = midiToNoteName(pitchedNote);

    if (this.sustainEnabled) {
      // Keep damper lifted while sustain pedal is held
      this.sustainedNotes.add(pitchedNote);
      return;
    }

    const sampler = this.samplers.get(this.currentInstrument);
    if (sampler && sampler.loaded) {
      try {
        sampler.triggerRelease(noteName, Tone.now());
        return;
      } catch (_) {}
    }

    if (this.fallbackSynth) {
      try {
        this.fallbackSynth.triggerRelease(noteName, Tone.now());
      } catch (_) {}
    }
  }

  private testTimerIds: number[] = [];

  /**
   * Diagnostic Test A: Plays C4 (60), E4 (64), G4 (67) simultaneously for ~1.0 second.
   * Completely independent of any song, scheduler, or timeline.
   */
  public async playTestCMajorChord(): Promise<{ success: boolean; state: string; details: string }> {
    try {
      this.setupAudioGraph();
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      if (rawCtx && rawCtx.state !== 'running') {
        await rawCtx.resume();
      }
      if (Tone.getContext().state !== 'running') {
        await Tone.start();
      }

      const chordPitches = [60, 64, 67]; // C4, E4, G4
      const chordNames = chordPitches.map(p => midiToNoteName(p));
      const now = Tone.now();
      const duration = 1.0;

      const sampler = this.samplers.get(this.currentInstrument);
      if (sampler && sampler.loaded) {
        chordNames.forEach(n => {
          sampler.triggerAttackRelease(n, duration, now, 0.85);
        });
        return { 
          success: true, 
          state: this.getAudioContextState(), 
          details: `Played C Major chord (${chordNames.join(', ')}) via Sampler (${this.currentInstrument})` 
        };
      }

      if (this.fallbackSynth) {
        this.fallbackSynth.triggerAttackRelease(chordNames, duration, now, 0.85);
        return { 
          success: true, 
          state: this.getAudioContextState(), 
          details: `Played C Major chord (${chordNames.join(', ')}) via PolySynth fallback` 
        };
      }

      return { 
        success: false, 
        state: this.getAudioContextState(), 
        details: 'Neither Sampler nor PolySynth was available to sound' 
      };
    } catch (err: any) {
      return { 
        success: false, 
        state: this.getAudioContextState(), 
        details: `Audio engine error: ${err.message}` 
      };
    }
  }

  /**
   * Diagnostic Test B: Takes 5-10 notes directly and schedules them sequentially based on their start times.
   * Bypasses falling-note canvas, song scheduler, timeline logic, and pause/resume logic.
   * note -> wait until note.time -> playNote -> stop after duration
   */
  public async playManualNotesSequence(
    notes: Array<{ note: number; time: number; duration: number; velocity?: number }>,
    onNoteStart?: (pitch: number) => void,
    onNoteEnd?: (pitch: number) => void,
    onComplete?: () => void
  ): Promise<{ success: boolean; count: number; state: string; details: string }> {
    this.stopManualNotesSequence();

    if (!notes || notes.length === 0) {
      return { success: false, count: 0, state: this.getAudioContextState(), details: 'No notes provided to test' };
    }

    try {
      this.setupAudioGraph();
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      if (rawCtx && rawCtx.state !== 'running') {
        await rawCtx.resume();
      }
      if (Tone.getContext().state !== 'running') {
        await Tone.start();
      }

      const notesToPlay = notes.slice(0, 10);
      const baseTime = notesToPlay[0].time;
      let scheduledCount = 0;
      let maxEndDelayMs = 0;

      notesToPlay.forEach((n) => {
        const delayMs = Math.max(0, n.time - baseTime);
        const durMs = Math.max(80, n.duration);
        const delaySec = delayMs / 1000;
        const durSec = durMs / 1000;
        const vel = n.velocity ?? 80;

        // Schedule in Web Audio directly via Tone audio clock
        const ok = this.playNote(n.note, delaySec, durSec, vel);
        if (ok) scheduledCount++;

        // Visual callbacks via setTimeout for real-time key feedback
        if (onNoteStart) {
          const tId = window.setTimeout(() => onNoteStart(n.note), delayMs);
          this.testTimerIds.push(tId);
        }
        if (onNoteEnd) {
          const tId = window.setTimeout(() => onNoteEnd(n.note), delayMs + durMs);
          this.testTimerIds.push(tId);
        }

        if (delayMs + durMs > maxEndDelayMs) {
          maxEndDelayMs = delayMs + durMs;
        }
      });

      if (onComplete) {
        const tId = window.setTimeout(() => onComplete(), maxEndDelayMs + 200);
        this.testTimerIds.push(tId);
      }

      return {
        success: scheduledCount > 0,
        count: scheduledCount,
        state: this.getAudioContextState(),
        details: `Scheduled ${scheduledCount}/${notesToPlay.length} notes (first pitch: ${notesToPlay[0].note} [${midiToNoteName(notesToPlay[0].note)}], last pitch: ${notesToPlay[notesToPlay.length - 1].note} [${midiToNoteName(notesToPlay[notesToPlay.length - 1].note)}])`
      };
    } catch (err: any) {
      return {
        success: false,
        count: 0,
        state: this.getAudioContextState(),
        details: `Error playing manual notes: ${err.message}`
      };
    }
  }

  public stopManualNotesSequence(): void {
    this.testTimerIds.forEach(id => window.clearTimeout(id));
    this.testTimerIds = [];
    this.silenceAll();
  }

  /**
   * Immediately silence all sounding notes (e.g. on pause, seek, stop)
   */
  public silenceAll(): void {
    this.heldNotes.clear();
    this.sustainedNotes.clear();
    
    this.samplers.forEach((sampler) => {
      try {
        sampler.releaseAll(Tone.now());
      } catch (_) {}
    });

    if (this.fallbackSynth) {
      try {
        this.fallbackSynth.releaseAll(Tone.now());
      } catch (_) {}
    }
  }
}

// Global singleton instance for AuraMIDI
export const synthInstance = new SampledAudioEngine();
