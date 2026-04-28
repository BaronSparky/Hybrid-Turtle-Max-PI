'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Clock, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import { timeSince } from '@/lib/utils';

interface ScheduledTask {
  id: string;
  label: string;
  schedule: string;
  lastRun: string | null;
  lastStatus: string | null;
  ageHours: number | null;
}

export default function ScheduledTasksPanel() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await apiRequest<{ tasks: ScheduledTask[] }>('/api/scheduled-tasks');
      setTasks(data.tasks);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary-400 animate-pulse" />
          Scheduled Tasks
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Loading tasks...</div>
      </div>
    );
  }

  const stale = tasks.filter(t => t.ageHours !== null && t.ageHours > 48);
  const healthy = tasks.filter(t => t.lastRun && t.lastStatus === 'OK' || t.lastStatus === 'SUCCESS' || t.lastStatus === 'PARTIAL');
  const neverRun = tasks.filter(t => !t.lastRun);

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary-400" />
          Scheduled Tasks
        </h3>
        <button
          onClick={fetchTasks}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="text-[10px] text-muted-foreground mb-3">
        {healthy.length}/{tasks.length} healthy
        {stale.length > 0 && <span className="text-warning ml-2">· {stale.length} stale</span>}
        {neverRun.length > 0 && <span className="ml-2">· {neverRun.length} never ran</span>}
      </div>

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {tasks.map(task => {
          const isOk = task.lastStatus === 'OK' || task.lastStatus === 'SUCCESS' || task.lastStatus === 'PARTIAL';
          const isFailed = task.lastStatus === 'FAILED';
          const isStale = task.ageHours !== null && task.ageHours > 48;
          const neverRan = !task.lastRun;

          return (
            <div
              key={task.id}
              className={cn(
                'flex items-center justify-between py-1.5 px-2 rounded text-[11px]',
                isFailed ? 'bg-loss/5' : isStale ? 'bg-warning/5' : ''
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {neverRan ? (
                  <Clock className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                ) : isOk ? (
                  <CheckCircle className="w-3 h-3 text-profit flex-shrink-0" />
                ) : isFailed ? (
                  <XCircle className="w-3 h-3 text-loss flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-warning flex-shrink-0" />
                )}
                <div className="truncate">
                  <span className={cn(
                    'font-medium',
                    neverRan ? 'text-muted-foreground/60' : isFailed ? 'text-loss' : 'text-foreground'
                  )}>
                    {task.label}
                  </span>
                  <span className="text-muted-foreground/50 ml-1.5">{task.schedule}</span>
                </div>
              </div>
              <div className={cn(
                'text-[10px] font-mono flex-shrink-0 ml-2',
                neverRan ? 'text-muted-foreground/40' : isStale ? 'text-warning' : 'text-muted-foreground/60'
              )}>
                {task.lastRun ? timeSince(new Date(task.lastRun)) : 'never'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
