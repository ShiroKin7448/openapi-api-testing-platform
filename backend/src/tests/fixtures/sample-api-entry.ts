import 'dotenv/config';
import http from 'http';
import { createSampleApi } from './sample-api';

const port = Number(process.env.SAMPLE_API_PORT ?? 8080);
const server = http.createServer(createSampleApi());
server.listen(port, '127.0.0.1', () => process.stdout.write(`Deterministic sample API listening on http://127.0.0.1:${port}\n`));
const stop = (): void => { server.close(() => process.exit(0)); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
