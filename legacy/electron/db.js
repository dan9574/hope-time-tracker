// electron/db.js
const Database = require('better-sqlite3');
const path = require('node:path');
const { app } = require('electron');

let db;
// 首启种子：预置 5 个活动及其颜色配置
function seedDefaults(database){
  try {
    const row = database.prepare("SELECT COUNT(1) AS c FROM activities").get();
    const cnt = row ? (row.c || 0) : 0;
    if (cnt > 0) return; // 非全新库，不做种子

    // Seed the DB with English activity names for new installations.
    // Existing databases with Chinese activity names are still supported by migration code below.
    const seedList = [
      { name: 'Study', color_hex: '#3B82F6', text_color: '#FFFFFF', background_color: null },
      { name: 'Exercise', color_hex: '#F97316', text_color: '#FFFFFF', background_color: null },
      { name: 'Gaming', color_hex: '#F8D7DA', text_color: '#721C24', background_color: null },
      { name: 'Class', color_hex: '#8B5CF6', text_color: '#FFFFFF', background_color: null },
      { name: 'Test', color_hex: '#F59E0B', text_color: '#FFFFFF', background_color: null },
    ];

    const insertAct = database.prepare('INSERT OR IGNORE INTO activities(name) VALUES (?)');
    const getAct = database.prepare('SELECT id FROM activities WHERE name = ?');
    const insertColor = database.prepare(
      'INSERT OR IGNORE INTO activity_colors (activity_id, color_hex, background_color, text_color) VALUES (?,?,?,?)'
    );

    const tx = database.transaction(() => {
      seedList.forEach(s => {
        insertAct.run(s.name);
        const a = getAct.get(s.name);
        if (a && a.id) {
          insertColor.run(a.id, s.color_hex, s.background_color, s.text_color);
        }
      });
    });
    tx();
  } catch (e) {
    console.error('Seed defaults failed:', e?.message || e);
  }
}
const sql = {
  create: `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS activities(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS sub_activities(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(activity_id, name),
      FOREIGN KEY(activity_id) REFERENCES activities(id)
    );
    CREATE TABLE IF NOT EXISTS sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER,
      sub_activity_id INTEGER,
      note TEXT DEFAULT '',
      start_ms INTEGER NOT NULL,
      end_ms INTEGER,
      duration_ms INTEGER,
      FOREIGN KEY(activity_id) REFERENCES activities(id),
      FOREIGN KEY(sub_activity_id) REFERENCES sub_activities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_ms);
    
    -- 作息时间设置表（按日期生效）
    CREATE TABLE IF NOT EXISTS daily_schedule_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_date TEXT NOT NULL,  -- 生效日期 YYYY-MM-DD
      wake_time TEXT NOT NULL,       -- 08:00
      sleep_time TEXT NOT NULL,      -- 21:40
      timezone TEXT,                 -- PST/Beijing
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_date ON daily_schedule_settings(effective_date);
    
    -- 每周计划表（按日期生效）
    CREATE TABLE IF NOT EXISTS weekly_schedule_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_date TEXT NOT NULL,  -- 生效日期
      day_of_week INTEGER NOT NULL,  -- 0-6 (0=周日)
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      activity_id INTEGER NOT NULL,  -- 关联到activities表
      sub_activity_id INTEGER,       -- 关联到sub_activities表（可选）
      title TEXT,                    -- 保留用于兼容性（逐步废弃）
      subtitle TEXT,                 -- 保留用于兼容性（逐步废弃）
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY(activity_id) REFERENCES activities(id),
      FOREIGN KEY(sub_activity_id) REFERENCES sub_activities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_weekly_schedule ON weekly_schedule_events(effective_date, day_of_week);
    
    -- 手动学习计划表
    CREATE TABLE IF NOT EXISTS manual_study_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_date TEXT NOT NULL,      -- 计划日期 YYYY-MM-DD
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      activity_id INTEGER NOT NULL, -- 关联到activities表
      sub_activity_id INTEGER,      -- 关联到sub_activities表（可选）
      subject TEXT,                 -- 保留用于兼容性（逐步废弃）
      subcategory TEXT,             -- 保留用于兼容性（逐步废弃）
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY(activity_id) REFERENCES activities(id),
      FOREIGN KEY(sub_activity_id) REFERENCES sub_activities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_manual_plans_date_time ON manual_study_plans(plan_date, start_time, end_time);
    
    -- 每日实例化计划表（从每周计划复制来的当天计划）
    CREATE TABLE IF NOT EXISTS daily_instantiated_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_date TEXT NOT NULL,      -- 计划日期 YYYY-MM-DD
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      activity_id INTEGER NOT NULL, -- 关联到activities表
      sub_activity_id INTEGER,      -- 关联到sub_activities表（可选）
      title TEXT,                   -- 保留用于兼容性
      subtitle TEXT,                -- 保留用于兼容性
      source TEXT DEFAULT 'weekly', -- 来源: 'weekly' 或 'manual'
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY(activity_id) REFERENCES activities(id),
      FOREIGN KEY(sub_activity_id) REFERENCES sub_activities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_plans_date_time ON daily_instantiated_plans(plan_date, start_time, end_time);
    
    -- 活动颜色配置表
    CREATE TABLE IF NOT EXISTS activity_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL UNIQUE,
      color_hex TEXT NOT NULL DEFAULT '#3B82F6',  -- 默认蓝色
      background_color TEXT DEFAULT NULL,         -- 背景色（可选）
      text_color TEXT DEFAULT '#FFFFFF',          -- 文本色
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_activity_colors ON activity_colors(activity_id);
    
    -- 短信板：纯文本日记/消息表
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_date TEXT NOT NULL,          -- YYYY-MM-DD（按应用时区）
      created_ms INTEGER NOT NULL,     -- 创建时间戳（毫秒）
      content TEXT NOT NULL,           -- 文本内容
      edited_ms INTEGER                -- 编辑时间（毫秒，可空）
    );
    CREATE INDEX IF NOT EXISTS idx_journal_day ON journal_entries(day_date);
    CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_ms);
  `,
  // Database migration: add is_manual field to sessions table
  migrateIsManual: `
    PRAGMA table_info(sessions);
  `,
  addIsManualColumn: `
    ALTER TABLE sessions ADD COLUMN is_manual INTEGER DEFAULT 0;
  `,
  
  // 数据库迁移：为每周计划表添加activity关联字段
  migrateWeeklySchedule: `
    PRAGMA table_info(weekly_schedule_events);
  `,
  addActivityFieldsToWeeklySchedule: `
    ALTER TABLE weekly_schedule_events ADD COLUMN activity_id INTEGER;
    ALTER TABLE weekly_schedule_events ADD COLUMN sub_activity_id INTEGER;
  `,
  
  // 数据库迁移：为每日计划表添加activity关联字段
  migrateDailyPlans: `
    PRAGMA table_info(daily_instantiated_plans);
  `,
  addActivityFieldsToDailyPlans: `
    ALTER TABLE daily_instantiated_plans ADD COLUMN activity_id INTEGER;
    ALTER TABLE daily_instantiated_plans ADD COLUMN sub_activity_id INTEGER;
  `,
  listActivities: `SELECT id,name FROM activities ORDER BY name;`,
  listAllSubActivities: `
    SELECT sa.id, sa.activity_id as activityId, sa.name
    FROM sub_activities sa ORDER BY sa.name;
  `,
  listSubActivitiesByAct: `
    SELECT sa.id, sa.activity_id as activityId, sa.name
    FROM sub_activities sa WHERE sa.activity_id = ? ORDER BY sa.name;
  `,
  insertActivityIgnore: `INSERT OR IGNORE INTO activities(name) VALUES(?);`,
  getActivityIdByName:  `SELECT id FROM activities WHERE name=?;`,

  insertSubIgnore:      `INSERT OR IGNORE INTO sub_activities(activity_id,name) VALUES(?,?);`,
  getSubIdByActAndName: `SELECT id FROM sub_activities WHERE activity_id=? AND name=?;`,
    startSession: `INSERT INTO sessions(activity_id,sub_activity_id,note,start_ms) VALUES(?,?,?,?);`,
  insertManualSession: `INSERT INTO sessions(activity_id,sub_activity_id,note,start_ms,end_ms,duration_ms,is_manual) VALUES(?,?,?,?,?,?,1);`,
  getRunning: `SELECT * FROM sessions WHERE end_ms IS NULL ORDER BY id DESC LIMIT 1;`,
  stopSession: `UPDATE sessions SET end_ms=?, duration_ms=? WHERE id=?;`,
  getToday: `
    WITH range AS (
      SELECT strftime('%s','now','start of day')*1000 AS start_ms,
             strftime('%s','now','start of day','+1 day')*1000 AS end_ms
    )
    SELECT COALESCE(a.name,'(未选活动)') as activity,
           sa.name as subActivity,
           SUM(CASE WHEN s.end_ms IS NULL THEN 0 ELSE s.duration_ms END) AS millis
    FROM sessions s
    LEFT JOIN activities a ON a.id = s.activity_id
    LEFT JOIN sub_activities sa ON sa.id = s.sub_activity_id, range r
    WHERE s.start_ms >= r.start_ms AND COALESCE(s.end_ms, r.end_ms) <= r.end_ms
    GROUP BY activity, subActivity
    HAVING millis > 0
    ORDER BY millis DESC;
  `,
  
  // ==================== 修改开始 ====================
  getDay: `
    SELECT 
      s.id, 
      a.name as activity, 
      sa.name as subActivity, 
      s.note, 
      s.start_ms, 
      s.end_ms, 
      s.duration_ms,
      ac.color_hex as color_hex,
      ac.text_color as text_color,
      ac.background_color as background_color
    FROM sessions s
    LEFT JOIN activities a ON a.id=s.activity_id
    LEFT JOIN sub_activities sa ON sa.id=s.sub_activity_id
    LEFT JOIN activity_colors ac ON ac.activity_id = a.id
    WHERE strftime('%Y-%m-%d', s.start_ms / 1000, 'unixepoch', ?) = ?
    ORDER BY s.start_ms ASC;
  `,
  // ==================== 修改结束 ====================

  getMonthSummary: `
    WITH r AS (
      SELECT strftime('%s',?||'-01 00:00:00')*1000 AS start_ms,
             strftime('%s',?||'-01 00:00:00','start of month','+1 month')*1000 AS end_ms
    )
    SELECT COALESCE(a.name,'(未选活动)') || ' / ' || COALESCE(sa.name,'(无子类)') AS key,
           SUM(COALESCE(s.duration_ms,0)) AS millis
    FROM sessions s
    LEFT JOIN activities a ON a.id=s.activity_id
    LEFT JOIN sub_activities sa ON sa.id=s.sub_activity_id, r
    WHERE s.start_ms >= r.start_ms AND COALESCE(s.end_ms, r.end_ms) <= r.end_ms
    GROUP BY key
    ORDER BY millis DESC;
  `,
  getDaysWithDataInMonth: `
    WITH r AS (
      SELECT strftime('%s',?||'-01 00:00:00')*1000 AS start_ms,
             strftime('%s',?||'-01 00:00:00','start of month','+1 month')*1000 AS end_ms
    )
    SELECT DISTINCT strftime('%Y-%m-%d', s.start_ms / 1000, 'unixepoch') AS day
    FROM sessions s, r
    WHERE s.start_ms >= r.start_ms AND s.start_ms < r.end_ms;
  `,

  deleteActivity: `DELETE FROM activities WHERE id=?;`,
  deleteSubActivitiesByAct: `DELETE FROM sub_activities WHERE activity_id=?;`,
  deleteSubActivity: `DELETE FROM sub_activities WHERE id=?;`,
  hasSessionsForActivity: `
    SELECT
      (SELECT COUNT(*) FROM sessions WHERE activity_id = ?) +
      (SELECT COUNT(*) FROM sessions
         WHERE sub_activity_id IN (SELECT id FROM sub_activities WHERE activity_id=?)
      ) AS cnt;
  `,
  hasSessionsForSub: `SELECT COUNT(*) AS cnt FROM sessions WHERE sub_activity_id = ?;`,
  
  // 手动学习记录相关查询
  getManualRecords: `
    SELECT 
      s.id,
      s.start_ms,
      s.end_ms,
      s.duration_ms,
      s.note,
      a.name as activity_name,
      sa.name as sub_activity_name,
      date(s.start_ms/1000, 'unixepoch', 'localtime') as record_date,
      time(s.start_ms/1000, 'unixepoch', 'localtime') as start_time,
      time(s.end_ms/1000, 'unixepoch', 'localtime') as end_time
    FROM sessions s
    LEFT JOIN activities a ON s.activity_id = a.id
    LEFT JOIN sub_activities sa ON s.sub_activity_id = sa.id
    WHERE s.is_manual = 1
    ORDER BY s.start_ms DESC
    LIMIT ? OFFSET ?;
  `,
  
  getManualRecordsCount: `
    SELECT COUNT(*) as total FROM sessions WHERE is_manual = 1;
  `,
  
  deleteManualRecord: `
    DELETE FROM sessions WHERE id = ? AND is_manual = 1;
  `,
  
  // 获取特定日期的手动会话记录，用于统计页面
  getManualSessionsForDate: `
    SELECT 
      s.id,
      s.activity_id,
      s.sub_activity_id,
      s.start_ms,
      s.end_ms,
      s.duration_ms,
      s.note,
      a.name as activity_name,
      sa.name as sub_activity_name,
      ac.color_hex,
      ac.background_color,
      ac.text_color,
      time(s.start_ms/1000, 'unixepoch', 'localtime') as start_time,
      time(s.end_ms/1000, 'unixepoch', 'localtime') as end_time
    FROM sessions s
    LEFT JOIN activities a ON s.activity_id = a.id
    LEFT JOIN sub_activities sa ON s.sub_activity_id = sa.id
    LEFT JOIN activity_colors ac ON a.id = ac.activity_id
    WHERE s.is_manual = 1 
      AND date(s.start_ms/1000, 'unixepoch', 'localtime') = ?
    ORDER BY s.start_ms;
  `,
  
  // 作息时间设置相关
  insertScheduleSettings: `
    INSERT INTO daily_schedule_settings (effective_date, wake_time, sleep_time, timezone) 
    VALUES (?, ?, ?, ?);
  `,
  getScheduleSettingsForDate: `
    SELECT wake_time, sleep_time, timezone 
    FROM daily_schedule_settings 
    WHERE effective_date <= ? 
    ORDER BY effective_date DESC 
    LIMIT 1;
  `,
  
  // 每周计划相关
  insertWeeklyEvent: `
    INSERT INTO weekly_schedule_events (effective_date, day_of_week, start_time, end_time, activity_id, sub_activity_id, title, subtitle)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `,
  getWeeklyEventsForDate: `
    SELECT wse.day_of_week, wse.start_time, wse.end_time, 
           wse.activity_id, wse.sub_activity_id,
           wse.title, wse.subtitle, wse.effective_date,
           a.name as activity_name, sa.name as sub_activity_name
    FROM weekly_schedule_events wse
    LEFT JOIN activities a ON wse.activity_id = a.id
    LEFT JOIN sub_activities sa ON wse.sub_activity_id = sa.id
    WHERE wse.effective_date = (
      SELECT MAX(effective_date) FROM weekly_schedule_events
    )
    ORDER BY wse.start_time ASC;
  `,
  getWeeklyTemplate: `
    SELECT wse.day_of_week, wse.start_time, wse.end_time, 
           wse.activity_id, wse.sub_activity_id,
           wse.title, wse.subtitle, wse.effective_date,
           a.name as activity_name, sa.name as sub_activity_name
    FROM weekly_schedule_events wse
    LEFT JOIN activities a ON wse.activity_id = a.id
    LEFT JOIN sub_activities sa ON wse.sub_activity_id = sa.id
    WHERE wse.effective_date = (
      SELECT MAX(effective_date) FROM weekly_schedule_events
    )
    ORDER BY wse.start_time ASC;
  `,
  // 最新每周计划模板（附带颜色），用于历史日期的回退展示
  getWeeklyTemplateWithColors: `
    SELECT 
      wse.day_of_week, wse.start_time, wse.end_time,
      wse.activity_id, wse.sub_activity_id,
      wse.title, wse.subtitle, wse.effective_date,
      a.name as activity_name, sa.name as sub_activity_name,
      ac.color_hex, ac.background_color, ac.text_color
    FROM weekly_schedule_events wse
    LEFT JOIN activities a ON wse.activity_id = a.id
    LEFT JOIN sub_activities sa ON wse.sub_activity_id = sa.id
    LEFT JOIN activity_colors ac ON ac.activity_id = wse.activity_id
    WHERE wse.effective_date = (
      SELECT MAX(effective_date) FROM weekly_schedule_events
    )
    ORDER BY wse.start_time ASC;
  `,
  deleteWeeklyEventsFromDate: `
    DELETE FROM weekly_schedule_events 
    WHERE effective_date >= ? AND day_of_week = ?;
  `,
  
  // 手动学习计划相关
  insertManualPlan: `
    INSERT INTO manual_study_plans (plan_date, start_time, end_time, subject, subcategory)
    VALUES (?, ?, ?, ?, ?);
  `,
  getManualPlans: `
    SELECT id, plan_date, start_time, end_time, subject, subcategory, created_at
    FROM manual_study_plans
    ORDER BY plan_date DESC, start_time ASC
    LIMIT ? OFFSET ?;
  `,
  getManualPlansCount: `
    SELECT COUNT(*) as total FROM manual_study_plans;
  `,
  getManualPlansForDate: `
    SELECT msp.*, 
           COALESCE(a.name, msp.subject) as activity_name,
           COALESCE(sa.name, msp.subcategory) as sub_activity_name,
           a.name as activity_name_clean,
           sa.name as sub_activity_name_clean,
           COALESCE(ac.color_hex, '#3B82F6') as color_hex,
           COALESCE(ac.background_color, NULL) as background_color,
           COALESCE(ac.text_color, '#FFFFFF') as text_color
    FROM manual_study_plans msp
    LEFT JOIN activities a ON msp.activity_id = a.id
    LEFT JOIN sub_activities sa ON msp.sub_activity_id = sa.id
    LEFT JOIN activity_colors ac ON msp.activity_id = ac.activity_id
    WHERE msp.plan_date = ?
    ORDER BY msp.start_time ASC;
  `,
  deleteManualPlan: `
    DELETE FROM manual_study_plans WHERE id = ?;
  `,
  
  // 每日实例化计划相关
  getDailyPlansForDate: `
    SELECT dip.id, dip.plan_date, dip.start_time, dip.end_time, 
           dip.activity_id, dip.sub_activity_id,
           dip.title, dip.subtitle, dip.source, dip.created_at,
           a.name as activity_name, sa.name as sub_activity_name
    FROM daily_instantiated_plans dip
    LEFT JOIN activities a ON dip.activity_id = a.id
    LEFT JOIN sub_activities sa ON dip.sub_activity_id = sa.id
    WHERE dip.plan_date = ?
    ORDER BY dip.start_time ASC;
  `,
  insertDailyPlan: `
    INSERT INTO daily_instantiated_plans (plan_date, start_time, end_time, activity_id, sub_activity_id, title, subtitle, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `,
  deleteDailyPlansForDate: `
    DELETE FROM daily_instantiated_plans WHERE plan_date = ?;
  `,
  checkDailyPlansExist: `
    SELECT COUNT(*) as count FROM daily_instantiated_plans WHERE plan_date = ?;
  `,
  
  // 颜色配置相关查询
  getActivityColors: `
    SELECT ac.*, a.name as activity_name 
    FROM activity_colors ac
    LEFT JOIN activities a ON ac.activity_id = a.id
    ORDER BY a.name ASC;
  `,
  getActivityColor: `
    SELECT * FROM activity_colors WHERE activity_id = ?;
  `,
  upsertActivityColor: `
    INSERT INTO activity_colors (activity_id, color_hex, background_color, text_color, updated_at)
    VALUES (?, ?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(activity_id) DO UPDATE SET
      color_hex = excluded.color_hex,
      background_color = excluded.background_color,
      text_color = excluded.text_color,
      updated_at = excluded.updated_at;
  `,
  getActivitiesWithColors: `
    SELECT a.*, 
           COALESCE(ac.color_hex, '#3B82F6') as color_hex,
           COALESCE(ac.background_color, NULL) as background_color,
           COALESCE(ac.text_color, '#FFFFFF') as text_color
    FROM activities a
    LEFT JOIN activity_colors ac ON a.id = ac.activity_id
    ORDER BY a.name ASC;
  `,
  getDailyPlansWithColors: `
    SELECT dip.*, 
           COALESCE(a.name, dip.title) as display_title,
           COALESCE(sa.name, dip.subtitle) as display_subtitle,
           a.name as activity_name,
           sa.name as sub_activity_name,
           COALESCE(ac.color_hex, '#3B82F6') as color_hex,
           COALESCE(ac.background_color, NULL) as background_color,
           COALESCE(ac.text_color, '#FFFFFF') as text_color
    FROM daily_instantiated_plans dip
    LEFT JOIN activities a ON dip.activity_id = a.id
    LEFT JOIN sub_activities sa ON dip.sub_activity_id = sa.id
    LEFT JOIN activity_colors ac ON dip.activity_id = ac.activity_id
    WHERE dip.plan_date = ?
    ORDER BY dip.start_time ASC;
  `,
  // 月度范围：获取每日实例化计划（带颜色信息）
  getDailyPlansInRangeWithColors: `
    SELECT dip.*, 
           COALESCE(a.name, dip.title) as activity_name,
           COALESCE(sa.name, dip.subtitle) as sub_activity_name,
           COALESCE(ac.color_hex, '#3B82F6') as color_hex,
           COALESCE(ac.background_color, NULL) as background_color,
           COALESCE(ac.text_color, '#FFFFFF') as text_color
    FROM daily_instantiated_plans dip
    LEFT JOIN activities a ON dip.activity_id = a.id
    LEFT JOIN sub_activities sa ON dip.sub_activity_id = sa.id
    LEFT JOIN activity_colors ac ON dip.activity_id = ac.activity_id
    WHERE dip.plan_date >= ? AND dip.plan_date < ?
    ORDER BY dip.plan_date ASC, dip.start_time ASC;
  `,
  
  // 通过活动名称获取颜色（用于兼容旧数据、回填颜色）
  getActivityColorByName: `
    SELECT a.id as activity_id,
           a.name as activity_name,
           ac.color_hex,
           ac.background_color,
           ac.text_color
    FROM activities a
    LEFT JOIN activity_colors ac ON ac.activity_id = a.id
    WHERE a.name = ?
    LIMIT 1;
  `,
  
  // 短信板相关 SQL
  insertJournalEntry: `
    INSERT INTO journal_entries(day_date, created_ms, content, edited_ms)
    VALUES (?, ?, ?, NULL);
  `,
  // 获取最近的消息（按创建时间倒序）；beforeMs 为上界游标，null 则不过滤
  getJournalRecent: `
    SELECT id, day_date, created_ms, content, edited_ms
    FROM journal_entries
    WHERE created_ms < COALESCE(?, 9223372036854775807)
    ORDER BY created_ms DESC
    LIMIT ?;
  `,
  // 获取某一天的全部消息（正序）
  getJournalByDay: `
    SELECT id, day_date, created_ms, content, edited_ms
    FROM journal_entries
    WHERE day_date = ?
    ORDER BY created_ms ASC;
  `,
  updateJournalEntry: `
    UPDATE journal_entries SET content = ?, edited_ms = ? WHERE id = ?;
  `,
  deleteJournalEntry: `
    DELETE FROM journal_entries WHERE id = ?;
  `,
  getJournalDaysInMonth: `
    SELECT DISTINCT day_date FROM journal_entries
    WHERE substr(day_date,1,7) = ?
    ORDER BY day_date DESC;
  `,
  
  // --- Developer tools: sessions operations ---
  devListSessions: `
    SELECT s.id, s.activity_id, s.sub_activity_id, s.start_ms, s.end_ms, s.duration_ms, s.is_manual, s.note,
           a.name AS activity_name, sa.name AS sub_activity_name
    FROM sessions s
    LEFT JOIN activities a ON a.id = s.activity_id
    LEFT JOIN sub_activities sa ON sa.id = s.sub_activity_id
    ORDER BY s.id DESC
    LIMIT ? OFFSET ?;
  `,
  devCountSessions: `
    SELECT COUNT(*) AS total FROM sessions;
  `,
  devDeleteSessionsByIds: `
    DELETE FROM sessions WHERE id IN (__IDS_PLACEHOLDER__);
  `,
  devDeleteAllSessions: `
    DELETE FROM sessions;
  `,
};

