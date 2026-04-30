import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationCreate = vi.fn();
const notificationFindFirst = vi.fn();
const sendTelegramMessage = vi.fn();
const sendThrottledTelegramAlert = vi.fn();

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: notificationCreate,
      findFirst: notificationFindFirst,
    },
  },
}));

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage,
  sendThrottledTelegramAlert,
}));

describe('sendAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationCreate.mockResolvedValue({ id: 'notification-1' });
    notificationFindFirst.mockResolvedValue(null);
    sendTelegramMessage.mockResolvedValue(true);
    sendThrottledTelegramAlert.mockResolvedValue(true);
  });

  it('saves the notification and sends Telegram normally by default', async () => {
    const { sendAlert } = await import('./alert-service');

    await sendAlert({
      type: 'SYSTEM',
      title: 'Dashboard down',
      message: 'The dashboard is unreachable.',
      priority: 'WARNING',
    });

    expect(notificationCreate).toHaveBeenCalledWith({
      data: {
        type: 'SYSTEM',
        title: 'Dashboard down',
        message: 'The dashboard is unreachable.',
        data: null,
        priority: 'WARNING',
      },
    });
    expect(sendTelegramMessage).toHaveBeenCalledWith({
      text: '⚠️ <b>Dashboard down</b>\n\nThe dashboard is unreachable.',
      parseMode: 'HTML',
    });
    expect(sendThrottledTelegramAlert).not.toHaveBeenCalled();
  });

  it('uses throttled Telegram delivery when a dedupe key is provided', async () => {
    const { sendAlert } = await import('./alert-service');

    await sendAlert({
      type: 'SYSTEM',
      title: 'Midday sync failed',
      message: 'The intra-day sync failed.',
      priority: 'WARNING',
      telegramDedupeKey: 'midday-sync:failed',
      telegramThrottleMs: 30_000,
    });

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(sendThrottledTelegramAlert).toHaveBeenCalledWith(
      {
        text: '⚠️ <b>Midday sync failed</b>\n\nThe intra-day sync failed.',
        parseMode: 'HTML',
      },
      'midday-sync:failed',
      30_000
    );
  });

  it('does not send Telegram when skipTelegram is true', async () => {
    const { sendAlert } = await import('./alert-service');

    await sendAlert({
      type: 'SYSTEM',
      title: 'In-app only',
      message: 'Saved to notification centre only.',
      priority: 'INFO',
      skipTelegram: true,
      telegramDedupeKey: 'ignored',
    });

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(sendThrottledTelegramAlert).not.toHaveBeenCalled();
  });

  it('suppresses duplicate in-app notifications by dedupe key', async () => {
    notificationFindFirst.mockResolvedValue({ id: 42 });
    const { sendAlert } = await import('./alert-service');

    await sendAlert({
      type: 'BROKER_SYNC_FAILURE',
      title: 'T212 Rate Limited',
      message: 'Trading 212 ISA account rate-limited.',
      priority: 'WARNING',
      data: { account: 'ISA' },
      notificationDedupeKey: 't212-rate-limit:ISA',
      notificationThrottleMs: 6 * 60 * 60_000,
    });

    expect(notificationFindFirst).toHaveBeenCalledWith({
      where: {
        type: 'BROKER_SYNC_FAILURE',
        title: 'T212 Rate Limited',
        createdAt: { gte: expect.any(Date) },
        data: { contains: '"_notificationDedupeKey":"t212-rate-limit:ISA"' },
      },
      select: { id: true },
    });
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('stores the in-app dedupe key with new notifications', async () => {
    const { sendAlert } = await import('./alert-service');

    await sendAlert({
      type: 'BROKER_SYNC_FAILURE',
      title: 'T212 Rate Limited',
      message: 'Trading 212 ISA account rate-limited.',
      priority: 'WARNING',
      data: { account: 'ISA' },
      notificationDedupeKey: 't212-rate-limit:ISA',
    });

    expect(notificationCreate).toHaveBeenCalledWith({
      data: {
        type: 'BROKER_SYNC_FAILURE',
        title: 'T212 Rate Limited',
        message: 'Trading 212 ISA account rate-limited.',
        data: JSON.stringify({ account: 'ISA', _notificationDedupeKey: 't212-rate-limit:ISA' }),
        priority: 'WARNING',
      },
    });
  });
});