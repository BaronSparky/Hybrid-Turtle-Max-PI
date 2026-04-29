'use client';

import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { getDayOfWeek } from '@/lib/utils';
import type { WeeklyPhase } from '@/types';

export function useWeeklyPhase() {
  const { weeklyPhase, setWeeklyPhase } = useStore();

  useEffect(() => {
    const day = getDayOfWeek();
    let phase: WeeklyPhase;

    switch (day) {
      case 0: // Sunday
        phase = 'PLANNING';
        break;
      case 6: // Saturday
        phase = 'MAINTENANCE';
        break;
      default: // Mon-Fri
        phase = 'EXECUTION';
        break;
    }

    setWeeklyPhase(phase);
  }, [setWeeklyPhase]);

  const isTradingDay = weeklyPhase === 'EXECUTION';
  const isObserveOnly = false; // No observation-only days — Mon-Fri are all execution days
  const isPlanningDay = weeklyPhase === 'PLANNING';
  const isManageDay = weeklyPhase === 'MAINTENANCE';

  const canPlaceNewTrades = isTradingDay;
  const canUpdateStops = isTradingDay || isManageDay;
  const canRunScan = true; // Always allowed
  const canRunHealthCheck = true; // Always allowed

  return {
    weeklyPhase,
    isTradingDay,
    isObserveOnly,
    isPlanningDay,
    isManageDay,
    canPlaceNewTrades,
    canUpdateStops,
    canRunScan,
    canRunHealthCheck,
  };
}
