'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import type { HealthStatus } from '@/types';
import {apiRequest, formatApiError } from '@/lib/api-client';

interface HealthCheckReport {
  overall: HealthStatus;
  checks: Record<string, HealthStatus>;
  results: Array<{
    id: string;
    label: string;
    category: string;
    status: HealthStatus;
    message: string;
  }>;
  timestamp: string;
}

const DEFAULT_USER_ID = 'default-user';

export function useHealthCheck(autoRun = false, userId = DEFAULT_USER_ID) {
  const [report, setReport] = useState<HealthCheckReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setHealthStatus } = useStore();

  const runHealthCheck = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<HealthCheckReport>('/api/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      setReport(data);
      setHealthStatus(data.overall as HealthStatus);

      return data;
    } catch (err) {
      const msg = formatApiError(err, 'Unknown error');
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setHealthStatus, userId]);

  const fetchLatestCheck = useCallback(async () => {
    try {
      const data = await apiRequest<HealthCheckReport>(`/api/health-check?userId=${userId}`);
      setReport(data);
      setHealthStatus(data.overall as HealthStatus);
    } catch (err) {
      // Silent fail for initial fetch
    }
  }, [setHealthStatus, userId]);

  useEffect(() => {
    if (autoRun) {
      fetchLatestCheck();
    }
  }, [autoRun, fetchLatestCheck]);

  return {
    report,
    loading,
    error,
    runHealthCheck,
    fetchLatestCheck,
  };
}
