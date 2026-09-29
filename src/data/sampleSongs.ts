export interface MIDINote {
  note: number;      // MIDI pitch number (e.g., 60 = C4)
  time: number;      // Start time in milliseconds
  duration: number;  // Duration in milliseconds
  velocity: number;  // Note volume/velocity (0-127)
  channel?: number;  // MIDI channel
}

export interface SongChord {
  chord: string;
  time: number;
  duration: number;
}

export interface SongTrack {
  id: string;
  name: string;
  instrument: string;
  notes: MIDINote[];
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  genre: string;
  durationMs: number;
  notes: MIDINote[];
  bpm: number;
  chords?: SongChord[];
  key?: string;
  tracks?: SongTrack[];
  audioUrl?: string; // Authoritative original audio recording source URL
  rawMidiUrl?: string; // Original .mid file URL
}

// Generate Bach's Prelude in C Major (BWV 846)
// A continuous, beautiful 32-bar arpeggio pattern that looks incredibly satisfying on a falling notes interface.
function generateBachPrelude(): MIDINote[] {
  const notes: MIDINote[] = [];
  const bpm = 80;
  const crotchet = 60000 / bpm; // duration of quarter note in ms (750ms)
  const semiquaver = crotchet / 4; // 16th note in ms (187.5ms)

  // Standard harmonic progressions for Bach's Prelude in C Major
  const chords: number[][] = [
    // [Bass1, Bass2, Tenor, Alto, Soprano]
    [48, 52, 55, 60, 64], // Bar 1: C major
    [48, 50, 57, 59, 62], // Bar 2: D minor 7 / C
    [47, 50, 55, 59, 62], // Bar 3: G7 / B
    [48, 52, 55, 60, 64], // Bar 4: C major
    [48, 52, 57, 60, 65], // Bar 5: A minor / C
    [46, 50, 57, 58, 62], // Bar 6: D7 / Bb
    [45, 48, 57, 59, 62], // Bar 7: G7 / A
    [43, 47, 55, 57, 60], // Bar 8: C major 7 / G
    [43, 45, 53, 57, 60], // Bar 9: D minor 7 / G
    [43, 47, 55, 59, 62], // Bar 10: G7
    [48, 52, 55, 60, 64], // Bar 11: C major
    [48, 52, 54, 57, 63], // Bar 12: F# diminished / C
    [47, 50, 53, 56, 62], // Bar 13: G diminished / B
    [45, 48, 53, 57, 60], // Bar 14: F major / A
    [43, 45, 51, 57, 60], // Bar 15: D7 / G
    [43, 47, 55, 59, 62], // Bar 16: G7
    [44, 47, 53, 56, 59], // Bar 17: Ab diminished / B
    [45, 48, 52, 57, 60], // Bar 18: A minor / C
    [44, 47, 50, 53, 59], // Bar 19: B diminished / Ab
    [45, 48, 52, 57, 60], // Bar 20: A minor / C
    [41, 45, 48, 53, 57], // Bar 21: F major
    [39, 45, 47, 50, 56], // Bar 22: F# dim 7 / D#
    [38, 41, 47, 50, 53], // Bar 23: G minor / D
    [36, 41, 43, 47, 53], // Bar 24: G7 / C
    [36, 40, 43, 48, 52], // Bar 25: C major (reprise)
  ];

  let timeOffset = 0;

  chords.forEach((chord) => {
    // Bach plays the arpeggio pattern: 
    // [Bass1, Bass2, Tenor, Alto, Soprano, Tenor, Alto, Soprano]
    // repeated twice per bar
    for (let loop = 0; loop < 2; loop++) {
      const pattern = [0, 1, 2, 3, 4, 2, 3, 4];
      pattern.forEach((idx, step) => {
        const pitch = chord[idx];
        const noteStart = timeOffset + step * semiquaver;
        const noteDuration = semiquaver * 1.8; // slightly overlapping for piano legatissimo
        notes.push({
          note: pitch,
          time: noteStart,
          duration: noteDuration,
          velocity: idx < 2 ? 85 : 100, // emphasize melody slightly
        });
      });
      timeOffset += 8 * semiquaver;
    }
  });

  // Final cadential bars: C major chord sustained
  const finalChords = [
    [36, 48, 52, 55, 60],
  ];

  finalChords.forEach((chord) => {
    chord.forEach((pitch, idx) => {
      notes.push({
        note: pitch,
        time: timeOffset,
        duration: semiquaver * 16, // hold for a full bar
        velocity: 90,
      });
    });
    timeOffset += 16 * semiquaver;
  });

  return notes;
}

