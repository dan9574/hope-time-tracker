export {};

interface DailyScheduleSettings {
  timezone: string;
  wakeUpTime: string;
  sleepTime: string;
}

interface WeeklyScheduleEvent {
  day: number;
  startTime: string;
  endTime: string;
  subject: string;
  subcategory: string;
}

interface ManualStudyPlan {
  id: number;
  planDate: string;
  startTime: string;
  endTime: string;
  subject: string;
  subcategory: string;
}

declare global {
  interface Window {
    api: {
      listActivities(): Promise<{id:number,name:string}[]>;
      listSubActivities(activityId:number|null): Promise<{id:number,activityId:number,name:string}[]>;
      upsertActivity(name:string): Promise<number>;
      upsertSubActivity(activityId:number,name:string): Promise<number>;
      startSession(payload:{activityId:number|null, subActivityId:number|null, note:string}): Promise<{sessionId:number}>;
      stopSession(): Promise<{stopped:boolean}>;
      insertSession(payload:{activityId:number, subActivityId:number|null, note:string, startMs:number, endMs:number, durationMs:number}): Promise<{sessionId:number}>;
      getToday(): Promise<Array<{activity:string, subActivity:string|null, millis:number}>>;
      getDay(isoDate:string): Promise<any[]>;
      getMonthSummary(yyyyMM:string): Promise<Array<{key:string, millis:number}>>;
      getNowRunning(): Promise<null|{sessionId:number, activityId:number|null, subActivityId:number|null, note:string, startMs:number}>;
      deleteActivity(id: number): Promise<void>;
      deleteSubActivity(id: number): Promise<void>;
      getSettings(targetDate?: string): Promise<DailyScheduleSettings | null>;
      setSettings(settings: Partial<DailyScheduleSettings>): Promise<void>;
      exportData(): Promise<string>;
      importData(): Promise<void>;
      getWeeklySchedule(targetDate?: string): Promise<WeeklyScheduleEvent[]>;
      setWeeklySchedule(schedule: WeeklyScheduleEvent[]): Promise<void>;
      getManualPlans(page: number, pageSize: number): Promise<{ plans: ManualStudyPlan[], total: number }>;
      addManualPlan(plan: Omit<ManualStudyPlan, 'id'>): Promise<void>;
      deleteManualPlan(planId: number): Promise<void>;
      getManualPlansForDate(date: string): Promise<ManualStudyPlan[]>;
      getDaysWithDataInMonth(yyyyMM: string): Promise<string[]>;
      // Journal APIs
      addJournal(content: string): Promise<{ ok: boolean; id?: number; day_date?: string; created_ms?: number; error?: string }>;
      listJournalRecent(limit?: number, beforeMs?: number | null): Promise<{ ok: boolean; items: Array<{ id:number; day_date:string; created_ms:number; content:string; edited_ms:number|null }> }>;
      listJournalByDay(dayDate: string): Promise<{ ok: boolean; items: Array<{ id:number; day_date:string; created_ms:number; content:string; edited_ms:number|null }> }>;
      updateJournal(id: number, content: string): Promise<{ ok: boolean; edited_ms?: number; error?: string }>;
      deleteJournal(id: number): Promise<{ ok: boolean; error?: string }>;
      getJournalDaysInMonth(yyyyMM: string): Promise<{ ok: boolean; days: string[]; error?: string }>;
      dev: {
        sessions: {
          list(page?: number, pageSize?: number): Promise<{ ok: boolean; items: Array<{ id:number; activity_id:number|null; sub_activity_id:number|null; start_ms:number; end_ms:number|null; duration_ms:number|null; is_manual:number; note:string; activity_name:string|null; sub_activity_name:string|null }>; total:number; error?:string }>;
          delete(ids: number[]): Promise<{ ok: boolean; deleted?: number; error?: string }>;
          deleteAll(): Promise<{ ok: boolean; deleted?: number; error?: string }>;
        };
        journal: {
          list(page?: number, pageSize?: number): Promise<{ ok: boolean; items: Array<{ id:number; day_date:string; created_ms:number; content:string; edited_ms:number|null }>; total:number; error?:string }>;
          delete(ids: number[]): Promise<{ ok: boolean; deleted?: number; error?: string }>;
          deleteAll(): Promise<{ ok: boolean; deleted?: number; error?: string }>;
        };
      };
    }
  }
}