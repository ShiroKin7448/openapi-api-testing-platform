import 'dotenv/config';
import http from 'http';
import app from './app';
import { queueEventsService } from './services/queue-events.service';
import { scheduleRunnerService } from './services/schedule-runner.service';
import { maintenanceService } from './services/maintenance.service';
import { WorkerService } from './services/worker.service';
import { createSampleApi } from './tests/fixtures/sample-api';

const PORT = process.env.PORT || 3000;
const SAMPLE_PORT = Number(process.env.SAMPLE_API_PORT || 8080);

app.listen(PORT, () => {
  console.log(JSON.stringify({ event: 'api.server.started', port: PORT }));
  void queueEventsService.start().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(JSON.stringify({ event: 'queue.events.start_failed', errorName }));
  });
  scheduleRunnerService.start();
  maintenanceService.start();

  try {
    new WorkerService();
    console.log(JSON.stringify({ event: 'embedded.worker.started' }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Embedded Worker] BullMQ worker not started (will use in-process fallback):', msg);
  }

  // Automatically start sample fixture API on port 8080 so testing environments work out-of-the-box
  try {
    const sampleServer = http.createServer(createSampleApi());
    sampleServer.listen(SAMPLE_PORT, '127.0.0.1', () => {
      console.log(JSON.stringify({ event: 'sample.api.started', port: SAMPLE_PORT }));
    });
    sampleServer.on('error', (err: any) => {
      if (err.code !== 'EADDRINUSE') {
        console.warn('[Sample API] Failed to start:', err.message);
      }
    });
  } catch (err: unknown) {
    console.warn('[Sample API] Unable to start sample fixture API:', err);
  }
});
