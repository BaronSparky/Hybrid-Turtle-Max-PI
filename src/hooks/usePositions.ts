'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import {apiRequest, formatApiError } from '@/lib/api-client';

interface Position {
  id: string;
  ticker: string;
  name: string;
  sleeve: string;
  entryPrice: number;
  currentPrice: number;
  shares: number;
  initialRisk: number;
  currentStop: number;
  stopLoss: number;
  initialStop: number;
  status: 'OPEN' | 'CLOSED';
  rMultiple: number;
  protectionLevel: string;
  gainPercent: number;
  gainDollars: number;
  riskDollars: number;
  entryDate: string;
}

export function usePositions(statusFilter?: string) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setPositions: setStorePositions } = useStore();

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('userId', 'default-user');
      if (statusFilter) params.set('status', statusFilter);
      const url = `/api/positions?${params.toString()}`;

      const data = await apiRequest<Position[] | { positions?: Position[] }>(url);
      const list = Array.isArray(data) ? data : (data.positions || []);
      setPositions(list);

      // Update store with open positions
      const openPositions = list.filter(
        (p: Position) => p.status === 'OPEN'
      );
      setStorePositions(openPositions);

      return list;
    } catch (err) {
      const msg = formatApiError(err, 'Unknown error');
      setError(msg);
      return [];
    } finally {
      setLoading(false);
    }
  }, [statusFilter, setStorePositions]);

  const updateStop = useCallback(async (positionId: string, newStop: number, reason: string = 'Manual stop update') => {
    try {
      await apiRequest('/api/stops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, newStop, reason }),
      });

      // Refresh positions
      await fetchPositions();
      return true;
    } catch (err) {
      const msg = formatApiError(err, 'Unknown error');
      setError(msg);
      return false;
    }
  }, [fetchPositions]);

  const closePosition = useCallback(async (positionId: string, exitPrice: number, exitReason?: string, closeNote?: string) => {
    try {
      await apiRequest('/api/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          exitPrice,
          exitReason,
          closeNote,
        }),
      });

      await fetchPositions();
      return true;
    } catch (err) {
      const msg = formatApiError(err, 'Unknown error');
      setError(msg);
      return false;
    }
  }, [fetchPositions]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  return {
    positions,
    loading,
    error,
    fetchPositions,
    updateStop,
    closePosition,
  };
}