async function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'timeglass.db');
  db = new Database(dbPath);
  db.exec(sql.create);
  // 首启：插入 5 个默认活动及其颜色
  seedDefaults(db);
  
  // 执行数据库迁移：检查sessions表是否有is_manual列
  try {
    const tableInfo = db.prepare("PRAGMA table_info(sessions)").all();
    const hasIsManualColumn = tableInfo.some(col => col.name === 'is_manual');
    
    if (!hasIsManualColumn) {
      console.log('Adding is_manual column to sessions table...');
      db.exec(sql.addIsManualColumn);
      console.log('Migration completed.');
    }
  } catch (err) {
    console.log('Migration check failed:', err.message);
  }
  
  // 执行数据库迁移：检查weekly_schedule_events表是否有activity字段
  try {
    const weeklyTableInfo = db.prepare("PRAGMA table_info(weekly_schedule_events)").all();
    const hasActivityIdColumn = weeklyTableInfo.some(col => col.name === 'activity_id');
    
    if (!hasActivityIdColumn) {
      console.log('Adding activity fields to weekly_schedule_events table...');
      db.exec(sql.addActivityFieldsToWeeklySchedule);
      console.log('Weekly schedule migration completed.');
    }
  } catch (err) {
    console.log('Weekly schedule migration check failed:', err.message);
  }
  
  // 执行数据库迁移：检查daily_instantiated_plans表是否有activity字段
  try {
    const dailyTableInfo = db.prepare("PRAGMA table_info(daily_instantiated_plans)").all();
    const hasActivityIdColumn = dailyTableInfo.some(col => col.name === 'activity_id');
    
    if (!hasActivityIdColumn) {
      console.log('Adding activity fields to daily_instantiated_plans table...');
      db.exec(sql.addActivityFieldsToDailyPlans);
      console.log('Daily plans migration completed.');
    }
  } catch (err) {
    console.log('Daily plans migration check failed:', err.message);
  }
  
  // 执行数据库迁移：检查activity_colors表是否存在（用于老版本升级）
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_colors'").all();
    
    if (tables.length === 0) {
      console.log('Creating activity_colors table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS activity_colors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          activity_id INTEGER NOT NULL UNIQUE,
          color_hex TEXT NOT NULL DEFAULT '#3B82F6',
          background_color TEXT DEFAULT NULL,
          text_color TEXT DEFAULT '#FFFFFF',
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_activity_colors ON activity_colors(activity_id);
      `);
      
      // 为现有活动添加默认颜色
      const activities = db.prepare('SELECT id, name FROM activities').all();
      // Default color mapping for activities (English keys). These correspond to the
      // five activities seeded for new installations.
      const defaultColors = {
        'Study': '#3B82F6',     // blue
        'Exercise': '#F97316',  // orange
        'Gaming': '#F8D7DA',    // light pink
        'Class': '#8B5CF6',     // purple
        'Test': '#F59E0B',      // orange
      };
      
      const insertColor = db.prepare(`
        INSERT INTO activity_colors (activity_id, color_hex) VALUES (?, ?)
      `);
      
      activities.forEach(activity => {
        // Map colors using English activity names; fallback to gray if unknown.
        const color = defaultColors[activity.name] || '#6B7280';
        insertColor.run(activity.id, color);
        console.log(`Added default color ${color} for activity: ${activity.name}`);
      });
      
      console.log('Activity colors migration completed.');
    }
  } catch (migrationError) {
    console.error('Activity colors migration failed:', migrationError.message);
  }
  
  // 执行数据库迁移：检查manual_study_plans表是否有activity_id字段
  try {
    const manualTableInfo = db.prepare("PRAGMA table_info(manual_study_plans)").all();
    const hasActivityIdColumn = manualTableInfo.some(col => col.name === 'activity_id');
    
    if (!hasActivityIdColumn) {
      console.log('Adding activity fields to manual_study_plans table...');
      db.exec(`
        ALTER TABLE manual_study_plans ADD COLUMN activity_id INTEGER;
        ALTER TABLE manual_study_plans ADD COLUMN sub_activity_id INTEGER;
      `);
      
      // 为现有的手动学习记录创建对应的活动
      const existingPlans = db.prepare('SELECT DISTINCT subject FROM manual_study_plans WHERE subject IS NOT NULL').all();
      const insertActivity = db.prepare('INSERT OR IGNORE INTO activities(name) VALUES (?)');
      const getActivityId = db.prepare('SELECT id FROM activities WHERE name = ?');
      const updatePlan = db.prepare('UPDATE manual_study_plans SET activity_id = ? WHERE subject = ? AND activity_id IS NULL');
      
      existingPlans.forEach(plan => {
        insertActivity.run(plan.subject);
        const activity = getActivityId.get(plan.subject);
        if (activity) {
          updatePlan.run(activity.id, plan.subject);
          console.log(`Migrated manual plans for activity: ${plan.subject}`);
        }
      });
      
      console.log('Manual study plans migration completed.');
    }
  } catch (migrationError) {
    console.error('Manual study plans migration failed:', migrationError.message);
  }
  
  // 可选：保留示例子活动（仅在存在“学习”时插入，不影响首次种子）
  const rowLearn = db.prepare(`SELECT id FROM activities WHERE name='学习'`).get();
  if (rowLearn && rowLearn.id) {
    db.prepare(`INSERT OR IGNORE INTO sub_activities(activity_id,name) VALUES (?,?), (?,?)`)
      .run(rowLearn.id, '数学作业', rowLearn.id, 'CS作业');
  }
}

module.exports = { initDB, db: () => db, sql };