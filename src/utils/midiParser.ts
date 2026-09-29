import { MIDINote } from '../data/sampleSongs';

interface ActiveNote {
  pitch: number;
  startTime: number;
  startTick: number;
  velocity: number;
}

export interface ParsedMIDITrack {
  id: string;
  name: string;
  instrument: string;
  channel?: number;
  notes: MIDINote[];
}

export function parseMIDIFile(buffer: ArrayBuffer, fileName: string = 'Uploaded MIDI'): {
  title: string;
  composer: string;
  notes: MIDINote[];
  durationMs: number;
  bpm: number;
  numTracks: number;
  ppq: number;
  trackNames: string[];
  tracks: ParsedMIDITrack[];
  fileSize: number;
  format: number;
} {
  const data = new DataView(buffer);
  let pos = 0;

  // Helper readers
  const readByte = () => data.getUint8(pos++);
  const readUint16 = () => {
    const val = data.getUint16(pos);
    pos += 2;
    return val;
  };
  const readUint32 = () => {
    const val = data.getUint32(pos);
    pos += 4;
    return val;
  };
  const readBytes = (len: number) => {
    const arr = new Uint8Array(buffer, pos, len);
    pos += len;
    return arr;
  };

  // Variable-Length Quantity (VLQ) reader
  const readVLQ = () => {
    let value = 0;
    while (pos < data.byteLength) {
      const b = readByte();
      value = (value << 7) | (b & 0x7F);
      if (!(b & 0x80)) break;
    }
    return value;
  };

  // Check header
  if (data.byteLength < 14) {
    throw new Error('File too small to be a valid MIDI file.');
  }

  const headerSignature = String.fromCharCode(...readBytes(4));
  if (headerSignature !== 'MThd') {
    throw new Error('Invalid MIDI header signature. Expected "MThd".');
  }

  const headerLength = readUint32();
  if (headerLength < 6) {
    throw new Error(`Invalid header length: ${headerLength}.`);
  }

  const format = readUint16();
  const numTracks = readUint16();
  const division = readUint16();

  if (division & 0x8000) {
    // SMPTE time code - fallback to standard division
    throw new Error('SMPTE timing frames in MIDI are not supported in this version.');
  }

  // Position at start of first track (skipping extra header bytes if any)
  pos = 8 + headerLength;

  let globalBPM = 120;
  let microSecondsPerQuarter = 500000; // default 120 BPM
  
  // Track temp-states
  const allTracksNotes: MIDINote[] = [];
  let songTitle = fileName.replace(/\.[^/.]+$/, ""); // strip extension
  const detectedTrackNames: string[] = [];
  const parsedTracks: ParsedMIDITrack[] = [];

  // Loop through all tracks
  for (let t = 0; t < numTracks; t++) {
    if (pos >= data.byteLength) break;

    const trackSignature = String.fromCharCode(...readBytes(4));
    if (trackSignature !== 'MTrk') {
      // Skip unknown chunks safely
      if (pos + 4 <= data.byteLength) {
        const chunkLen = readUint32();
        pos += chunkLen;
      }
      continue;
    }

    const trackLength = readUint32();
    const trackEndPos = pos + trackLength;

    let tickCounter = 0;
    let runningStatus = 0;
    let currentTrackName = `Track ${t + 1}`;
    const thisTrackNotes: MIDINote[] = [];
    let detectedChannel = 0;

    // Track active notes to match Note-On with Note-Off
    const activeNotes: { [pitch: number]: ActiveNote } = {};

    // For absolute timing conversion
    const tickToMs = (tick: number) => {
      return tick * (microSecondsPerQuarter / division) / 1000;
    };

    while (pos < trackEndPos && pos < data.byteLength) {
      const deltaTime = readVLQ();
      tickCounter += deltaTime;

      let statusByte = readByte();

      if ((statusByte & 0x80) === 0) {
        if (runningStatus === 0) continue;
        statusByte = runningStatus;
        pos--;
      } else {
        if (statusByte < 0xF0) {
          runningStatus = statusByte;
        } else {
          runningStatus = 0;
        }
      }

      const eventType = statusByte & 0xF0;
      const channel = statusByte & 0x0F;
      detectedChannel = channel;

      if (eventType === 0x80) {
        const pitch = readByte();
        const _velocity = readByte();
        const act = activeNotes[pitch];
        if (act) {
          const startTime = tickToMs(act.startTick);
          const endTime = tickToMs(tickCounter);
          const noteObj: MIDINote = {
            note: pitch,
            time: startTime,
            duration: Math.max(20, endTime - startTime),
            velocity: act.velocity,
            channel,
          };
          allTracksNotes.push(noteObj);
          thisTrackNotes.push(noteObj);
          delete activeNotes[pitch];
        }
      } else if (eventType === 0x90) {
        const pitch = readByte();
        const velocity = readByte();

        if (velocity === 0) {
          const act = activeNotes[pitch];
          if (act) {
            const startTime = tickToMs(act.startTick);
            const endTime = tickToMs(tickCounter);
            const noteObj: MIDINote = {
              note: pitch,
              time: startTime,
              duration: Math.max(20, endTime - startTime),
              velocity: act.velocity,
              channel,
            };
            allTracksNotes.push(noteObj);
            thisTrackNotes.push(noteObj);
            delete activeNotes[pitch];
          }
        } else {
          const existing = activeNotes[pitch];
          if (existing) {
            const startTime = tickToMs(existing.startTick);
            const endTime = tickToMs(tickCounter);
            const noteObj: MIDINote = {
              note: pitch,
              time: startTime,
              duration: Math.max(20, endTime - startTime),
              velocity: existing.velocity,
              channel,
            };
            allTracksNotes.push(noteObj);
            thisTrackNotes.push(noteObj);
          }
          activeNotes[pitch] = {
            pitch,
            startTick: tickCounter,
            startTime: tickToMs(tickCounter),
            velocity,
          };
        }
      } else if (eventType === 0xA0 || eventType === 0xB0 || eventType === 0xE0) {
        readByte();
        readByte();
      } else if (eventType === 0xC0 || eventType === 0xD0) {
        readByte();
      } else if (statusByte === 0xFF) {
        const metaType = readByte();
        const metaLength = readVLQ();
        const metaData = readBytes(metaLength);

        if (metaType === 0x51 && metaLength === 3) {
          microSecondsPerQuarter = (metaData[0] << 16) | (metaData[1] << 8) | metaData[2];
          globalBPM = Math.round(60000000 / microSecondsPerQuarter);
        } else if (metaType === 0x03 && metaLength > 0) {
          try {
            const decoder = new TextDecoder('utf-8');
            const decoded = decoder.decode(metaData).trim();
            if (decoded) {
              currentTrackName = decoded;
              if (t === 0) songTitle = decoded;
            }
          } catch (_) {}
        }
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        const sysexLen = readVLQ();
        readBytes(sysexLen);
      }
    }

    detectedTrackNames.push(currentTrackName);

    // Flush any remaining active notes for this track
    Object.keys(activeNotes).forEach((k) => {
      const pitch = parseInt(k, 10);
      const act = activeNotes[pitch];
      if (act) {
        const startTime = tickToMs(act.startTick);
        const endTime = tickToMs(tickCounter);
        const noteObj: MIDINote = {
          note: pitch,
          time: startTime,
          duration: Math.max(50, endTime - startTime),
          velocity: act.velocity,
          channel: detectedChannel,
        };
        allTracksNotes.push(noteObj);
        thisTrackNotes.push(noteObj);
      }
    });

    if (thisTrackNotes.length > 0) {
      thisTrackNotes.sort((a, b) => a.time - b.time);
      parsedTracks.push({
        id: `track-${t + 1}`,
        name: currentTrackName,
        instrument: currentTrackName,
        channel: detectedChannel,
        notes: thisTrackNotes,
      });
    }

    // Enforce positioning inside file
    pos = trackEndPos;
  }

  // Filter out any anomalous pitches or timing, and sort chronologically
  const validNotes = allTracksNotes
    .filter((n) => n.note >= 0 && n.note <= 127 && n.time >= 0 && n.duration > 0)
    .sort((a, b) => a.time - b.time);

  if (validNotes.length === 0) {
    console.warn('[MIDI Parser] Warning: Parsed MIDI file contains 0 active note events.');
  }

  // Calculate final duration of song
  const lastNote = validNotes.length > 0
    ? validNotes.reduce((max, n) => (n.time + n.duration > max.time + max.duration ? n : max), validNotes[0])
    : null;
  const durationMs = lastNote ? lastNote.time + lastNote.duration : 3000;

  return {
    title: songTitle || 'Unnamed Masterpiece',
    composer: 'Imported Score',
    notes: validNotes,
    durationMs,
    bpm: globalBPM,
    numTracks,
    ppq: division,
    trackNames: detectedTrackNames,
    tracks: parsedTracks,
    fileSize: buffer.byteLength,
    format,
  };
}
