import 'dotenv/config';
import app from './app';
import { queueEventsService } from './services/queue-events.service';
import { scheduleRunnerService } from './services/schedule-runner.service';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(JSON.stringify({ event: 'api.server.started', port: PORT }));
  void queueEventsService.start().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(JSON.stringify({ event: 'queue.events.start_failed', errorName }));
  });
  scheduleRunnerService.start();
});
