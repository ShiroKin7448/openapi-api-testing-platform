import axios from 'axios';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';
import { cryptoService } from './crypto.service';
import { ssrfHttpsAgent } from './ssrf-guard.service';
import { compareReports, loadRunReport } from './run-report.service';

export type ChannelType = 'DISCORD' | 'SLACK' | 'TELEGRAM';
export type NotificationEvent = 'SCHEDULED_RUN' | 'RUN_FAILED' | 'REGRESSION' | 'ALL_RUNS';
export const CHANNEL_TYPES: ChannelType[] = ['DISCORD', 'SLACK', 'TELEGRAM'];
export const NOTIFICATION_EVENTS: NotificationEvent[] = ['SCHEDULED_RUN', 'RUN_FAILED', 'REGRESSION', 'ALL_RUNS'];

export interface RunNotificationSummary {
  runId: string;
  shortId: string;
  projectName: string;
  environmentName: string;
  status: string;
  triggerType: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  failureReason: string | null;
  /** Endpoints with a case that passed in the previous comparable run but fails now. */
  functionalRegressions: string[];
  /** Endpoints whose p95 latency grew beyond the configured threshold. */
  performanceRegressions: string[];
  url: string;
}

interface ChannelTarget { url?: string; botToken?: string; chatId?: string }

const WEBHOOK_HOSTS: Record<'DISCORD' | 'SLACK', RegExp> = {
  DISCORD: /^(?:discord\.com|discordapp\.com|(?:ptb|canary)\.discord\.com)$/i,
  SLACK: /^hooks\.slack\.com$/i,
};

/** Parses and validates what the user typed for a channel; returns the structure that gets encrypted. */
export function parseTarget(type: ChannelType, input: { webhookUrl?: string; botToken?: string; chatId?: string }): { target: ChannelTarget; hint: string } {
  if (type === 'TELEGRAM') {
    const botToken = (input.botToken ?? '').trim();
    const chatId = (input.chatId ?? '').trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw new AppError('Bot token Telegram không hợp lệ (dạng 123456:ABC...).', 422, true, 'INVALID_TELEGRAM_TOKEN');
    if (!/^(-?\d{5,}|@[A-Za-z0-9_]{4,})$/.test(chatId)) throw new AppError('Chat ID Telegram không hợp lệ.', 422, true, 'INVALID_TELEGRAM_CHAT');
    return { target: { botToken, chatId }, hint: `chat ${chatId} · bot …${botToken.slice(-4)}` };
  }
  let url: URL;
  try { url = new URL((input.webhookUrl ?? '').trim()); } catch { throw new AppError('Webhook URL không hợp lệ.', 422, true, 'INVALID_WEBHOOK_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new AppError('Webhook phải là URL https không chứa tài khoản.', 422, true, 'INVALID_WEBHOOK_URL');
  if (!WEBHOOK_HOSTS[type].test(url.hostname)) {
    throw new AppError(type === 'DISCORD' ? 'Webhook Discord phải thuộc discord.com.' : 'Webhook Slack phải thuộc hooks.slack.com.', 422, true, 'INVALID_WEBHOOK_HOST');
  }
  if (type === 'DISCORD' && !url.pathname.startsWith('/api/webhooks/')) throw new AppError('Đường dẫn webhook Discord phải bắt đầu bằng /api/webhooks/.', 422, true, 'INVALID_WEBHOOK_URL');
  return { target: { url: url.toString() }, hint: `${url.hostname}/…${url.pathname.slice(-6)}` };
}

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildPlainText(summary: RunNotificationSummary): string {
  const ok = summary.status === 'COMPLETED' && summary.failed === 0;
  const lines = [
    `🔔 [API Test Auto] Lượt chạy #${summary.shortId} ${summary.status === 'COMPLETED' ? 'hoàn tất' : summary.status === 'FAILED' ? 'thất bại / bị dừng' : 'đã kết thúc'}! ${ok ? '✅' : '❌'}`,
    `- Dự án: ${summary.projectName} (${summary.environmentName}) · kích hoạt: ${summary.triggerType}`,
    `- Tỷ lệ Pass: ${summary.passRate}% (${summary.passed}/${summary.total} ca)`,
  ];
  if (summary.failureReason) lines.push(`- Lý do dừng: ${summary.failureReason}`);
  if (summary.functionalRegressions.length) lines.push(`- Cảnh báo: Phát hiện ${summary.functionalRegressions.length} ca lỗi hồi quy tại Endpoint: ${summary.functionalRegressions.join(', ')}`);
  if (summary.performanceRegressions.length) lines.push(`- Cảnh báo hiệu năng: p95 tăng bất thường tại ${summary.performanceRegressions.join(', ')}`);
  lines.push(`- Xem chi tiết tại: ${summary.url}`);
  return lines.join('\n');
}

export function buildPayload(type: ChannelType, summary: RunNotificationSummary, target: ChannelTarget): { url: string; body: unknown } {
  const text = buildPlainText(summary);
  const hasProblem = summary.failed > 0 || summary.status !== 'COMPLETED' || summary.functionalRegressions.length > 0;
  if (type === 'DISCORD') {
    return { url: target.url as string, body: { username: 'API Test Auto', embeds: [{ title: `Lượt chạy #${summary.shortId}`, description: text.split('\n').slice(1).join('\n'), color: hasProblem ? 0xf43f5e : 0x10b981, url: summary.url }] } };
  }
  if (type === 'SLACK') {
    return { url: target.url as string, body: { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: text.replace(/\*/g, '') } }] } };
  }
  return {
    url: `https://api.telegram.org/bot${target.botToken}/sendMessage`,
    body: { chat_id: target.chatId, text: esc(text), parse_mode: 'HTML', disable_web_page_preview: true },
  };
}

