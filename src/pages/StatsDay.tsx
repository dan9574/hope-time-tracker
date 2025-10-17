import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import minMax from 'dayjs/plugin/minMax';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import TimeArcChart from '../components/TimeArcChart';
import type { TimeBlock as ChartBlock, LoggedSession, AppSettings, WeeklySchedule } from '../types';
import './StatsDay.css';

dayjs.extend(minMax);
dayjs.extend(isSameOrAfter);

// Convert a hex color to an rgba string with alpha
function hexToRgba(hex: string, alpha = 0.15): string | null {
  if (!hex) return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return null;
}

export interface DayjsTimeBlock {
  id: string;
  startTime: dayjs.Dayjs;
  endTime: dayjs.Dayjs;
  title: string;
  type: 'logged' | 'scheduled' | 'gap';
  color?: string;
  backgroundColor?: string;
  textColor?: string;
}

// These constants are now loaded from the app settings in the DB
// const WAKING_HOURS_START = 8;
// const WAKING_HOURS_END = 21.6667;
// const SCHEDULES = { ... };

type ViewMode = 'chartFirst' | 'listFirst';

const StatsDay: React.FC = () => {
  const { isoDate } = useParams<{ isoDate: string }>();
  const navigate = useNavigate();
  const [currentTimezone, setCurrentTimezone] = useState<'PST' | 'Beijing'>('PST');
  const [timeline, setTimeline] = useState<DayjsTimeBlock[]>([]);
  const [hovered, setHovered] = useState<DayjsTimeBlock | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('chartFirst');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Settings loaded from the database
  const [settings, setSettings] = useState<AppSettings>({});
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [manualPlans, setManualPlans] = useState<any[]>([]);

  const makeId = (s: dayjs.Dayjs, e: dayjs.Dayjs, type: DayjsTimeBlock['type']) =>
    `${s.valueOf()}-${e.valueOf()}-${type}`;

  // Load settings data
  useEffect(() => {
    async function loadSettings() {
      if (!isoDate) return;
      
    try {
      // Load settings that are effective for the target date
      const appSettings = await (window.api as any).getSettings(isoDate);
      const schedule = await (window.api as any).getWeeklySchedule(isoDate);
        
  // Load manual plans (only for today or future dates)
        const currentDate = dayjs(isoDate);
        const today = dayjs();
        let plans: any[] = [];
        if (currentDate.isSameOrAfter(today, 'day')) {
          plans = await (window.api as any).getManualPlansForDate(isoDate);
        }
        
  // Load manual session records (all dates)
        const manualSessions = await (window.api as any).getManualSessionsForDate(isoDate);
        
        setSettings(appSettings || {});
        setWeeklySchedule(schedule || {});
  setManualPlans([...plans, ...manualSessions]); // merge both types of manual records
        setSettingsLoaded(true);
        // Debug info
        console.log('🔍 StatsDay data loaded:', {
          isoDate,
          dayOfWeek: dayjs(isoDate).day(),
          appSettings,
          weeklySchedule: schedule,
          manualPlans: plans,
          todayEvents: schedule ? schedule[dayjs(isoDate).day()] : undefined
        });

        // Apply timezone from settings if present
        if (appSettings?.timezone) {
          setCurrentTimezone(appSettings.timezone);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
  // Even on failure, mark as loaded so the page doesn't hang
        setSettings({});
        setWeeklySchedule({});
        setSettingsLoaded(true);
      }
    }
    loadSettings();
  }, [isoDate]);

  useEffect(() => {
  // Only run when settings have loaded and we have a date
    if (!isoDate || !settingsLoaded) return;
    
    const fetchAndProcess = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const timezoneOffset = currentTimezone === 'PST' ? '-7 hours' : '+8 hours';
        const sessions: LoggedSession[] = await (window.api as any).getDay(isoDate, timezoneOffset);
        const target = dayjs(isoDate);
        const dayOfWeek = target.day();
        
  // Check if the date is today or in the future
        const currentDate = dayjs(isoDate);
        const today = dayjs();
        
  // Use wake/sleep times from DB settings; defaults: 08:00 and 21:40
        const wakeTimeStr = settings.wakeTime || '08:00';
        const sleepTimeStr = settings.sleepTime || '21:40';
        
        // Debug output - help confirm which settings are in effect
        console.log('🕐 Current settings:', { 
          wakeTime: settings.wakeTime, 
          sleepTime: settings.sleepTime,
          wakeTimeUsed: wakeTimeStr,
          sleepTimeUsed: sleepTimeStr,
          fullSettings: settings
        });
        
        const [wakeHour, wakeMin] = wakeTimeStr.split(':').map(n => parseInt(n, 10));
        const [sleepHour, sleepMin] = sleepTimeStr.split(':').map(n => parseInt(n, 10));
        
        const wakingStart = target.hour(wakeHour).minute(wakeMin).second(0).millisecond(0);
        const wakingEnd = target.hour(sleepHour).minute(sleepMin).second(0).millisecond(0);
        
        // Use the weekly schedule from DB
        const todayEvents = weeklySchedule[dayOfWeek] || [];
        console.log('📅 Weekly schedule for today:', {
          dayOfWeek,
          todayEvents,
          weeklySchedule
        });
        
        const scheduled: DayjsTimeBlock[] = todayEvents.map(ev => {
          const [startHour, startMin] = ev.start.split(':').map(n => parseInt(n, 10));
          const [endHour, endMin] = ev.end.split(':').map(n => parseInt(n, 10));
          const s = target.hour(startHour).minute(startMin).second(0).millisecond(0);
          const e = target.hour(endHour).minute(endMin).second(0).millisecond(0);
          // Note: main process `schedule:get` already combines activity/subactivity into title
          // Avoid concatenating subtitle here to prevent duplication
          const title = ev.title;
          console.log('➕ Adding scheduled block:', { 
            title, 
            start: s.format('HH:mm'), 
            end: e.format('HH:mm'),
            color: ev.color_hex,
            textColor: ev.text_color
          });
          return { 
            id: makeId(s, e, 'scheduled'), 
            startTime: s, 
            endTime: e, 
            title, 
            type: 'scheduled',
            color: ev.color_hex,
            backgroundColor: ev.background_color,
            textColor: ev.text_color
          };
        });
        
  // Add manual plans/records into the scheduled list
        manualPlans.forEach((plan: any) => {
          let s, e, title;
          
          if (plan.start_time && plan.end_time) {
            // Manual study plan format (manual_study_plans table)
            const [startHour, startMin] = plan.start_time.split(':').map((n: string) => parseInt(n, 10));
            const [endHour, endMin] = plan.end_time.split(':').map((n: string) => parseInt(n, 10));
            s = target.hour(startHour).minute(startMin).second(0).millisecond(0);
            e = target.hour(endHour).minute(endMin).second(0).millisecond(0);
            
            // Prefer activity name; fall back to subject
            const activityName = plan.activity_name || plan.subject;
            const subActivityName = plan.sub_activity_name || plan.subcategory;
            title = subActivityName ? `${activityName} / ${subActivityName}` : activityName;
          } else if (plan.start_ms && plan.end_ms) {
            // Manual session record format (sessions table)
            s = dayjs(plan.start_ms);
            e = dayjs(plan.end_ms);
            
            const activityName = plan.activity_name;
            const subActivityName = plan.sub_activity_name;
            title = subActivityName ? `${activityName} / ${subActivityName}` : activityName;
          } else {
            console.warn('⚠️ Unknown manual record format:', plan);
            return;
          }
          
          // Only add manual_study_plans for today/future dates, but include all manual sessions
          if (plan.start_ms || currentDate.isSameOrAfter(today, 'day')) {
            console.log('📝 Adding manual record:', {
              title,
              color: plan.color_hex,
              activityId: plan.activity_id,
              type: plan.start_ms ? 'session' : 'plan'
            });
            
            scheduled.push({ 
              id: makeId(s, e, 'scheduled'), 
              startTime: s, 
              endTime: e, 
              title, 
              type: 'scheduled',
              color: plan.color_hex,
              backgroundColor: plan.background_color,
              textColor: plan.text_color
            });
          }
        });
        
        let blocks: DayjsTimeBlock[] = [];
        let cursor = wakingStart;

        scheduled.sort((a, b) => a.startTime.valueOf() - b.startTime.valueOf());
        scheduled.forEach(ev => {
          if (cursor.isBefore(ev.startTime)) {
            // 'Free' gap between events
            blocks.push({ id: makeId(cursor, ev.startTime, 'gap'), startTime: cursor, endTime: ev.startTime, title: 'Free', type: 'gap' });
          }
          blocks.push(ev);
          cursor = ev.endTime;
        });
        if (cursor.isBefore(wakingEnd)) {
          blocks.push({ id: makeId(cursor, wakingEnd, 'gap'), startTime: cursor, endTime: wakingEnd, title: 'Free', type: 'gap' });
        }

        sessions.forEach(ss => {
          const s = dayjs(ss.start_ms);
          const e = dayjs(ss.end_ms ?? wakingEnd.valueOf());
          const title = ss.subActivity ? `${ss.activity} / ${ss.subActivity}` : ss.activity;
          blocks = blocks.flatMap(b => {
            if (e.isBefore(b.startTime) || s.isAfter(b.endTime)) return [b];
            const out: DayjsTimeBlock[] = [];
            if (b.startTime.isBefore(s)) {
              out.push({ ...b, id: makeId(b.startTime, s, b.type), endTime: s });
            }
            const os = dayjs.max(b.startTime, s);
            const oe = dayjs.min(b.endTime, e);
            out.push({ 
              id: makeId(os, oe, 'logged'), 
              startTime: os, 
              endTime: oe, 
              title, 
              type: 'logged',
                // Use colors carried by the session (from activity_colors); fall back to defaults if absent
              color: (ss as any).color_hex,
              backgroundColor: (ss as any).background_color,
              textColor: (ss as any).text_color,
            });
            if (b.endTime.isAfter(e)) {
              out.push({ ...b, id: makeId(e, b.endTime, b.type), startTime: e });
            }
            return out;
          });
        });

        blocks.sort((a, b) => a.startTime.valueOf() - b.startTime.valueOf());


        // ==================== Filter out logged segments shorter than 1 minute ====================
        const MIN_DURATION_MS = 60 * 1000; // 1 minute
        blocks = blocks.filter(block => {
          const durationMs = block.endTime.valueOf() - block.startTime.valueOf();
          // Keep all non-logged blocks, and logged blocks >= 1 minute
          return block.type !== 'logged' || durationMs >= MIN_DURATION_MS;
        });
        // ====================================================================

        setTimeline(blocks);
        setHovered(null);
        setSelectedId(null);
      } catch (err) {
        console.error(err);
        setError('Failed to load data, please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndProcess();
  }, [isoDate, currentTimezone, settingsLoaded, settings, weeklySchedule, manualPlans]);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  const chartTimeline: ChartBlock[] = timeline.map(b => ({ 
    id: b.id, 
    startTime: b.startTime.toDate(), 
    endTime: b.endTime.toDate(), 
    type: b.type, 
    title: b.title,
    color: b.color,
    backgroundColor: b.backgroundColor,
    textColor: b.textColor
  }));
  const hoveredForChart: ChartBlock | null = hovered ? { 
    ...hovered, 
    startTime: hovered.startTime.toDate(), 
    endTime: hovered.endTime.toDate(),
    color: hovered.color,
    backgroundColor: hovered.backgroundColor,
    textColor: hovered.textColor
  } : null;

  const handleHover = (blk: ChartBlock | null) => {
    if (!blk) return setHovered(null);
    const found = timeline.find(b => b.id === blk.id);
    setHovered(found ?? null);
  };
  const handleSelect = (blk: ChartBlock | DayjsTimeBlock) => {
    // If the clicked block is already selected, deselect it
    if (selectedId === blk.id) {
      setSelectedId(null);
      setHovered(null);
    } else {
      setSelectedId(blk.id);
      const found = timeline.find(b => b.id === blk.id);
      setHovered(found ?? null);
    }
  };

  const listData = timeline.filter(b => b.type !== 'gap');

  return (
    <div className="stats-day-page">
      <div className="topbar">
        <div className="title-and-nav">
          <div className="day-navigation">
            <button 
              className="ghost-btn" 
              onClick={() => {
                const prevDay = dayjs(isoDate).subtract(1, 'day').format('YYYY-MM-DD');
                navigate(`/center/day/${prevDay}`);
              }}
            >
              ‹
            </button>
            <h1 className="page-title">
              {dayjs(isoDate).format('MMMM D, YYYY')} {' '}
              <span className="weekday">
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayjs(isoDate).day()]}
              </span>
              {/* Debug info: show which daily hours are used */}
              {settingsLoaded && (
                <small style={{ 
                  display: 'block', 
                  fontSize: '12px', 
                  opacity: 0.6, 
                  fontWeight: 'normal' 
                }}>
                  Daily hours: {settings.wakeTime || '08:00'} - {settings.sleepTime || '21:40'} 
                  | Timezone: {currentTimezone}
                </small>
              )}
            </h1>
            <button 
              className={`ghost-btn ${dayjs(isoDate).isSame(dayjs(), 'day') ? 'disabled' : ''}`}
              onClick={() => {
                if (!dayjs(isoDate).isSame(dayjs(), 'day')) {
                  const nextDay = dayjs(isoDate).add(1, 'day').format('YYYY-MM-DD');
                  navigate(`/center/day/${nextDay}`);
                }
              }}
              disabled={dayjs(isoDate).isSame(dayjs(), 'day')}
            >
              ›
            </button>
          </div>
        </div>
        <div className="modes">
          <label className={'mode ' + (mode === 'chartFirst' ? 'active' : '')} onClick={() => setMode('chartFirst')}>Simple</label>
          <label className={'mode ' + (mode === 'listFirst' ? 'active' : '')} onClick={() => setMode('listFirst')}>Detailed</label>
        </div>
      </div>
      <div
        className={
          'chart-container' + (mode === 'chartFirst' ? ' enlarged' : '')
        }
        style={{ 
          marginTop: mode === 'chartFirst' ? 70 : 12,  // adjust chart position for compact mode
        }}
      >
        <TimeArcChart
          timeline={chartTimeline}
          width={mode === 'chartFirst' ? 600 : 400}
          height={mode === 'chartFirst' ? 340 : 200}
          hoveredBlock={hoveredForChart}
          onHover={handleHover}
          onSelect={handleSelect}
          selectedId={selectedId}
        />
      </div>
      <div className="details-container" style={{ 
          marginTop: mode === 'chartFirst' ? 60 : 12  // adjust details area for compact mode
        }}>
        {mode === 'chartFirst' ? (
          hovered ? (
            <div 
              className={`time-block ${hovered.type}`}
              style={hovered.color ? {
                borderLeft: `6px solid ${hovered.color}`,
                backgroundColor: hexToRgba(hovered.color, 0.18) || 'transparent',
                color: 'inherit'
              } : {}}
            >
              <span className="time">{hovered.startTime.format('HH:mm')} - {hovered.endTime.format('HH:mm')}</span>
              <span className="title">{hovered.title}</span>
              <span 
                className="type-badge" 
                style={hovered.color ? {
                  backgroundColor: hexToRgba(hovered.color, 0.35) || hovered.color,
                  color: hovered.textColor || '#FFFFFF'
                } : {}}
              >
                {hovered.type}
              </span>
            </div>
          ) : (<div className="placeholder-text">Hover over the colored blocks in the chart above to see details</div>)
        ) : (
          <div className="rows">
            {listData.map(b => {
              const active = selectedId === b.id;
              const customStyle = b.color ? {
                borderLeft: `6px solid ${b.color}`,
                backgroundColor: 'transparent',
                color: 'inherit'
              } : {};
              
              const badgeStyle = b.color ? {
                backgroundColor: b.color,
                color: b.textColor || '#FFFFFF'
              } : {};
              
              return (
                <div 
                  key={b.id} 
                  className={`time-block ${b.type} ${active ? 'active' : ''}`} 
                  onClick={() => handleSelect(b)}
                  style={customStyle}
                >
                  <span className="time">{b.startTime.format('HH:mm')} - {b.endTime.format('HH:mm')}</span>
                  <span className="title">{b.title}</span>
                  <span className="type-badge" style={badgeStyle}>{b.type}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default StatsDay;