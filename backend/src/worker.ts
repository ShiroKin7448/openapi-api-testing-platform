import 'dotenv/config';
import { WorkerService } from './services/worker.service';

const worker = new WorkerService();
const stop = (): void => {
  void worker.close().finally(() => process.exit(0));
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
