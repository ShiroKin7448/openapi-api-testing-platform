import http from 'http';
import { AddressInfo } from 'net';
import app from '../app';

describe('request correlation logging', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('returns a correlation ID and omits credentials and request data from structured logs', async () => {
    const write = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const response = await fetch(`${baseUrl}/health?apiToken=must-not-log`, {
      headers: { 'X-Request-ID': '9c2e15aa-4a15-47a4-bf54-35d02aee70af', Authorization: 'Bearer secret-jwt-must-not-log' },
    });
    expect(response.headers.get('x-request-id')).toBe('9c2e15aa-4a15-47a4-bf54-35d02aee70af');
    expect(response.status).toBe(200);
    const entries = write.mock.calls.map(([line]) => String(line));
    expect(entries.some((line) => line.includes('http.request.complete'))).toBe(true);
    expect(entries.join('\n')).not.toContain('secret-jwt-must-not-log');
    expect(entries.join('\n')).not.toContain('must-not-log');
    write.mockRestore();
  });

  it('returns a controlled JSON error for malformed bodies and unmatched API routes', async () => {
    const malformed = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":',
    });
    expect(malformed.status).toBe(400);
    const malformedBody = await malformed.json() as { success: boolean; error: { code: string; message: string } };
    expect(malformedBody).toMatchObject({ success: false, error: { code: 'INVALID_JSON', message: 'The JSON request body is invalid' } });
    expect(JSON.stringify(malformedBody)).not.toContain('SyntaxError');

    const missing = await fetch(`${baseUrl}/api/not-a-route`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});
