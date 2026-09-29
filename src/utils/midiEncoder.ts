import { MIDINote } from '../data/sampleSongs';

export interface EncodableTrack {
  name: string;
  notes: MIDINote[];
  channel?: number;
}

/**
 * Encodes MIDINote[] into a standard Format 0 binary MIDI file (.mid).
 * Produces a valid ArrayBuffer with MThd header, MTrk track, VLQ delta times, and NoteOn/NoteOff events.
 */
export function createMIDIFileBuffer(
  notes: MIDINote[],
  bpm: number = 120,
  title: string = 'AuraMIDI Score',
  tracks?: EncodableTrack[]
): ArrayBuffer {
  if (tracks && tracks.length > 1) {
    return createMultiTrackMIDIFileBuffer(tracks, bpm, title);
  }

  const ppq = 480; // Standard ticks per quarter note
  const microSecondsPerQuarter = Math.round(60000000 / Math.max(30, bpm));

  // Ticks per millisecond
  const msToTicks = (ms: number) => Math.round((ms * ppq * 1000) / microSecondsPerQuarter);

  interface RawMIDIEvent {
    tick: number;
    type: 'noteOn' | 'noteOff' | 'meta';
    pitch?: number;
    velocity?: number;
    metaType?: number;
    metaData?: number[];
  }

  const events: RawMIDIEvent[] = [];

  // Track Name Meta Event
  const titleBytes = Array.from(new TextEncoder().encode(title));
  events.push({
    tick: 0,
    type: 'meta',
    metaType: 0x03,
    metaData: titleBytes,
  });

  // Set Tempo Meta Event (3 bytes: microseconds per quarter)
  const tempoBytes = [
    (microSecondsPerQuarter >> 16) & 0xFF,
    (microSecondsPerQuarter >> 8) & 0xFF,
    microSecondsPerQuarter & 0xFF,
  ];
  events.push({
    tick: 0,
    type: 'meta',
    metaType: 0x51,
    metaData: tempoBytes,
  });

  // Convert notes to NoteOn and NoteOff events
  notes.forEach((n) => {
    const startTick = msToTicks(n.time);
    const endTick = msToTicks(n.time + n.duration);
    const pitch = Math.max(0, Math.min(127, Math.round(n.note)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity || 80)));

    events.push({
      tick: startTick,
      type: 'noteOn',
      pitch,
      velocity: vel,
    });

    events.push({
      tick: Math.max(startTick + 1, endTick),
      type: 'noteOff',
      pitch,
      velocity: 0,
    });
  });

  // Sort events chronologically by tick (noteOff before noteOn if same tick)
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.type === 'noteOff' && b.type === 'noteOn') return -1;
    if (a.type === 'noteOn' && b.type === 'noteOff') return 1;
    return 0;
  });

  // End of Track Meta Event
  const maxTick = events.length > 0 ? events[events.length - 1].tick + 480 : 480;
  events.push({
    tick: maxTick,
    type: 'meta',
    metaType: 0x2F,
    metaData: [],
  });

  // Helper VLQ writer
  const writeVLQ = (val: number): number[] => {
    let buffer = val & 0x7F;
    const bytes: number[] = [];
    while ((val >>= 7) > 0) {
      buffer <<= 8;
      buffer |= 0x80 | (val & 0x7F);
    }
    while (true) {
      bytes.push(buffer & 0xFF);
      if (buffer & 0x80) {
        buffer >>= 8;
      } else {
        break;
      }
    }
    return bytes;
  };

  // Build Track Chunk Bytes
  const trackBytes: number[] = [];
  let lastTick = 0;

  for (const ev of events) {
    const deltaTime = Math.max(0, ev.tick - lastTick);
    lastTick = ev.tick;

    trackBytes.push(...writeVLQ(deltaTime));

    if (ev.type === 'noteOn') {
      trackBytes.push(0x90, ev.pitch!, ev.velocity!);
    } else if (ev.type === 'noteOff') {
      trackBytes.push(0x80, ev.pitch!, 0);
    } else if (ev.type === 'meta') {
      trackBytes.push(0xFF, ev.metaType!, ev.metaData!.length, ...ev.metaData!);
    }
  }

  // Header Chunk (14 bytes) + Track Chunk (8 bytes header + trackBytes.length)
  const totalLength = 14 + 8 + trackBytes.length;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  let pos = 0;

  const writeString = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(pos++, str.charCodeAt(i));
    }
  };

  // Write MThd Header
  writeString('MThd');
  view.setUint32(pos, 6, false); pos += 4; // header length = 6
  view.setUint16(pos, 0, false); pos += 2; // format 0
  view.setUint16(pos, 1, false); pos += 2; // 1 track
  view.setUint16(pos, ppq, false); pos += 2; // division = 480 ppq

  // Write MTrk Track Chunk
  writeString('MTrk');
  view.setUint32(pos, trackBytes.length, false); pos += 4;

  const uint8View = new Uint8Array(buffer, pos);
  uint8View.set(trackBytes);

  return buffer;
}

/**
 * Encodes multi-track notes into a standard Format 1 binary MIDI file (.mid).
 */
