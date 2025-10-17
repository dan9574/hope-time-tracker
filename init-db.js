const Database = require('better-sqlite3');
const db = new Database('./data.db');

// 初始化数据库
const sql = `
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
  subject TEXT NOT NULL,        -- 项目/学科
  subcategory TEXT,             -- 子类（可为空）
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
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
`;

try {
  db.exec(sql);
  console.log('✅ 数据库初始化成功');
  
  // Insert some sample data
  const activities = [
    'Class',
    'Test',
    'SelfStudy',
    'Review'
  ];
  
  const insertActivity = db.prepare('INSERT OR IGNORE INTO activities(name) VALUES(?)');
  activities.forEach(activity => {
    insertActivity.run(activity);
    console.log(`✅ 添加活动: ${activity}`);
  });
  
  // Add some sample sub-activities (mapped to the first seeded activities)
  const insertSubActivity = db.prepare('INSERT OR IGNORE INTO sub_activities(activity_id, name) VALUES(?, ?)');
  insertSubActivity.run(1, 'Math'); // Class -> Math
  insertSubActivity.run(1, 'English'); // Class -> English
  insertSubActivity.run(2, 'Math Quiz'); // Test -> Math Quiz
  insertSubActivity.run(2, 'English Quiz'); // Test -> English Quiz
  
  console.log('✅ Sample data inserted');
  
} catch (error) {
  console.error('❌ 数据库初始化失败:', error);
} finally {
  db.close();
}