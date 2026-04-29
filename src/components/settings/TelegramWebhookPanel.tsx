'use client';

/**
 * DEPENDENCIES
 * Consumed by: /settings page (Telegram section)
 * Consumes: /api/telegram/register-webhook, /api/telegram/test-command
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 */

import { useState, useEffect, useCallback } from 'react';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Webhook,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  TestTube,
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react';

interface WebhookInfo {
  configured: boolean;
  url: string | null;
  pendingUpdateCount?: number;
  lastErrorDate?: string | null;
  lastErrorMessage?: string | null;
  error?: string;
}

interface TestCommandResult {
  command: string;
  response: string;
  parseMode: string;
}

export default function TelegramWebhookPanel() {
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestCommandResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showTestResult, setShowTestResult] = useState(false);

  const fetchWebhookInfo = useCallback(async () => {
    try {
      const info = await apiRequest<WebhookInfo>('/api/telegram/register-webhook');
      setWebhookInfo(info);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchWebhookInfo();
  }, [fetchWebhookInfo]);

  const handleRegister = async () => {
    if (!webhookUrl.trim()) {
      setRegisterResult({ ok: false, message: 'Enter a webhook URL' });
      return;
    }
    setRegistering(true);
    setRegisterResult(null);
    try {
      const data = await apiRequest<{ success: boolean; description: string; warning?: string | null }>(
        '/api/telegram/register-webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhookUrl }),
        }
      );
      setRegisterResult({
        ok: true,
        message: data.warning || data.description || 'Webhook registered',
      });
      fetchWebhookInfo();
    } catch (err) {
      setRegisterResult({
        ok: false,
        message: formatApiError(err, 'Registration failed'),
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleTestInbound = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const data = await apiRequest<TestCommandResult>('/api/telegram/test-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: '/help' }),
      });
      setTestResult(data);
      setShowTestResult(true);
    } catch (err) {
      setTestError(formatApiError(err, 'Test failed'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-border/30">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
        <Webhook className="w-4 h-4 text-primary-400" />
        Webhook Setup (Two-Way Commands)
      </h3>

      {/* Current status */}
      <div className="text-xs text-muted-foreground mb-3">
        <span className="text-muted-foreground">Status: </span>
        {webhookInfo ? (
          webhookInfo.configured ? (
            <span className="text-profit">
              ✓ Active — {webhookInfo.url}
              {webhookInfo.pendingUpdateCount ? ` (${webhookInfo.pendingUpdateCount} pending)` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">Not configured</span>
          )
        ) : (
          <span className="text-muted-foreground">Loading...</span>
        )}
        {webhookInfo?.lastErrorMessage && (
          <div className="text-loss mt-1">
            Last error: {webhookInfo.lastErrorMessage}
          </div>
        )}
      </div>

      {/* Webhook URL input */}
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://your-tunnel.ngrok.io/api/telegram/webhook"
          className="input-field flex-1 text-sm"
        />
        <button
          onClick={handleRegister}
          disabled={registering}
          className="btn-outline text-xs flex items-center gap-1 whitespace-nowrap"
        >
          {registering ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Send className="w-3 h-3" />
          )}
          {registering ? 'Registering...' : 'Register'}
        </button>
      </div>

      {/* Register result */}
      {registerResult && (
        <div className={cn(
          'text-xs flex items-center gap-1 mb-2',
          registerResult.ok ? 'text-profit' : 'text-loss'
        )}>
          {registerResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          {registerResult.message}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mb-3">
        Your dashboard must be accessible via a public HTTPS URL for Telegram to deliver messages.
        Use a tunnel on your local machine: <code className="text-primary-400">ngrok http 3000</code>
      </p>

      {/* Test inbound */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleTestInbound}
          disabled={testing}
          className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 disabled:opacity-50"
        >
          {testing ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <TestTube className="w-3 h-3" />
          )}
          {testing ? 'Testing...' : 'Test Inbound (/help)'}
        </button>
        {testError && (
          <span className="text-xs text-loss">✗ {testError}</span>
        )}
      </div>

      {/* Test result preview */}
      {showTestResult && testResult && (
        <div className="mt-2">
          <button
            onClick={() => setShowTestResult(!showTestResult)}
            className="text-[10px] text-muted-foreground flex items-center gap-1"
          >
            {showTestResult ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Test response preview
          </button>
          <div className="mt-1 p-3 bg-navy-800 rounded-lg text-xs text-foreground font-mono whitespace-pre-wrap border border-border/30 max-h-48 overflow-y-auto">
            {testResult.response
              .replace(/<b>/g, '').replace(/<\/b>/g, '')
              .replace(/<i>/g, '').replace(/<\/i>/g, '')
              .replace(/<code>/g, '').replace(/<\/code>/g, '')}
          </div>
        </div>
      )}
    </div>
  );
}
