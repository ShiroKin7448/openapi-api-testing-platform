import { startSampleApi } from './fixtures/sample-api';
import { Server } from 'http';

describe('deterministic sample API fixture', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startSampleApi();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('covers login, CRUD, validation, contract violation, malformed and delayed responses', async () => {
    const login = await fetch(`${baseUrl}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tester@example.test', password: 'fixture-password' }) });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ accessToken: 'fixture-access-token' });

    const invalid = await fetch(`${baseUrl}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bad-email' }) });
    expect(invalid.status).toBe(400);
    const created = await fetch(`${baseUrl}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'e2e@example.test', displayName: 'Created' }) });
    expect(created.status).toBe(201);
    const user = await created.json() as { id: string; displayName: string };
    expect((await fetch(`${baseUrl}/users/${user.id}`)).status).toBe(200);

    const updated = await fetch(`${baseUrl}/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Updated' }) });
    expect(await updated.json()).toMatchObject({ displayName: 'Updated' });
    expect((await fetch(`${baseUrl}/users/${user.id}`, { method: 'DELETE' })).status).toBe(204);

    expect((await fetch(`${baseUrl}/unauthorized`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/server-error`)).status).toBe(500);
    expect(await (await fetch(`${baseUrl}/schema-violation`)).json()).toMatchObject({ id: 41 });
    expect((await fetch(`${baseUrl}/malformed`)).headers.get('content-type')).toContain('application/json');
    expect((await fetch(`${baseUrl}/slow?ms=1`)).status).toBe(200);
  });
});
