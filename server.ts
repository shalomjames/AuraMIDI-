import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import { 
  submitMireloJob, 
  getMireloJobStatus, 
  transcribeWithMirelo, 
  getMireloConfig,
  getMireloMidiBuffer,
  getMireloRawResponse,
  getMireloMidiDebug,
  cleanJobId
} from './server/mireloService.js';
import { NormalizedTranscription } from './src/types/transcription.js';
import { createMIDIFileBuffer } from './src/utils/midiEncoder.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Body parsers
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Multer in-memory storage for audio uploads (up to 100MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// 1. Config probe endpoint (NEVER reveals the API key to client)
app.get('/api/transcribe/config', (_req: Request, res: Response) => {
  const config = getMireloConfig();
  res.json({
    hasApiKey: Boolean(config.apiKey && config.apiKey.length > 5),
    provider: 'Mirelo Audio-to-MIDI Pro',
    baseUrl: config.baseUrl,
    model: 'Audio-to-MIDI Pro',
  });
});

// 2. Asynchronous Job Submission Endpoint: Uploads audio & creates Mirelo job, immediately returning jobId
app.post('/api/transcribe/submit', upload.single('audio'), async (req: Request, res: Response) => {
  const file = req.file;

  if (!file) {
    res.status(400).json({
      success: false,
      error: 'No audio file provided in request. Please upload an MP3, WAV, FLAC, or M4A file under field name "audio".',
    });
    return;
  }

  console.log(`[Server:Submit] Received audio upload for "${file.originalname}" (${(file.size / 1024).toFixed(1)} KB)`);

  try {
    const jobResult = await submitMireloJob(
      file.buffer,
      file.originalname,
      file.mimetype || 'audio/wav'
    );

    res.json({
      success: true,
      jobId: jobResult.jobId,
      status: jobResult.status,
      fileName: jobResult.fileName,
      data: jobResult.data || null,
    });
  } catch (err: any) {
    console.error(`[Server:SubmitError]`, err.message);
    const statusCode = err.message.includes('MIRELO_API_KEY') ? 401 : 500;
    res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to submit transcription job',
    });
  }
});

// 3. Asynchronous Job Status Endpoint: Queries existing job, returns progress/status & cached completed result
app.get('/api/transcribe/status/:jobId', async (req: Request, res: Response) => {
  const jobId = cleanJobId(req.params.jobId);
  const fileNameFallback = req.query.fileName as string | undefined;

  if (!jobId) {
    res.status(400).json({ success: false, error: 'Valid jobId parameter is required' });
    return;
  }

  try {
    const statusResult = await getMireloJobStatus(jobId, fileNameFallback);
    res.json({
      success: true,
      jobId: statusResult.jobId || jobId,
      status: statusResult.status,
      progress: statusResult.progress ?? (statusResult.status === 'succeeded' ? 100 : 50),
      message: statusResult.message || '',
      data: statusResult.data || null,
      midiDebug: statusResult.midiDebug || null,
      error: statusResult.error || null,
    });
  } catch (err: any) {
    console.error(`[Server:StatusError] ${jobId}:`, err.message);
    res.status(500).json({
      success: false,
      jobId,
      status: 'failed',
      error: err.message || 'Failed to check job status',
    });
  }
});

