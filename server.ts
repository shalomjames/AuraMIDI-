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
import { requireUser } from './server/auth.js';
import {
  getAudioSeconds,
  costForSeconds,
  startJob,
  attachMireloJob,
  failJob,
  completeJob,
  getOwnedJob,
  sweepStaleJobs,
} from './server/jobs.js';

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
app.post('/api/transcribe/submit', requireUser, upload.single('audio'), async (req: Request, res: Response) => {
  const file = req.file;

  if (!file) {
    res.status(400).json({
      success: false,
      error: 'No audio file provided in request. Please upload an MP3, WAV, FLAC, or M4A file under field name "audio".',
    });
    return;
  }

  const userId = res.locals.user.id;

  // 1. Audio duration check
  let seconds: number;
  try {
    seconds = await getAudioSeconds(file.buffer, file.mimetype);
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || "We couldn't read the length of this audio.",
    });
    return;
  }

  // 2. Start persistent job and reserve credits
  let started;
  try {
    started = await startJob({
      userId,
      sourceName: file.originalname,
      seconds,
    });
  } catch (_err: any) {
    res.status(503).json({
      success: false,
      error: "We couldn't start your transcription. You have not been charged.",
    });
    return;
  }

  // 3. Verify sufficient credits
  if (!started.ok) {
    res.status(402).json({
      success: false,
      code: "insufficient_credits",
      error: `This song needs ${costForSeconds(seconds)} credits and you don't have enough.`,
    });
    return;
  }

  console.log(`[Server:Submit] Received audio upload for "${file.originalname}" (${(file.size / 1024).toFixed(1)} KB, ${seconds.toFixed(1)}s, ${started.cost} credits)`);

  // 4 & 5. Submit to Mirelo upstream and attach job
  try {
    const jobResult = await submitMireloJob(
      file.buffer,
      file.originalname,
      file.mimetype || 'audio/wav'
    );

    await attachMireloJob(started.jobId, jobResult.jobId);

    // If jobResult.status === 'succeeded' (Mirelo returned a cached result)
    if (jobResult.status === 'succeeded') {
      const buffer = getMireloMidiBuffer(jobResult.jobId);
      const row = await getOwnedJob(userId, jobResult.jobId);
      if (buffer && row) {
        try {
          await completeJob(row, buffer);
        } catch (_compErr: any) {
          res.json({
            success: true,
            jobId: jobResult.jobId,
            status: 'processing',
            fileName: jobResult.fileName,
            data: null,
          });
          return;
        }
      }
    }

    res.json({
      success: true,
      jobId: jobResult.jobId,
      status: jobResult.status,
      fileName: jobResult.fileName,
      data: jobResult.data || null,
    });
  } catch (err: any) {
    try {
      await failJob(started.jobId, userId, 'Transcription could not be started.');
    } catch {}
    console.error(`[Server:SubmitError] Failed to submit/attach Mirelo job for user ${userId}:`, err?.message);
    res.status(500).json({
      success: false,
      error: "We couldn't start your transcription. You have not been charged.",
    });
  }
});