async function postWithRetry(url: string, body: unknown, attempts = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await axios.post(url, body, { timeout: 8000, httpsAgent: ssrfHttpsAgent, maxRedirects: 0, headers: { 'Content-Type': 'application/json' } });
      return;
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status && status >= 400 && status < 500 && status !== 429) break; // client errors will not succeed on retry
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
  const status = axios.isAxiosError(lastError) ? lastError.response?.status : undefined;
  const raw = lastError instanceof Error ? lastError.message : 'Không gửi được thông báo';
  throw new Error(status ? `Dịch vụ nhận trả về HTTP ${status}` : raw.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***'));
}

function decryptTarget(targetEnc: string): ChannelTarget {
  return JSON.parse(cryptoService.decrypt(targetEnc)) as ChannelTarget;
}

export function shouldNotify(events: string[], summary: Pick<RunNotificationSummary, 'triggerType' | 'status' | 'failed' | 'functionalRegressions' | 'performanceRegressions'>): boolean {
  if (events.includes('ALL_RUNS')) return true;
  if (events.includes('SCHEDULED_RUN') && summary.triggerType === 'SCHEDULED') return true;
  if (events.includes('RUN_FAILED') && (summary.status === 'FAILED' || summary.failed > 0)) return true;
  if (events.includes('REGRESSION') && (summary.functionalRegressions.length > 0 || summary.performanceRegressions.length > 0)) return true;
  return false;
}