export function createMultiTrackMIDIFileBuffer(
  tracks: EncodableTrack[],
  bpm: number = 120,
  title: string = 'AuraMIDI Score'
): ArrayBuffer {
  const ppq = 480;
  const microSecondsPerQuarter = Math.round(60000000 / Math.max(30, bpm));
  const msToTicks = (ms: number) => Math.round((ms * ppq * 1000) / microSecondsPerQuarter);

  const writeVLQ = (val: number): number[] => {
    let buffer = val & 0x7F;
    const bytes: number[] = [];
    while ((val >>= 7) > 0) {
      buffer <<= 8;
      buffer |= 0x80 | (val & 0x7F);
    }
    while (true) {
      bytes.push(buffer & 0xFF);
      if (buffer & 0x80) {
        buffer >>= 8;
      } else {
        break;
      }
    }
    return bytes;
  };

  // Track 0: Conductor track (Title + Tempo)
  const conductorEvents: Array<{ tick: number; metaType: number; metaData: number[] }> = [
    {
      tick: 0,
      metaType: 0x03,
      metaData: Array.from(new TextEncoder().encode(title)),
    },
    {
      tick: 0,
      metaType: 0x51,
      metaData: [
        (microSecondsPerQuarter >> 16) & 0xFF,
        (microSecondsPerQuarter >> 8) & 0xFF,
        microSecondsPerQuarter & 0xFF,
      ],
    },
    {
      tick: 480,
      metaType: 0x2F,
      metaData: [],
    },
  ];

  const trackBuffers: number[][] = [];

  // Build conductor track
  const conductorBytes: number[] = [];
  let condLastTick = 0;
  for (const ev of conductorEvents) {
    conductorBytes.push(...writeVLQ(ev.tick - condLastTick));
    condLastTick = ev.tick;
    conductorBytes.push(0xFF, ev.metaType, ev.metaData.length, ...ev.metaData);
  }
  trackBuffers.push(conductorBytes);

  // Build instrument tracks
  tracks.forEach((trk, trkIdx) => {
    const trkEvents: Array<{
      tick: number;
      type: 'noteOn' | 'noteOff' | 'meta';
      pitch?: number;
      velocity?: number;
      channel?: number;
      metaType?: number;
      metaData?: number[];
    }> = [];

    const channel = trk.channel !== undefined ? (trk.channel & 0x0F) : (trkIdx % 16);

    trkEvents.push({
      tick: 0,
      type: 'meta',
      metaType: 0x03,
      metaData: Array.from(new TextEncoder().encode(trk.name || `Track ${trkIdx + 1}`)),
    });

    trk.notes.forEach((n) => {
      const startTick = msToTicks(n.time);
      const endTick = msToTicks(n.time + n.duration);
      const pitch = Math.max(0, Math.min(127, Math.round(n.note)));
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity || 80)));

      trkEvents.push({
        tick: startTick,
        type: 'noteOn',
        pitch,
        velocity: vel,
        channel,
      });

      trkEvents.push({
        tick: Math.max(startTick + 1, endTick),
        type: 'noteOff',
        pitch,
        velocity: 0,
        channel,
      });
    });

    trkEvents.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      if (a.type === 'noteOff' && b.type === 'noteOn') return -1;
      if (a.type === 'noteOn' && b.type === 'noteOff') return 1;
      return 0;
    });

    const maxTick = trkEvents.length > 0 ? trkEvents[trkEvents.length - 1].tick + 480 : 480;
    trkEvents.push({
      tick: maxTick,
      type: 'meta',
      metaType: 0x2F,
      metaData: [],
    });

    const tBytes: number[] = [];
    let lastTick = 0;

    for (const ev of trkEvents) {
      tBytes.push(...writeVLQ(Math.max(0, ev.tick - lastTick)));
      lastTick = ev.tick;

      if (ev.type === 'noteOn') {
        tBytes.push(0x90 | (ev.channel || 0), ev.pitch!, ev.velocity!);
      } else if (ev.type === 'noteOff') {
        tBytes.push(0x80 | (ev.channel || 0), ev.pitch!, 0);
      } else if (ev.type === 'meta') {
        tBytes.push(0xFF, ev.metaType!, ev.metaData!.length, ...ev.metaData!);
      }
    }

    trackBuffers.push(tBytes);
  });

  const numTracks = trackBuffers.length;
  let totalLength = 14; // Header length
  for (const tBytes of trackBuffers) {
    totalLength += 8 + tBytes.length;
  }

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  let pos = 0;

  const writeString = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(pos++, str.charCodeAt(i));
    }
  };

  // Header MThd
  writeString('MThd');
  view.setUint32(pos, 6, false); pos += 4;
  view.setUint16(pos, 1, false); pos += 2; // Format 1 (multi-track)
  view.setUint16(pos, numTracks, false); pos += 2; // Total tracks
  view.setUint16(pos, ppq, false); pos += 2; // 480 PPQ

  // Track chunks
  for (const tBytes of trackBuffers) {
    writeString('MTrk');
    view.setUint32(pos, tBytes.length, false); pos += 4;
    const uint8View = new Uint8Array(buffer, pos);
    uint8View.set(tBytes);
    pos += tBytes.length;
  }

  return buffer;
}