// 3. Asynchronous Job Status Endpoint: Queries existing job, returns progress/status & cached completed result
app.get('/api/transcribe/status/:jobId', requireUser, async (req: Request, res: Response) => {
  const jobId = cleanJobId(req.params.jobId);
  const fileNameFallback = req.query.fileName as string | undefined;

  if (!jobId) {
    res.status(400).json({ success: false, error: 'Valid jobId parameter is required' });
    return;
  }

  const userId = res.locals.user.id;
  const job = await getOwnedJob(userId, jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Transcription not found.' });
    return;
  }

  if (job.status === 'failed') {
    res.status(200).json({
      success: true,
      jobId,
      status: 'failed',
      progress: 0,
      message: '',
      data: null,
      midiDebug: null,
      error: "This transcription couldn't be completed. You won't be charged.",
    });
    return;
  }

  try {
    const statusResult = await getMireloJobStatus(jobId, fileNameFallback);

    if (statusResult.status === 'failed') {
      try {
        await failJob(job.id, userId, 'Transcription failed.');
      } catch (fErr: any) {
        console.error(`[Server:Status] failJob error for ${job.id}:`, fErr?.message);
      }
      res.json({
        success: true,
        jobId: statusResult.jobId || jobId,
        status: 'failed',
        progress: 0,
        message: statusResult.message || '',
        data: null,
        midiDebug: statusResult.midiDebug || null,
        error: "We couldn't transcribe this audio. You won't be charged.",
      });
      return;
    }

    if (statusResult.status === 'succeeded' && job.status !== 'succeeded') {
      const buffer = getMireloMidiBuffer(jobId);
      if (!buffer) {
        res.json({
          success: true,
          jobId: statusResult.jobId || jobId,
          status: 'processing',
          progress: 95,
          message: 'Finishing up...',
          data: null,
          midiDebug: statusResult.midiDebug || null,
          error: null,
        });
        return;
      }

      try {
        await completeJob(job, buffer);
      } catch (cErr: any) {
        console.error(`[Server:Status] completeJob error for ${job.id}:`, cErr?.message);
        res.json({
          success: true,
          jobId: statusResult.jobId || jobId,
          status: 'processing',
          progress: 95,
          message: 'Saving your MIDI...',
          data: null,
          midiDebug: statusResult.midiDebug || null,
          error: null,
        });
        return;
      }

      const updatedJob = await getOwnedJob(userId, jobId);
      if (updatedJob?.status === 'failed') {
        res.json({
          success: true,
          jobId: statusResult.jobId || jobId,
          status: 'failed',
          progress: 0,
          message: '',
          data: null,
          midiDebug: statusResult.midiDebug || null,
          error: "No notes could be found in this audio. You won't be charged.",
        });
        return;
      }

      if (updatedJob?.status === 'succeeded') {
        res.json({
          success: true,
          jobId: statusResult.jobId || jobId,
          status: 'succeeded',
          progress: 100,
          message: statusResult.message || '',
          data: statusResult.data || null,
          midiDebug: statusResult.midiDebug || null,
          error: null,
        });
        return;
      }
    }

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
    console.error(`[Server:StatusError] ${jobId}:`, err?.message);
    res.status(500).json({
      success: false,
      jobId,
      status: 'failed',
      error: "We couldn't check this transcription right now.",
    });
  }
});

// 3b. Serve Raw Binary .MID File Endpoint for exact MIDI player feeding & direct downloading
app.get('/api/transcribe/midi-file/:jobId', requireUser, async (req: Request, res: Response) => {
  const jobId = cleanJobId(req.params.jobId);
  if (!jobId) {
    res.status(400).json({ success: false, error: 'Valid jobId parameter is required' });
    return;
  }

  const userId = res.locals.user.id;
  const job = await getOwnedJob(userId, jobId);
  if (!job || job.status !== 'succeeded') {
    res.status(404).json({ success: false, error: 'Transcription not found.' });
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
app.get('/api/transcribe/download-midi', requireUser, async (req: Request, res: Response) => {
  const jobId = cleanJobId(req.query.jobId as string);

  if (!jobId) {
    res.status(400).json({ success: false, error: 'jobId query parameter is required' });
    return;
  }

  const userId = res.locals.user.id;
  const job = await getOwnedJob(userId, jobId);
  if (!job || job.status !== 'succeeded') {
    res.status(404).json({ success: false, error: 'Transcription not found.' });
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
  if (process.env.ENABLE_DEBUG_ROUTES !== 'true') {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
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
  if (process.env.ENABLE_DEBUG_ROUTES !== 'true') {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  const { jobId } = req.params;
  const debug = getMireloMidiDebug(jobId);

  if (!debug) {
    res.status(404).json({ success: false, error: `Debug info for job ${jobId} not found.` });
    return;
  }

  res.json({ success: true, debug });
});

// 4. Backward-compatible /api/transcribe endpoint
app.post('/api/transcribe', requireUser, upload.single('audio'), async (_req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: 'This endpoint is no longer available.',
  });
});

// 3. Development / Testing Sample Endpoint
// Allows instant end-to-end testing of falling notes, chord display, and track selector
app.post('/api/transcribe/sample', requireUser, (_req: Request, res: Response) => {
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

    // Initial sweep for stale jobs
    (async () => {
      try {
        await sweepStaleJobs();
      } catch (err: any) {
        console.error('[Server:Sweep] Initial sweep error:', err?.message);
      }
    })();

    // Sweep every 10 minutes
    const sweepInterval = setInterval(async () => {
      try {
        await sweepStaleJobs();
      } catch (err: any) {
        console.error('[Server:Sweep] Recurring sweep error:', err?.message);
      }
    }, 10 * 60 * 1000);

    if (typeof sweepInterval.unref === 'function') {
      sweepInterval.unref();
    }
  });
}

startServer().catch((err) => {
  console.error('[AuraMIDI] Failed to start server:', err);
});
