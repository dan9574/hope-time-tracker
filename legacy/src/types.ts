// src/types.ts
export type BlockKind = 'logged' | 'scheduled' | 'gap';

/** Standard block used by chart components (uses Date for d3 compatibility) */
export interface TimeBlock {
  id: string;         // Unique ID: used for list/chart linking and highlighting
  startTime: Date;
  endTime: Date;
  type: BlockKind;
  title: string;
  color?: string;
  backgroundColor?: string;
  textColor?: string;
}

/** Types related to app settings */
export interface AppSettings {
  timezone?: 'PST' | 'Beijing';
  wakeTime?: string;
  sleepTime?: string;
  isOpaque?: boolean;
}

/** Weekly schedule event */
export interface WeeklyEvent {
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  activityId?: number;
  subActivityId?: number;
  color?: string;
  backgroundColor?: string;
  textColor?: string;
  color_hex?: string;
  background_color?: string;
  text_color?: string;
}

/** Weekly schedule */
export interface WeeklySchedule {
  [dayOfWeek: number]: WeeklyEvent[];  // 0=Sunday, 1=Monday, ..., 6=Saturday
}

/** Logged session */
export interface LoggedSession {
  start_ms: number;
  end_ms?: number;
  activity: string;
  subActivity?: string;
  // Colors from joined activity_colors table (optional)
  color_hex?: string;
  background_color?: string | null;
  text_color?: string;
}

/** Manual study plan */
export interface ManualStudyPlan {
  id?: number;
  planDate: string;    // YYYY-MM-DD
  startTime: string;
  endTime: string;
  subject: string;
  subcategory?: string;
  created_at?: number;
}

/** Pagination information */
export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Activity type (including color information) */
export interface Activity {
  id: number;
  name: string;
  color_hex?: string;
  background_color?: string;
  text_color?: string;
}

/** Activity color configuration */
export interface ActivityColor {
  id?: number;
  activity_id: number;
  activity_name?: string;
  color_hex: string;
  background_color?: string;
  text_color: string;
  created_at?: number;
  updated_at?: number;
}