// Generate Beethoven's Für Elise
// Classic beautiful A-minor melody that shifts between hands.
function generateFurElise(): MIDINote[] {
  const notes: MIDINote[] = [];
  const bpm = 120;
  const eighthNote = 60000 / bpm / 2; // duration of an 8th note (250ms)

  // Sequence of notes in pairs of (midiNote, durationInEighths)
  const rightHandMelody: [number, number][] = [
    // Phrase 1
    [76, 1], [75, 1], [76, 1], [75, 1], [76, 1], [71, 1], [74, 1], [72, 1], [69, 3], 
    [0, 1], // Rest
    [60, 1], [64, 1], [69, 1], [71, 3],
    [0, 1], // Rest
    [64, 1], [68, 1], [71, 1], [72, 3],
    [0, 1], // Rest
    [64, 1], [76, 1], [75, 1], [76, 1], [75, 1], [76, 1], [71, 1], [74, 1], [72, 1], [69, 3],
    [0, 1], // Rest
    [60, 1], [64, 1], [69, 1], [71, 3],
    [0, 1], // Rest
    [64, 1], [72, 1], [71, 1], [69, 4],

    // Phrase 2 (The B section start)
    [71, 1], [72, 1], [74, 1], [76, 3],
    [0, 1],
    [67, 1], [79, 1], [77, 1], [76, 3],
    [0, 1],
    [65, 1], [76, 1], [74, 1], [72, 3],
    [0, 1],
    [64, 1], [74, 1], [72, 1], [71, 3],
  ];

  // Accompanying left hand notes (note, startInEighths, durationInEighths)
  const leftHandAccompaniment: [number, number, number][] = [
    [45, 8, 3], [52, 9, 2], [57, 10, 1], // Am
    [40, 14, 3], [47, 15, 2], [56, 16, 1], // E
    [45, 20, 3], [52, 21, 2], [57, 22, 1], // Am
    [45, 33, 3], [52, 34, 2], [57, 35, 1], // Am
    [40, 39, 3], [47, 40, 2], [56, 41, 1], // E
    [45, 45, 4], [52, 46, 3], [57, 47, 2], // Am Sustain
    
    // B Section accompaniment
    [43, 51, 3], [47, 52, 2], [55, 53, 1], // G
    [48, 56, 3], [52, 57, 2], [60, 58, 1], // C
    [41, 61, 3], [45, 62, 2], [53, 63, 1], // F
    [40, 66, 3], [47, 67, 2], [56, 68, 1], // E
  ];

  let timeOffset = 0;
  rightHandMelody.forEach(([pitch, eighths]) => {
    if (pitch > 0) {
      notes.push({
        note: pitch,
        time: timeOffset,
        duration: eighths * eighthNote * 0.9,
        velocity: 95,
      });
    }
    timeOffset += eighths * eighthNote;
  });

  // Merge left hand
  leftHandAccompaniment.forEach(([pitch, startEighths, durationEighths]) => {
    notes.push({
      note: pitch,
      time: startEighths * eighthNote,
      duration: durationEighths * eighthNote * 0.95,
      velocity: 75, // quieter accompaniment
    });
  });

  // Sort notes by start time
  return notes.sort((a, b) => a.time - b.time);
}

// Generate Mozart's Rondo Alla Turca
// High-tempo, exciting, structured piece with fast notes.
function generateAllaTurca(): MIDINote[] {
  const notes: MIDINote[] = [];
  const bpm = 130;
  const sixteenth = 60000 / bpm / 4; // semiquaver duration (115.38ms)

  // We can model a highly recognizable section (the main repeating theme in A minor)
  const rightHand: [number, number][] = [
    // Theme pickup
    [71, 1], [69, 1], [68, 1], [69, 1],
    // Bar 1
    [72, 4], [0, 1], [74, 1], [72, 1], [71, 1], [72, 1],
    // Bar 2
    [76, 4], [0, 1], [77, 1], [76, 1], [74, 1], [76, 1],
    // Bar 3
    [79, 2], [77, 2], [76, 2], [74, 2],
    // Bar 4
    [72, 4], [74, 1], [72, 1], [71, 1], [72, 1],
    // Bar 5
    [74, 4], [0, 1], [71, 1], [69, 1], [68, 1], [69, 1],
    // Bar 6
    [72, 4], [0, 1], [74, 1], [72, 1], [71, 1], [72, 1],
    // Bar 7
    [76, 4], [0, 1], [77, 1], [76, 1], [74, 1], [76, 1],
    // Bar 8
    [79, 2], [77, 2], [76, 2], [74, 2],
    // Bar 9 (Resolution)
    [72, 8],
  ];

  const leftHandChords: [number[], number, number][] = [
    // [Pitches], startSixteenths, durationSixteenths
    [[45, 52, 57], 4, 4], // Am
    [[45, 52, 57], 8, 4], // Am
    [[40, 47, 56], 12, 4], // E
    [[40, 47, 56], 16, 4], // E
    [[45, 52, 57], 20, 2], // Am
    [[40, 47, 56], 22, 2], // E
    [[45, 52, 57], 24, 4], // Am
    
    [[43, 47, 55], 32, 4], // G
    [[48, 52, 60], 36, 4], // C
    [[41, 45, 53], 40, 4], // F
    [[40, 47, 56], 44, 4], // E
  ];

  let timeOffset = 0;
  rightHand.forEach(([pitch, length]) => {
    if (pitch > 0) {
      notes.push({
        note: pitch,
        time: timeOffset,
        duration: length * sixteenth * 0.9,
        velocity: 100,
      });
    }
    timeOffset += length * sixteenth;
  });

  leftHandChords.forEach(([pitches, startStep, durationSteps]) => {
    pitches.forEach((pitch) => {
      notes.push({
        note: pitch,
        time: startStep * sixteenth,
        duration: durationSteps * sixteenth * 0.95,
        velocity: 80,
      });
    });
  });

  return notes.sort((a, b) => a.time - b.time);
}