export class NotificationService {
  async buildSummary(runId: string): Promise<RunNotificationSummary | null> {
    const run = await prisma.testRun.findUnique({
      where: { id: runId },
      select: { id: true, projectId: true, environmentId: true, status: true, triggerType: true, failureReason: true, regressionAnalysis: true, createdAt: true,
        project: { select: { name: true } }, environment: { select: { name: true } } },
    });
    if (!run) return null;
    const grouped = await prisma.testResult.groupBy({ by: ['status'], where: { testRunId: runId }, _count: { _all: true } });
    const count = (status: string): number => grouped.find((row) => row.status === status)?._count._all ?? 0;
    const passed = count('PASSED');
    const failed = count('FAILED') + count('ERROR');
    const total = Math.max(passed + failed + count('PENDING'), (await prisma.testRun.findUnique({ where: { id: runId }, select: { totalTests: true } }))?.totalTests ?? 0);

    let functionalRegressions: string[] = [];
    try {
      const previous = await prisma.testRun.findFirst({
        where: { projectId: run.projectId, environmentId: run.environmentId, status: 'COMPLETED', id: { not: runId }, createdAt: { lt: run.createdAt } },
        orderBy: { createdAt: 'desc' }, select: { id: true },
      });
      if (previous) {
        const comparison = compareReports(await loadRunReport(previous.id), await loadRunReport(runId));
        functionalRegressions = [...new Set(comparison.cases.filter((item) => item.change === 'NEW_FAILURE').map((item) => `${item.method.toUpperCase()} ${item.path}`))];
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'notification.regression_failed', runId, error: error instanceof Error ? error.message : 'unknown' }));
    }

    const analysis = Array.isArray(run.regressionAnalysis) ? run.regressionAnalysis as Array<{ endpointId?: string; regressionFlag?: boolean }> : [];
    const flagged = analysis.filter((item) => item.regressionFlag && item.endpointId).map((item) => item.endpointId as string);
    const endpoints = flagged.length ? await prisma.endpoint.findMany({ where: { id: { in: flagged } }, select: { method: true, path: true } }) : [];
    const base = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

    return {
      runId, shortId: runId.slice(0, 8), projectName: run.project.name, environmentName: run.environment.name, status: run.status, triggerType: run.triggerType,
      total, passed, failed, passRate: total ? Math.round((passed / total) * 1000) / 10 : 0, failureReason: run.failureReason,
      functionalRegressions, performanceRegressions: endpoints.map((item) => `${item.method.toUpperCase()} ${item.path}`),
      url: `${base}/projects/${run.projectId}/runs/${runId}`,
    };
  }

  /** Sends the run summary to every matching channel once per run. Never throws: alerting must not break a run. */
  async notifyRunFinished(runId: string): Promise<void> {
    try {
      const claim = await prisma.testRun.updateMany({ where: { id: runId, notifiedAt: null, status: { in: ['COMPLETED', 'FAILED'] } }, data: { notifiedAt: new Date() } });
      if (claim.count !== 1) return;
      const summary = await this.buildSummary(runId);
      if (!summary) return;
      const run = await prisma.testRun.findUnique({ where: { id: runId }, select: { projectId: true } });
      if (!run) return;
      const channels = await prisma.notificationChannel.findMany({ where: { projectId: run.projectId, enabled: true } });
      await Promise.all(channels.filter((channel) => shouldNotify(channel.events, summary)).map((channel) => this.deliver(channel, summary)));
    } catch (error) {
      console.error(JSON.stringify({ event: 'notification.failed', runId, error: error instanceof Error ? error.message : 'unknown' }));
    }
  }

  private async deliver(channel: { id: string; type: string; targetEnc: string }, summary: RunNotificationSummary): Promise<void> {
    try {
      const { url, body } = buildPayload(channel.type as ChannelType, summary, decryptTarget(channel.targetEnc));
      await postWithRetry(url, body);
      await prisma.notificationChannel.update({ where: { id: channel.id }, data: { lastStatus: 'OK', lastError: null, lastSentAt: new Date() } });
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Gửi thất bại').slice(0, 300);
      await prisma.notificationChannel.update({ where: { id: channel.id }, data: { lastStatus: 'ERROR', lastError: message, lastSentAt: new Date() } }).catch(() => undefined);
    }
  }

  /** "Gửi thử": sends a sample message and reports the result to the caller. */
  async sendTest(channelId: string): Promise<{ ok: boolean; error?: string }> {
    const channel = await prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw new AppError('Kênh thông báo không tồn tại', 404, true, 'CHANNEL_NOT_FOUND');
    const base = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
    const sample: RunNotificationSummary = {
      runId: 'test', shortId: 'TEST0000', projectName: 'Tin nhắn thử', environmentName: 'demo', status: 'COMPLETED', triggerType: 'SCHEDULED',
      total: 42, passed: 39, failed: 3, passRate: 92.8, failureReason: null, functionalRegressions: ['POST /payments'], performanceRegressions: [], url: `${base}/`,
    };
    try {
      const { url, body } = buildPayload(channel.type as ChannelType, sample, decryptTarget(channel.targetEnc));
      await postWithRetry(url, body, 1);
      await prisma.notificationChannel.update({ where: { id: channel.id }, data: { lastStatus: 'OK', lastError: null, lastSentAt: new Date() } });
      return { ok: true };
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Gửi thất bại').slice(0, 300);
      await prisma.notificationChannel.update({ where: { id: channel.id }, data: { lastStatus: 'ERROR', lastError: message, lastSentAt: new Date() } });
      return { ok: false, error: message };
    }
  }
}

export const notificationService = new NotificationService();
