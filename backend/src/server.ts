import 'dotenv/config';
import app from './app';
import { queueEventsService } from './services/queue-events.service';
import { scheduleRunnerService } from './services/schedule-runner.service';
import { WorkerService } from './services/worker.service';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(JSON.stringify({ event: 'api.server.started', port: PORT }));
  void queueEventsService.start().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(JSON.stringify({ event: 'queue.events.start_failed', errorName }));
  });
  scheduleRunnerService.start();

  try {
    new WorkerService();
    console.log(JSON.stringify({ event: 'embedded.worker.started' }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Embedded Worker] BullMQ worker not started (will use in-process fallback):', msg);
  }
});