// Generate an Audio-to-MIDI Transcribed Jazz Improvisation
// Used when they simulate transcribing an audio file in Phase 2
export function generateTranscribedJazz(): MIDINote[] {
  const notes: MIDINote[] = [];
  const bpm = 110;
  const swingEighth = 60000 / bpm / 2; // ~272ms

  // Generate a syncopated jazz piano solo
  const melody = [
    // Bar 1 (C7 / Gm7)
    { note: 60, start: 0, dur: 1.2, vel: 90 }, // C4
    { note: 64, start: 1, dur: 0.8, vel: 95 }, // E4
    { note: 67, start: 1.8, dur: 0.9, vel: 100 }, // G4
    { note: 70, start: 2.6, dur: 1.4, vel: 110 }, // Bb4 (Jazz blue note!)
    // Bar 2
    { note: 72, start: 4, dur: 1.0, vel: 98 }, // C5
    { note: 74, start: 5, dur: 0.7, vel: 88 }, // D5
    { note: 75, start: 5.6, dur: 0.7, vel: 105 }, // Eb5 (Blue Note)
    { note: 76, start: 6.2, dur: 1.5, vel: 115 }, // E5
    // Bar 3 (F9)
    { note: 65, start: 8, dur: 1.1, vel: 90 }, // F4
    { note: 69, start: 9, dur: 0.9, vel: 102 }, // A4
    { note: 72, start: 9.8, dur: 0.8, vel: 95 }, // C5
    { note: 75, start: 10.6, dur: 1.2, vel: 110 }, // Eb5
    // Bar 4 (G7alt to Cmaj9)
    { note: 74, start: 12, dur: 0.8, vel: 105 }, // D5
    { note: 73, start: 12.8, dur: 0.8, vel: 100 }, // Db5
    { note: 71, start: 13.6, dur: 1.2, vel: 95 }, // B4
    { note: 60, start: 14.8, dur: 2.5, vel: 120 }, // C4 resolution
  ];

  const chords = [
    // Left-hand sparse, block chords (typical of transcribed jazz)
    { pitches: [48, 55, 58, 62], start: 0, dur: 3 }, // C7sus4
    { pitches: [48, 52, 58, 64], start: 3.5, dur: 2.5 }, // C7
    { pitches: [41, 53, 57, 60, 63], start: 8, dur: 3.5 }, // F9
    { pitches: [43, 53, 56, 59, 62], start: 12, dur: 2 }, // G7alt
    { pitches: [36, 48, 52, 55, 59], start: 14.5, dur: 3.5 }, // Cmaj7
  ];

  melody.forEach((m) => {
    notes.push({
      note: m.note,
      time: Math.round(m.start * swingEighth * 10) / 10,
      duration: Math.round(m.dur * swingEighth * 10) / 10,
      velocity: m.vel,
    });
  });

  chords.forEach((c) => {
    c.pitches.forEach((pitch) => {
      notes.push({
        note: pitch,
        time: Math.round(c.start * swingEighth * 10) / 10,
        duration: Math.round(c.dur * swingEighth * 10) / 10,
        velocity: 80, // slightly quieter for background chords
      });
    });
  });

  return notes.sort((a, b) => a.time - b.time);
}

// Build list of official premium pre-loaded songs
export const SAMPLE_SONGS: Song[] = [
  {
    id: 'bach-prelude',
    title: 'Prelude in C Major (BWV 846)',
    composer: 'Johann Sebastian Bach',
    difficulty: 'Intermediate',
    genre: 'Classical',
    bpm: 80,
    durationMs: 25 * 8 * (60000 / 80 / 4) * 2 + 16 * (60000 / 80 / 4), // 25 bars + final sustained bar
    notes: generateBachPrelude(),
  },
  {
    id: 'fur-elise',
    title: 'Für Elise (Theme)',
    composer: 'Ludwig van Beethoven',
    difficulty: 'Intermediate',
    genre: 'Classical',
    bpm: 120,
    durationMs: 71 * (60000 / 120 / 2), // ~17.7 seconds
    notes: generateFurElise(),
  },
  {
    id: 'alla-turca',
    title: 'Rondo Alla Turca (Theme)',
    composer: 'Wolfgang Amadeus Mozart',
    difficulty: 'Advanced',
    genre: 'Classical',
    bpm: 130,
    durationMs: 75 * (60000 / 130 / 4), // ~8.6 seconds
    notes: generateAllaTurca(),
  },
];
