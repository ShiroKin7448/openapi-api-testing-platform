process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');

import { buildPayload, buildPlainText, parseTarget, shouldNotify, type RunNotificationSummary } from '../services/notification.service';

const summary: RunNotificationSummary = {
  runId: '7789a991-0000-0000-0000-000000000000', shortId: '7789a991', projectName: 'Shop', environmentName: 'staging', status: 'COMPLETED', triggerType: 'SCHEDULED',
  total: 42, passed: 39, failed: 3, passRate: 92.9, failureReason: null, functionalRegressions: ['POST /payments'], performanceRegressions: [], url: 'https://app.example.com/projects/p/runs/r',
};

describe('notification target validation', () => {
  it('accepts Discord and Slack webhooks on their own hosts only', () => {
    expect(parseTarget('DISCORD', { webhookUrl: 'https://discord.com/api/webhooks/123/abcdef' }).target.url).toContain('discord.com');
    expect(parseTarget('SLACK', { webhookUrl: 'https://hooks.slack.com/services/T/B/X' }).target.url).toContain('hooks.slack.com');
  });

  it.each([
    ['DISCORD', 'http://discord.com/api/webhooks/1/a'],
    ['DISCORD', 'https://evil.example.com/api/webhooks/1/a'],
    ['DISCORD', 'https://discord.com.evil.io/api/webhooks/1/a'],
    ['DISCORD', 'https://discord.com/other/path'],
    ['DISCORD', 'https://user:pw@discord.com/api/webhooks/1/a'],
    ['SLACK', 'https://127.0.0.1/services/T/B/X'],
    ['SLACK', 'not a url'],
  ] as const)('rejects %s webhook %s', (type, url) => {
    expect(() => parseTarget(type, { webhookUrl: url })).toThrow();
  });

  it('validates Telegram token and chat id and masks the hint', () => {
    const parsed = parseTarget('TELEGRAM', { botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', chatId: '-1001234567' });
    expect(parsed.hint).toContain('…Dsaw');
    expect(parsed.hint).not.toContain('AAHdqTcv');
    expect(() => parseTarget('TELEGRAM', { botToken: 'bad', chatId: '1' })).toThrow();
  });
});

describe('notification message', () => {
  it('contains pass rate, regression endpoint and link', () => {
    const text = buildPlainText(summary);
    expect(text).toContain('#7789a991');
    expect(text).toContain('92.9% (39/42 ca)');
    expect(text).toContain('POST /payments');
    expect(text).toContain(summary.url);
  });

  it('builds a platform specific payload', () => {
    const discord = buildPayload('DISCORD', summary, { url: 'https://discord.com/api/webhooks/1/a' });
    expect(discord.url).toBe('https://discord.com/api/webhooks/1/a');
    expect((discord.body as { embeds: unknown[] }).embeds).toHaveLength(1);
    const telegram = buildPayload('TELEGRAM', { ...summary, projectName: '<b>x</b>' }, { botToken: '1:abc', chatId: '5' });
    expect(telegram.url).toBe('https://api.telegram.org/bot1:abc/sendMessage');
    expect(JSON.stringify(telegram.body)).not.toContain('<b>x</b>');
  });
});

describe('shouldNotify', () => {
  const base = { triggerType: 'MANUAL', status: 'COMPLETED', failed: 0, functionalRegressions: [] as string[], performanceRegressions: [] as string[] };
  it('respects the selected events', () => {
    expect(shouldNotify(['ALL_RUNS'], base)).toBe(true);
    expect(shouldNotify(['SCHEDULED_RUN'], base)).toBe(false);
    expect(shouldNotify(['SCHEDULED_RUN'], { ...base, triggerType: 'SCHEDULED' })).toBe(true);
    expect(shouldNotify(['RUN_FAILED'], { ...base, failed: 1 })).toBe(true);
    expect(shouldNotify(['RUN_FAILED'], { ...base, status: 'FAILED' })).toBe(true);
    expect(shouldNotify(['REGRESSION'], base)).toBe(false);
    expect(shouldNotify(['REGRESSION'], { ...base, functionalRegressions: ['GET /x'] })).toBe(true);
  });
});