// 3b. Serve Raw Binary .MID File Endpoint for exact MIDI player feeding & direct downloading
app.get('/api/transcribe/midi-file/:jobId', async (req: Request, res: Response) => {
  const jobId = cleanJobId(req.params.jobId);
  let buffer = getMireloMidiBuffer(jobId);

  if (!buffer) {
    try {
      await getMireloJobStatus(jobId);
      buffer = getMireloMidiBuffer(jobId);
    } catch (_) {}
  }

  if (!buffer) {
    res.status(404).json({
      success: false,
      error: `MIDI file for job "${jobId}" is not ready or could not be found.`,
    });
    return;
  }

  const isMThd = buffer.length >= 4 && buffer[0] === 0x4D && buffer[1] === 0x54 && buffer[2] === 0x68 && buffer[3] === 0x64;
  if (!isMThd) {
    res.status(400).json({
      success: false,
      error: 'Downloaded artifact is not valid binary MIDI data (header mismatch).',
      httpStatus: 200,
      contentType: 'non-midi',
      contentLength: buffer.length,
      first16BytesHex: buffer.subarray(0, Math.min(16, buffer.length)).toString('hex'),
      first100CharsText: buffer.toString('utf-8', 0, Math.min(100, buffer.length)),
    });
    return;
  }

  res.setHeader('Content-Type', 'audio/midi');
  res.setHeader('Content-Disposition', `attachment; filename="mirelo-test.mid"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

// 3b2. Dedicated Binary MIDI Download Endpoint
app.get('/api/transcribe/download-midi', async (req: Request, res: Response) => {
  const jobId = cleanJobId(req.query.jobId as string);

  if (!jobId) {
    res.status(400).json({ success: false, error: 'jobId query parameter is required' });
    return;
  }

  let buffer = getMireloMidiBuffer(jobId);

  if (!buffer) {
    try {
      await getMireloJobStatus(jobId);
      buffer = getMireloMidiBuffer(jobId);
    } catch (_) {}
  }

  if (!buffer) {
    res.status(404).json({
      success: false,
      error: `MIDI file for job "${jobId}" is not ready or could not be found.`,
    });
    return;
  }

  const isMThd = buffer.length >= 4 && buffer[0] === 0x4D && buffer[1] === 0x54 && buffer[2] === 0x68 && buffer[3] === 0x64;
  if (!isMThd) {
    res.status(400).json({
      success: false,
      error: 'Downloaded artifact does not begin with expected MThd signature.',
      httpStatus: 200,
      contentType: 'non-midi',
      contentLength: buffer.length,
      first16BytesHex: buffer.subarray(0, Math.min(16, buffer.length)).toString('hex'),
      first100CharsText: buffer.toString('utf-8', 0, Math.min(100, buffer.length)),
    });
    return;
  }

  res.setHeader('Content-Type', 'audio/midi');
  res.setHeader('Content-Disposition', 'attachment; filename="mirelo-test.mid"');
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

// 3c. Raw Mirelo Response Inspection Endpoint
app.get('/api/transcribe/raw-response/:jobId', (req: Request, res: Response) => {
  const jobId = cleanJobId(req.params.jobId);
  const rawData = getMireloRawResponse(jobId);

  if (!rawData) {
    res.status(404).json({ success: false, error: `Raw response for job ${jobId} not found.` });
    return;
  }

  res.json({ success: true, jobId, raw: rawData });
});

// 3d. Mirelo MIDI Debug Diagnostics Endpoint
app.get('/api/transcribe/debug/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const debug = getMireloMidiDebug(jobId);

  if (!debug) {
    res.status(404).json({ success: false, error: `Debug info for job ${jobId} not found.` });
    return;
  }

  res.json({ success: true, debug });
});

// 4. Backward-compatible /api/transcribe endpoint
app.post('/api/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  const file = req.file;

  if (!file) {
    res.status(400).json({
      success: false,
      error: 'No audio file provided in request. Please upload an MP3, WAV, FLAC, or M4A file under field name "audio".',
    });
    return;
  }

  console.log(`[Server] Received transcription POST for "${file.originalname}" (${(file.size / 1024).toFixed(1)} KB)`);

  try {
    const submitResult = await submitMireloJob(
      file.buffer,
      file.originalname,
      file.mimetype || 'audio/wav'
    );

    res.json({
      success: true,
      jobId: submitResult.jobId,
      status: submitResult.status,
      fileName: submitResult.fileName,
      data: submitResult.data || null,
    });
  } catch (err: any) {
    console.error(`[Server:TranscribeError]`, err.message);
    const statusCode = err.message.includes('MIRELO_API_KEY') ? 401 : 500;
    res.status(statusCode).json({
      success: false,
      error: err.message || 'Transcription failed',
    });
  }
});

// 3. Development / Testing Sample Endpoint
// Allows instant end-to-end testing of falling notes, chord display, and track selector
app.post('/api/transcribe/sample', (_req: Request, res: Response) => {
  console.log('[Server] Generating sample multi-track piano arpeggio with chords...');

  const sampleNotes = [
    // Chord 1: C Major (0.0s - 2.0s)
    { note: 48, time: 100, duration: 1800, velocity: 85, trackName: 'Acoustic Piano', instrument: 'Piano' }, // C3
    { note: 60, time: 200, duration: 1600, velocity: 80, trackName: 'Acoustic Piano', instrument: 'Piano' }, // C4
    { note: 64, time: 500, duration: 1300, velocity: 78, trackName: 'Acoustic Piano', instrument: 'Piano' }, // E4
    { note: 67, time: 800, duration: 1000, velocity: 82, trackName: 'Acoustic Piano', instrument: 'Piano' }, // G4
    { note: 72, time: 1100, duration: 800, velocity: 88, trackName: 'Acoustic Piano', instrument: 'Piano' }, // C5
    { note: 36, time: 100, duration: 1800, velocity: 90, trackName: 'Acoustic Bass', instrument: 'Bass' },   // C2 Bass

    // Chord 2: A Minor (2.0s - 4.0s)
    { note: 45, time: 2100, duration: 1800, velocity: 85, trackName: 'Acoustic Piano', instrument: 'Piano' }, // A2
    { note: 57, time: 2200, duration: 1600, velocity: 80, trackName: 'Acoustic Piano', instrument: 'Piano' }, // A3
    { note: 60, time: 2500, duration: 1300, velocity: 76, trackName: 'Acoustic Piano', instrument: 'Piano' }, // C4
    { note: 64, time: 2800, duration: 1000, velocity: 80, trackName: 'Acoustic Piano', instrument: 'Piano' }, // E4
    { note: 69, time: 3100, duration: 800, velocity: 85, trackName: 'Acoustic Piano', instrument: 'Piano' }, // A4
    { note: 33, time: 2100, duration: 1800, velocity: 90, trackName: 'Acoustic Bass', instrument: 'Bass' },   // A1 Bass

    // Chord 3: F Major (4.0s - 6.0s)
    { note: 41, time: 4100, duration: 1800, velocity: 85, trackName: 'Acoustic Piano', instrument: 'Piano' }, // F2
    { note: 53, time: 4200, duration: 1600, velocity: 82, trackName: 'Acoustic Piano', instrument: 'Piano' }, // F3
    { note: 57, time: 4500, duration: 1300, velocity: 78, trackName: 'Acoustic Piano', instrument: 'Piano' }, // A3
    { note: 60, time: 4800, duration: 1000, velocity: 80, trackName: 'Acoustic Piano', instrument: 'Piano' }, // C4
    { note: 65, time: 5100, duration: 800, velocity: 86, trackName: 'Acoustic Piano', instrument: 'Piano' }, // F4
    { note: 29, time: 4100, duration: 1800, velocity: 90, trackName: 'Acoustic Bass', instrument: 'Bass' },   // F1 Bass

    // Chord 4: G Major (6.0s - 8.0s)
    { note: 43, time: 6100, duration: 1800, velocity: 88, trackName: 'Acoustic Piano', instrument: 'Piano' }, // G2
    { note: 55, time: 6200, duration: 1600, velocity: 84, trackName: 'Acoustic Piano', instrument: 'Piano' }, // G3
    { note: 59, time: 6500, duration: 1300, velocity: 80, trackName: 'Acoustic Piano', instrument: 'Piano' }, // B3
    { note: 62, time: 6800, duration: 1000, velocity: 82, trackName: 'Acoustic Piano', instrument: 'Piano' }, // D4
    { note: 67, time: 7100, duration: 800, velocity: 90, trackName: 'Acoustic Piano', instrument: 'Piano' }, // G4
    { note: 31, time: 6100, duration: 1800, velocity: 92, trackName: 'Acoustic Bass', instrument: 'Bass' },   // G1 Bass
  ];

  const pianoNotes = sampleNotes.filter(n => n.instrument === 'Piano');
  const bassNotes = sampleNotes.filter(n => n.instrument === 'Bass');

  const sampleResult: NormalizedTranscription = {
    id: `sample-mirelo-${Date.now()}`,
    source: 'sample',
    title: 'Mirelo Sample Arpeggio (Piano & Bass)',
    durationMs: 8500,
    key: 'C Major',
    tempo: 120,
    timeSignature: '4/4',
    instruments: ['Acoustic Piano', 'Acoustic Bass'],
    tracks: [
      {
        id: 'track-piano',
        name: 'Acoustic Piano',
        instrument: 'Piano',
        isPercussion: false,
        notes: pianoNotes,
      },
      {
        id: 'track-bass',
        name: 'Acoustic Bass',
        instrument: 'Bass',
        isPercussion: false,
        notes: bassNotes,
      }
    ],
    notes: sampleNotes,
    chords: [
      { chord: 'C Major', time: 100, duration: 1900 },
      { chord: 'A Minor', time: 2100, duration: 1900 },
      { chord: 'F Major', time: 4100, duration: 1900 },
      { chord: 'G Major', time: 6100, duration: 2000 },
    ],
    transcriptionTimeMs: 420,
    metadata: {
      model: 'Mirelo Audio-to-MIDI Pro (Test Mode)',
      notesCount: sampleNotes.length,
      chordsCount: 4,
    }
  };

  res.json({
    success: true,
    data: sampleResult,
  });
});

// Explicit 404 JSON handler for /api/* to ensure API calls never fall through to HTML SPA router
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
  });
});

// Vite middleware for Dev vs Static for Production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AuraMIDI] Server running on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[AuraMIDI] Failed to start server:', err);
});
