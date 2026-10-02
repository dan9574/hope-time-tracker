// electron/main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { initDB, db, sql } = require('./db.js');

let win = null;
const isDev = !app.isPackaged;
let store;

// 记录进入 HUD 前的窗口状态，用于恢复
let prevState = null;

// -------- 时区与日期辅助函数 ----------
function getAppTimezone() {
  try {
    const todaySys = new Date().toISOString().split('T')[0];
    const row = db().prepare(sql.getScheduleSettingsForDate).get(todaySys);
    return row?.timezone || 'PST';
  } catch {
    return 'PST';
  }
}

function resolveIanaTZ(tz) {
  // 将应用内的简写映射为 IANA 时区标识
  if (tz === 'Beijing') return 'Asia/Shanghai';
  return 'America/Los_Angeles'; // 默认为 PST
}

// 获取“应用时区”下的今天日期（YYYY-MM-DD）
function getDateInAppTZ() {
  const tz = getAppTimezone();
  const iana = resolveIanaTZ(tz);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: iana,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const yyyy = parts.find(p => p.type === 'year')?.value ?? '1970';
  const mm = parts.find(p => p.type === 'month')?.value ?? '01';
  const dd = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${yyyy}-${mm}-${dd}`;
}

// -------- Manual study plans migration function ----------
function migrateManualStudyPlans() {
  try {
  console.log('🔄 Starting migration of manual study plans...');
    
    // 检查 manual_study_plans 表是否已有 activity_id 列
    const columns = db().prepare("PRAGMA table_info(manual_study_plans)").all();
    const hasActivityId = columns.some(col => col.name === 'activity_id');
    
    if (!hasActivityId) {
  console.log('📝 Adding activity_id and sub_activity_id columns...');
      db().exec(`
        ALTER TABLE manual_study_plans ADD COLUMN activity_id INTEGER;
        ALTER TABLE manual_study_plans ADD COLUMN sub_activity_id INTEGER;
      `);
    }
    
  // Inspect records that need migration
    const unmigratedPlans = db().prepare("SELECT * FROM manual_study_plans WHERE activity_id IS NULL").all();
    
    if (unmigratedPlans.length === 0) {
  console.log('✅ All manual study plans migrated');
      return;
    }
    
  console.log(`📊 Found ${unmigratedPlans.length} records that need migration`);
    
    // 获取现有活动和子活动
    const activities = db().prepare("SELECT * FROM activities").all();
    const subActivities = db().prepare("SELECT * FROM sub_activities").all();
    
    let migratedCount = 0;
    
    for (const plan of unmigratedPlans) {
      // 查找匹配的活动
      const activity = activities.find(a => a.name === plan.subject);
      
      if (activity) {
        let subActivityId = null;
        
        if (plan.subcategory) {
          const subActivity = subActivities.find(s => 
            s.name === plan.subcategory && s.activity_id === activity.id
          );
          if (subActivity) {
            subActivityId = subActivity.id;
          }
        }
        
        // 更新记录
        db().prepare(`
          UPDATE manual_study_plans 
          SET activity_id = ?, sub_activity_id = ? 
          WHERE id = ?
        `).run(activity.id, subActivityId, plan.id);
        
        migratedCount++;
  console.log(`✅ Migrated: ${plan.subject}${plan.subcategory ? ' / ' + plan.subcategory : ''} -> activity ID ${activity.id}`);
      } else {
        console.log(`⚠️ 未找到匹配的活动: ${plan.subject}`);
      }
    }
    
  console.log(`🎉 Migration complete! Migrated ${migratedCount} records`);
    
  } catch (error) {
  console.error('❌ Migration failed:', error);
  }
}

async function createWindow() {
  const { default: Store } = await import('electron-store');
  store = new Store();

  await initDB();
  migrateManualStudyPlans(); // 运行迁移
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 820,
    minHeight: 560,
    frame: false,
    transparent: true,
    hasShadow: false, // avoid rectangular OS shadow that breaks rounded-corner look
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (isDev) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.resolve(__dirname, '../dist/index.html');
    await win.loadFile(indexHtml);
  }
}

ipcMain.handle('hud:enter', (_e, opts = {}) => {
  if (!win) return;
  const { width = 460, height = 160 } = opts;
  if (!prevState) {
    prevState = {
      bounds: win.getBounds(),
      isMaximized: win.isMaximized(),
      alwaysOnTop: win.isAlwaysOnTop ? win.isAlwaysOnTop() : false,
      minSize: win.getMinimumSize ? win.getMinimumSize() : [820, 560],
      resizable: win.isResizable ? win.isResizable() : true,
    };
  }
  if (win.isMaximized()) win.unmaximize();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMinimumSize(320, 120);
  win.setResizable(true);
  win.setSize(width, height, true);
});

ipcMain.handle('hud:leave', () => {
  if (!win || !prevState) return;
  win.setAlwaysOnTop(!!prevState.alwaysOnTop);
  if (prevState.minSize && prevState.minSize.length === 2) {
    win.setMinimumSize(prevState.minSize[0], prevState.minSize[1]);
  }
  win.setResizable(!!prevState.resizable);
  if (prevState.isMaximized) {
    win.maximize();
  } else if (prevState.bounds) {
    win.setBounds(prevState.bounds);
  }
  prevState = null;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() });

ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:toggleMaximize', () => {
  if (!win) return false;
  if (win.isMaximized()) { win.unmaximize(); return false; }
  win.maximize(); return true;
});
ipcMain.handle('win:isMaximized', () => win ? win.isMaximized() : false);
ipcMain.handle('win:close', () => win && win.close());

// -------- 数据库 IPC ----------
ipcMain.handle('listActivities', () => db().prepare(sql.listActivities).all());
ipcMain.handle('listActivitiesWithColors', () => db().prepare(sql.getActivitiesWithColors).all());
ipcMain.handle('listSubActivities', (_e, activityId) =>
  activityId == null
    ? db().prepare(sql.listAllSubActivities).all()
    : db().prepare(sql.listSubActivitiesByAct).all(activityId)
);

// -------- 颜色管理 IPC ----------
ipcMain.handle('getActivityColors', () => db().prepare(sql.getActivityColors).all());
ipcMain.handle('getActivityColor', (_e, activityId) => db().prepare(sql.getActivityColor).get(activityId));
ipcMain.handle('saveActivityColor', (_e, activityId, colorHex, backgroundColor, textColor) => {
  try {
    db().prepare(sql.upsertActivityColor).run(activityId, colorHex, backgroundColor, textColor);
    return { success: true };
  } catch (error) {
    console.error('Save activity color failed:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('deleteActivity', (_e, activityId) => {
  const ref = db().prepare(sql.hasSessionsForActivity).get(activityId, activityId);
  if (ref && ref.cnt > 0) {
    return { ok:false, reason: '该主类或其子类已在会话历史中被引用，不能删除。' };
  }
  db().prepare(sql.deleteSubActivitiesByAct).run(activityId);
  db().prepare(sql.deleteActivity).run(activityId);
  return { ok:true };
});
ipcMain.handle('deleteSubActivity', (_e, subId) => {
  const ref = db().prepare(sql.hasSessionsForSub).get(subId);
  if (ref && ref.cnt > 0) {
    return { ok:false, reason: '该子类已在会話历史中被引用，不能删除。' };
  }
  db().prepare(sql.deleteSubActivity).run(subId);
  return { ok:true };
});
ipcMain.handle('startSession', (_e, payload) => {
  const running = db().prepare(sql.getRunning).get();
  if (running) {
    const endMs = Date.now();
    db().prepare(sql.stopSession).run(endMs, endMs - running.start_ms, running.id);
  }
  const r = db().prepare(sql.startSession).run(
    payload.activityId, payload.subActivityId, payload.note || '', Date.now()
  );
  return { sessionId: r.lastInsertRowid };
});
ipcMain.handle('stopSession', () => {
  const running = db().prepare(sql.getRunning).get();
  if (!running) return { stopped: false };
  const endMs = Date.now();
  db().prepare(sql.stopSession).run(endMs, endMs - running.start_ms, running.id);
  return { stopped: true };
});

// 手动插入完整的session记录
ipcMain.handle('insertSession', (_e, payload) => {
  const r = db().prepare(`
    INSERT INTO sessions(activity_id, sub_activity_id, note, start_ms, end_ms, duration_ms) 
    VALUES(?, ?, ?, ?, ?, ?)
  `).run(
    payload.activityId, 
    payload.subActivityId, 
    payload.note || '', 
    payload.startMs, 
    payload.endMs, 
    payload.durationMs
  );
  return { sessionId: r.lastInsertRowid };
});

// 手动学习记录相关API
ipcMain.handle('insertManualRecord', (_e, payload) => {
  const r = db().prepare(sql.insertManualSession).run(
    payload.activityId,
    payload.subActivityId || null,
    payload.note || '',
    payload.startMs,
    payload.endMs,
    payload.durationMs
  );
  return { sessionId: r.lastInsertRowid };
});

ipcMain.handle('getManualRecords', (_e, page = 1, pageSize = 8) => {
  const offset = (page - 1) * pageSize;
  const records = db().prepare(sql.getManualRecords).all(pageSize, offset);
  const totalResult = db().prepare(sql.getManualRecordsCount).get();
  const total = totalResult.total;
  const totalPages = Math.ceil(total / pageSize);
  
  return {
    records,
    pagination: {
      currentPage: page,
      pageSize,
      total,
      totalPages
    }
  };
});

ipcMain.handle('deleteManualRecord', (_e, recordId) => {
  const r = db().prepare(sql.deleteManualRecord).run(recordId);
  return { deleted: r.changes > 0 };
});

ipcMain.handle('getManualSessionsForDate', (_e, date) => {
  console.log('📅 查询日期的手动会话记录:', { date });
  
  try {
    const sessions = db().prepare(sql.getManualSessionsForDate).all(date);
    console.log('📋 手动会话查询结果:', { count: sessions.length, sessions });
    return sessions;
  } catch (error) {
    console.error('❌ 查询手动会话失败:', error);
    return [];
  }
});

ipcMain.handle('upsertActivity', (_e, nameRaw) => {
  const name = (nameRaw || '').trim();
  if (!name) return null;
  const ins = db().prepare(sql.insertActivityIgnore).run(name);
  if (ins.changes > 0) return ins.lastInsertRowid;
  const row = db().prepare(sql.getActivityIdByName).get(name);
  return row ? row.id : null;
});
ipcMain.handle('upsertSubActivity', (_e, activityId, nameRaw) => {
  const name = (nameRaw || '').trim();
  if (!activityId || !name) return null;
  const ins = db().prepare(sql.insertSubIgnore).run(activityId, name);
  if (ins.changes > 0) return ins.lastInsertRowid;
  const row = db().prepare(sql.getSubIdByActAndName).get(activityId, name);
  return row ? row.id : null;
});
ipcMain.handle('getNowRunning', () => db().prepare(sql.getRunning).get() || null);
ipcMain.handle('getToday', () => db().prepare(sql.getToday).all());
// ==================== 修改这里 ====================
// 让 getDay 接收 timezoneOffset 参数，并把它传给数据库
ipcMain.handle('getDay', (_e, isoDate, timezoneOffset) => {
  // 注意参数顺序：第一个 ? 是 timezoneOffset，第二个 ? 是 isoDate
  const rows = db().prepare(sql.getDay).all(timezoneOffset, isoDate);
  // 兼容：如果某些活动没有颜色，按名称回退
  const enriched = rows.map(r => {
    if (!r.color_hex && r.activity) {
      try {
        const hit = db().prepare(sql.getActivityColorByName).get(r.activity);
        if (hit) {
          return { ...r, color_hex: hit.color_hex, text_color: hit.text_color, background_color: hit.background_color };
        }
      } catch {}
    }
    return r;
  });
  return enriched;
});
// ===============================================
ipcMain.handle('getMonthSummary', (_e, yyyyMM) => db().prepare(sql.getMonthSummary).all(yyyyMM, yyyyMM));
ipcMain.handle('getDaysWithDataInMonth', (_e, yyyyMM) => db().prepare(sql.getDaysWithDataInMonth).all(yyyyMM, yyyyMM));

// 计划（每日实例）月度汇总：把 daily_instantiated_plans 聚合成与 getMonthSummary 类似的结构
ipcMain.handle('getMonthPlannedSummary', (_e, yyyyMM) => {
  try {
    // 计算 [start, end) 范围
    const start = `${yyyyMM}-01`;
    const end = new Date(`${yyyyMM}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const yyyy2 = end.getUTCFullYear();
    const mm2 = String(end.getUTCMonth() + 1).padStart(2, '0');
    const monthEnd = `${yyyy2}-${mm2}-01`;

    const rows = db().prepare(sql.getDailyPlansInRangeWithColors).all(start, monthEnd);
    // 以“活动 / 子类”为键，按计划时段长度累加（分钟→毫秒）
    const acc = new Map();
    for (const r of rows) {
      const key = `${r.activity_name || '(未选活动)'} / ${r.sub_activity_name || '(无子类)'}`;
      // 以 HH:MM 解析长度
      const [sh, sm] = String(r.start_time).split(':').map(n => parseInt(n, 10));
      const [eh, em] = String(r.end_time).split(':').map(n => parseInt(n, 10));
      const startMin = sh * 60 + (sm || 0);
      const endMin = eh * 60 + (em || 0);
      const durMs = Math.max(0, (endMin - startMin) * 60 * 1000);
      acc.set(key, (acc.get(key) || 0) + durMs);
    }
    return [...acc.entries()].map(([key, millis]) => ({ key, millis })).sort((a,b) => b.millis - a.millis);
  } catch (e) {
    console.error('getMonthPlannedSummary failed:', e);
    return [];
  }
});

// 合并汇总：实际(sessions，包括手动记录) + 日程(daily_instantiated_plans)
ipcMain.handle('getMonthCombinedSummary', (_e, yyyyMM) => {
  try {
    // 计算 [start, end) 范围
    const start = `${yyyyMM}-01`;
    const end = new Date(`${yyyyMM}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const yyyy2 = end.getUTCFullYear();
    const mm2 = String(end.getUTCMonth() + 1).padStart(2, '0');
    const monthEnd = `${yyyy2}-${mm2}-01`;

    // 1) 实际：直接用 getMonthSummary 的 SQL 聚合（sessions；包含手动记录）
    const actualRows = db().prepare(sql.getMonthSummary).all(yyyyMM, yyyyMM);

    // 2) 日程：从 daily_instantiated_plans 聚合（与 getMonthPlannedSummary 相同口径）
    const plannedRows = db().prepare(sql.getDailyPlansInRangeWithColors).all(start, monthEnd);
    const plannedMap = new Map();
    for (const r of plannedRows) {
      const key = `${r.activity_name || '(未选活动)'} / ${r.sub_activity_name || '(无子类)'}`;
      const [sh, sm] = String(r.start_time).split(':').map(n => parseInt(n, 10));
      const [eh, em] = String(r.end_time).split(':').map(n => parseInt(n, 10));
      const startMin = sh * 60 + (sm || 0);
      const endMin = eh * 60 + (em || 0);
      const durMs = Math.max(0, (endMin - startMin) * 60 * 1000);
      plannedMap.set(key, (plannedMap.get(key) || 0) + durMs);
    }

    // 3) 合并
    const acc = new Map();
    for (const r of actualRows) {
      acc.set(r.key, (acc.get(r.key) || 0) + (r.millis || 0));
    }
    for (const [key, ms] of plannedMap.entries()) {
      acc.set(key, (acc.get(key) || 0) + (ms || 0));
    }

    return [...acc.entries()].map(([key, millis]) => ({ key, millis })).sort((a,b) => b.millis - a.millis);
  } catch (e) {
    console.error('getMonthCombinedSummary failed:', e);
    return [];
  }
});

// -------- 短信板 / 日志 IPC ----------
// 新增一条消息（使用应用时区的当天日期）
ipcMain.handle('journal:add', (_e, content) => {
  try {
    const now = Date.now();
    const day = getDateInAppTZ();
    const r = db().prepare(sql.insertJournalEntry).run(day, now, String(content || '').slice(0, 4000));
    return { ok: true, id: r.lastInsertRowid, day_date: day, created_ms: now };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 最近消息（倒序，游标分页）
ipcMain.handle('journal:listRecent', (_e, limit = 50, beforeMs = null) => {
  try {
    const rows = db().prepare(sql.getJournalRecent).all(beforeMs, limit);
    return { ok: true, items: rows };
  } catch (e) {
    return { ok: false, error: e.message, items: [] };
  }
});

// 按天获取（正序）
ipcMain.handle('journal:listByDay', (_e, dayDate) => {
  try {
    const rows = db().prepare(sql.getJournalByDay).all(dayDate);
    return { ok: true, items: rows };
  } catch (e) {
    return { ok: false, error: e.message, items: [] };
  }
});

ipcMain.handle('journal:update', (_e, id, content) => {
  try {
    const now = Date.now();
    db().prepare(sql.updateJournalEntry).run(String(content || '').slice(0, 4000), now, id);
    return { ok: true, edited_ms: now };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('journal:delete', (_e, id) => {
  try {
    const r = db().prepare(sql.deleteJournalEntry).run(id);
    return { ok: r.changes > 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('journal:getDaysInMonth', (_e, yyyyMM) => {
  try {
    const rows = db().prepare(sql.getJournalDaysInMonth).all(yyyyMM);
    return { ok: true, days: rows.map(r => r.day_date) };
  } catch (e) {
    return { ok: false, error: e.message, days: [] };
  }
});

// -------- 开发者工具 IPC ----------
ipcMain.handle('dev:sessions:list', (_e, page = 1, pageSize = 50) => {
  try {
    const offset = (page - 1) * pageSize;
    const items = db().prepare(sql.devListSessions).all(pageSize, offset);
    const cnt = db().prepare(sql.devCountSessions).get();
    return { ok: true, items, total: cnt.total };
  } catch (e) {
    return { ok: false, error: e.message, items: [], total: 0 };
  }
});

ipcMain.handle('dev:sessions:delete', (_e, ids) => {
  try {
    const idList = Array.isArray(ids) ? ids.filter(x => Number.isFinite(x)).map(Number) : [];
    if (idList.length === 0) return { ok: true, deleted: 0 };
    const placeholders = idList.map(() => '?').join(',');
    const sqlText = sql.devDeleteSessionsByIds.replace('__IDS_PLACEHOLDER__', placeholders);
    const r = db().prepare(sqlText).run(...idList);
    return { ok: true, deleted: r.changes };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('dev:sessions:deleteAll', () => {
  try {
    // 1) 清空 sessions 表
    const r = db().prepare(sql.devDeleteAllSessions).run();

    // 2) 如果存在 daily_instantiated_plans 表，则一并清空（兼容老数据/废案）
    try {
      const hasDailyPlans = db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_instantiated_plans'").get();
      if (hasDailyPlans && hasDailyPlans.name === 'daily_instantiated_plans') {
        db().prepare('DELETE FROM daily_instantiated_plans').run();
      }
    } catch (innerErr) {
      // 静默忽略：表不存在或其他错误不影响原有返回
      console.warn('Optional cleanup daily_instantiated_plans failed:', innerErr?.message || innerErr);
    }

    return { ok: true, deleted: r.changes };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('dev:journal:list', (_e, page = 1, pageSize = 100) => {
  try {
    const offset = (page - 1) * pageSize;
    const items = db().prepare(`SELECT * FROM journal_entries ORDER BY id DESC LIMIT ? OFFSET ?`).all(pageSize, offset);
    const total = db().prepare(`SELECT COUNT(*) AS total FROM journal_entries`).get().total;
    return { ok: true, items, total };
  } catch (e) {
    return { ok: false, error: e.message, items: [], total: 0 };
  }
});

ipcMain.handle('dev:journal:delete', (_e, ids) => {
  try {
    const idList = Array.isArray(ids) ? ids.filter(x => Number.isFinite(x)).map(Number) : [];
    if (idList.length === 0) return { ok: true, deleted: 0 };
    const placeholders = idList.map(() => '?').join(',');
    const r = db().prepare(`DELETE FROM journal_entries WHERE id IN (${placeholders})`).run(...idList);
    return { ok: true, deleted: r.changes };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('dev:journal:deleteAll', () => {
  try {
    const r = db().prepare(`DELETE FROM journal_entries`).run();
    return { ok: true, deleted: r.changes };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// -------- 设置 IPC ----------
ipcMain.handle('settings:get', (_e, targetDate) => {
  // 如果没有指定日期，使用今天
  const date = targetDate || new Date().toISOString().split('T')[0];
  
  try {
    // 从数据库获取作息时间设置
    const scheduleSettings = db().prepare(sql.getScheduleSettingsForDate).get(date);
    
    // 从 store 获取其他设置（如 isOpaque）
  const otherSettings = store.get('settings', { isOpaque: false, devMode: false });
    
    return {
      ...otherSettings,
      wakeTime: scheduleSettings?.wake_time || '08:00',
      sleepTime: scheduleSettings?.sleep_time || '21:40',
      timezone: scheduleSettings?.timezone || 'PST'
    };
  } catch (error) {
    console.error('Failed to get settings:', error);
    return { isOpaque: false, wakeTime: '08:00', sleepTime: '21:40', timezone: 'PST' };
  }
});

ipcMain.handle('settings:set', (_e, settings) => {
  try {
    // 保存其他设置到 store
    const { wakeTime, sleepTime, timezone, ...otherSettings } = settings;
    if (Object.keys(otherSettings).length > 0) {
      store.set('settings', { ...store.get('settings', {}), ...otherSettings });
    }
    
    // 如果有作息时间相关设置，保存到数据库（从今天开始生效）
    if (wakeTime || sleepTime || timezone) {
      const today = new Date().toISOString().split('T')[0];
      const currentSettings = db().prepare(sql.getScheduleSettingsForDate).get(today);
      
      db().prepare(sql.insertScheduleSettings).run(
        today,
        wakeTime || currentSettings?.wake_time || '08:00',
        sleepTime || currentSettings?.sleep_time || '21:40',
        timezone || currentSettings?.timezone || 'PST'
      );
    }
  } catch (error) {
    console.error('Failed to set settings:', error);
  }
});

// -------- 数据导入导出 IPC ----------
const dbPath = path.join(app.getPath('userData'), 'timeglass.db');

ipcMain.handle('data:export', async () => {
  if (!win) return { ok: false, error: '主窗口不存在' };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出数据备份',
    defaultPath: `timeglass-backup-${Date.now()}.db`,
    filters: [{ name: '数据库文件', extensions: ['db'] }]
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.copyFileSync(dbPath, filePath);
    return { ok: true, path: filePath };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('data:import', async () => {
  if (!win) return { ok: false, error: '主窗口不存在' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入数据备份',
    properties: ['openFile'],
    filters: [{ name: '数据库文件', extensions: ['db'] }]
  });

  if (canceled || !filePaths || filePaths.length === 0) return { ok: false };
  
  const selectedPath = filePaths[0];

  const confirm = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '确认导入',
    message: '确定要导入备份吗？',
    detail: '此操作将覆盖您当前的所有数据，且无法撤销。建议在操作前先导出当前数据作为备份。',
    buttons: ['确认导入', '取消'],
    defaultId: 1,
    cancelId: 1
  });

  if (confirm.response === 1) return { ok: false, error: '用户取消' };

  try {
    db().close();
    fs.copyFileSync(selectedPath, dbPath);
    app.relaunch();
    app.exit();
    return { ok: true };
  } catch(e) {
    await initDB();
    return { ok: false, error: e.message };
  }
});

// -------- 维护：回填历史 daily_instantiated_plans 的 activity/sub_activity ----------
ipcMain.handle('maintenance:backfillDailyPlans', () => {
  try {
    const rows = db().prepare(`
      SELECT id, title, subtitle, activity_id, sub_activity_id FROM daily_instantiated_plans
      WHERE activity_id IS NULL
    `).all();
    if (rows.length === 0) return { ok: true, updated: 0 };

    const getAct = db().prepare('SELECT id FROM activities WHERE name = ?');
    const getSub = db().prepare('SELECT id FROM sub_activities WHERE activity_id = ? AND name = ?');
    const upd = db().prepare('UPDATE daily_instantiated_plans SET activity_id = ?, sub_activity_id = ? WHERE id = ?');

    let updated = 0;
    for (const r of rows) {
      // 优先用 subtitle 作为子活动；再从 title 里尝试分割
      let actName = null;
      let subName = r.subtitle || null;
      if (r.title) {
        const normalized = String(r.title).replace(/\uFF0F/g, '/');
        const parts = normalized.split('/').map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) actName = parts[0];
        if (!subName && parts.length > 1) subName = parts[1];
      }
      if (!actName) continue;
      const act = getAct.get(actName);
      if (!act) continue;
      let subId = null;
      if (subName) {
        const sub = getSub.get(act.id, subName);
        if (sub) subId = sub.id;
      }
      upd.run(act.id, subId, r.id);
      updated++;
    }
    return { ok: true, updated };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// -------- 每日计划实例化函数 ----------
function instantiateDailyPlans(date) {
  try {
    // 先清理该日期的错误数据（如果有的话）
    db().prepare(sql.deleteDailyPlansForDate).run(date);
    console.log('🧹 清理日期数据:', date);
    
    // 获取最新的每周计划模板
  const weeklyEvents = db().prepare(sql.getWeeklyEventsForDate).all();
    const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // 使用中午时间避免时区问题
    
    // 验证日期计算
    const testDate = new Date(date + 'T12:00:00');
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    console.log('🔄 实例化每日计划:', { date, dayOfWeek, dayName: dayNames[dayOfWeek], weeklyEventsCount: weeklyEvents.length });
    
    // 筛选出当天的计划并插入到每日计划表
    let insertedCount = 0;
    weeklyEvents.forEach(event => {
      console.log('🔍 检查事件:', { eventDayOfWeek: event.day_of_week, targetDayOfWeek: dayOfWeek, match: event.day_of_week === dayOfWeek });
      
      if (event.day_of_week === dayOfWeek) {
        try {
          // 直接使用原始数据进行存储，显示逻辑交给查询时处理
          db().prepare(sql.insertDailyPlan).run(
            date,
            event.start_time,
            event.end_time,
            event.activity_id || null,
            event.sub_activity_id || null,
            event.title,  // 保存原始title用于兼容性
            event.subtitle || null,
            'weekly'
          );
          insertedCount++;
          console.log('➕ 实例化计划:', {
            date,
            time: `${event.start_time}-${event.end_time}`,
            title: event.activity_name || event.title,
            activityId: event.activity_id
          });
        } catch (insertError) {
          console.error('❌ 插入计划失败:', insertError);
        }
      }
    });
    
    console.log('✅ 实例化完成:', { date, insertedCount });
  } catch (error) {
    console.error('❌ 实例化每日计划失败:', error);
  }
}

// -------- 每周计划 IPC ----------
ipcMain.handle('schedule:get', (_e, targetDate) => {
  // 如果没有指定日期，使用今天（本地时间）
  const date = targetDate || getDateInAppTZ();
  
  console.log('🚀 schedule:get 被调用:', { targetDate, date });
  
  try {
    // 仅在“今天”尝试实例化：如果今天还没有每日计划，则从当前每周计划生成；
    // 过去日期保持历史记录，未来日期等到那一天再实例化。
  const today = getDateInAppTZ();
    console.log('📅 日期比较:', { date, today, instantiate: date === today });
    
    if (date === today) {
      const existing = db().prepare(sql.checkDailyPlansExist).get(date);
      if ((existing?.count ?? 0) === 0) {
        console.log('🔄 今天首次实例化每日计划...', { date });
        instantiateDailyPlans(date);
      } else {
        console.log('✅ 今天已有每日计划，跳过实例化');
      }
    } else if (date < today) {
      console.log('⏪ 历史日期，不实例化:', { date, today });
    } else {
      console.log('⏭ 未来日期，不提前实例化:', { date, today });
    }
    
    // 获取该日期的实例化计划（包含颜色信息）
    let dailyPlans = db().prepare(sql.getDailyPlansWithColors).all(date);
    
    // 历史日期如果没有每日计划，按“没有计划”处理，不做模板回退，保证历史不被当前模板影响
    console.log('🔍 Main.js - 查询每日计划:', {
      targetDate,
      date,
      dailyPlansCount: dailyPlans.length,
      plans: dailyPlans
    });
    
    // 转换每日计划为 StatsDay 期望的格式
  const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // 使用中午时间避免时区问题
    const schedule = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };
    
    // 将每日计划放入对应的星期，优先使用关联的活动名称
    schedule[dayOfWeek] = dailyPlans.map(plan => {
      let displayTitle = plan.activity_name || plan.title || '未知活动';
      if (plan.sub_activity_name) {
        displayTitle += ` / ${plan.sub_activity_name}`;
      } else if (plan.subtitle) {
        displayTitle += ` / ${plan.subtitle}`;
      }

      // 兼容旧数据：如果没有 activity_id（历史生成的数据），总是尝试通过标题匹配活动名拿到颜色
      let color_hex = plan.color_hex;
      let background_color = plan.background_color;
      let text_color = plan.text_color;

      if (!plan.activity_id) {
        // 从 displayTitle 的第一段抽取活动名（以" / "分割）
        const actName = (displayTitle || '').split(' / ')[0];
        if (actName) {
          try {
            const hit = db().prepare(sql.getActivityColorByName).get(actName);
            if (hit) {
              color_hex = hit.color_hex || color_hex || '#3B82F6';
              background_color = hit.background_color ?? background_color ?? null;
              text_color = hit.text_color || text_color || '#FFFFFF';
              console.log('🎨 应用回退颜色(按名称匹配):', { actName, color_hex, text_color });
            }
          } catch (e) {
            console.warn('颜色名称匹配失败:', actName, e?.message);
          }
        }
      }

      return {
        start: plan.start_time,
        end: plan.end_time,
        title: displayTitle,
        subtitle: plan.sub_activity_name || plan.subtitle,
        activityId: plan.activity_id,
        subActivityId: plan.sub_activity_id,
        color_hex,
        background_color,
        text_color
      };
    });
    
    return schedule;
  } catch (error) {
    console.error('Failed to get weekly schedule:', error);
    return { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };
  }
});

ipcMain.handle('schedule:set', (_e, schedule) => {
  try {
    // 用应用时区确定“今天”
    const today = getDateInAppTZ();
    console.log('🔧 Main.js - 保存每周计划:', { 
      today, 
      scheduleKeys: Object.keys(schedule),
      schedule: schedule
    });
    
    // 删除从今天开始的所有每周计划（这样不会影响过去的数据）
    db().prepare(`DELETE FROM weekly_schedule_events WHERE effective_date >= ?`).run(today);
    
    // 插入新的每周计划（从今天开始生效）
    Object.keys(schedule).forEach(dayOfWeek => {
      const dayNum = parseInt(dayOfWeek);
      const events = schedule[dayNum] || [];
      
      // 插入新计划
      events.forEach(event => {
        console.log('💾 插入计划:', {
          effective_date: today,
          day_of_week: dayNum,
          start_time: event.start,
          end_time: event.end,
          activity_id: event.activityId,
          sub_activity_id: event.subActivityId || null,
          title: event.title,
          subtitle: event.subtitle || null
        });
        db().prepare(sql.insertWeeklyEvent).run(
          today,
          dayNum,
          event.start,
          event.end,
          event.activityId || null,
          event.subActivityId || null,
          event.title,
          event.subtitle || null
        );
      });
    });

    // 为了让“今天”的统计页立刻反映新模板：
    // 1) 删除今天已实例化的每日计划
    // 2) 让下一次读取或立刻实例化使用最新模板
    try {
      db().prepare(sql.deleteDailyPlansForDate).run(today);
      console.log('🗑️ 已清理今日每日实例化计划，等待按新模板重建:', today);
      // 也可以选择立即实例化，避免界面还需一次刷新
      instantiateDailyPlans(today);
    } catch (e) {
      console.warn('清理/重建今日每日计划失败（可忽略）:', e?.message);
    }
  } catch (error) {
    console.error('Failed to set weekly schedule:', error);
  }
});

// -------- 每周计划模板 IPC ----------
ipcMain.handle('weekly-template:get', (_e) => {
  try {
    // 获取最新的每周计划模板
    const events = db().prepare(sql.getWeeklyTemplate).all();
    console.log('🔍 Main.js - 查询每周计划模板:', {
      eventsCount: events.length,
      events: events
    });
    
    // 按照 day_of_week 分组
    const schedule = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };
    
    // 构建每天的计划
    events.forEach(event => {
      const dayEvents = schedule[event.day_of_week] || [];
      
      // 优先使用activity_name（从关联表获取），回退到title（兼容旧数据）
      let displayTitle = event.activity_name || event.title || '未知活动';
      let displaySubtitle = event.sub_activity_name || event.subtitle;
      
      // 只有当有子活动时才添加斜杠
      if (displaySubtitle) {
        displayTitle += ` / ${displaySubtitle}`;
      }
      
      dayEvents.push({
        start: event.start_time,
        end: event.end_time,
        title: displayTitle,
        subtitle: displaySubtitle,
        activityId: event.activity_id,
        subActivityId: event.sub_activity_id
      });
      schedule[event.day_of_week] = dayEvents;
    });
    
    // 对每天的计划按时间排序
    Object.keys(schedule).forEach(day => {
      schedule[day].sort((a, b) => a.start.localeCompare(b.start));
    });
    
    return schedule;
  } catch (error) {
    console.error('Failed to get weekly template:', error);
    return { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] };
  }
});

// -------- 每日计划切换 IPC ----------
ipcMain.handle('daily-plans:toggle', (_e, date) => {
  try {
    // 检查是否已有实例化计划
    const existingCount = db().prepare(sql.checkDailyPlansExist).get(date);
    
    if (existingCount.count > 0) {
      // 如果有，则删除（恢复到每周计划模板）
      db().prepare(sql.deleteDailyPlansForDate).run(date);
      console.log('🗑️ 删除每日实例化计划:', date);
      return { action: 'deleted', hasPlans: false };
    } else {
      // 如果没有，则实例化
      instantiateDailyPlans(date);
      return { action: 'created', hasPlans: true };
    }
  } catch (error) {
    console.error('❌ 切换每日计划失败:', error);
    return { action: 'error', error: error.message };
  }
});

// -------- 手动学习计划 IPC ----------
ipcMain.handle('manual-plans:get', (_e, page = 1, pageSize = 8) => {
  try {
    const offset = (page - 1) * pageSize;
    const plans = db().prepare(sql.getManualPlans).all(pageSize, offset);
    const countResult = db().prepare(sql.getManualPlansCount).get();
    const total = countResult.total;
    
    return {
      plans,
      pagination: {
        currentPage: page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  } catch (error) {
    console.error('Failed to get manual plans:', error);
    return { plans: [], pagination: { currentPage: 1, pageSize, total: 0, totalPages: 0 } };
  }
});

ipcMain.handle('manual-plans:add', (_e, plan) => {
  try {
    db().prepare(sql.insertManualPlan).run(
      plan.planDate,
      plan.startTime,
      plan.endTime,
      plan.subject,
      plan.subcategory || null
    );
    return { success: true };
  } catch (error) {
    console.error('Failed to add manual plan:', error);
    return { success: false, error: error.message };
  }
});

// 获取指定日期的手动学习计划
ipcMain.handle('manual-plans:get-for-date', (_e, date) => {
  try {
    const plans = db().prepare(sql.getManualPlansForDate).all(date);
    return plans;
  } catch (error) {
    console.error('Failed to get manual plans for date:', error);
    return [];
  }
});

ipcMain.handle('manual-plans:delete', (_e, planId) => {
  try {
    db().prepare(sql.deleteManualPlan).run(planId);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete manual plan:', error);
    return { success: false, error: error.message };
  }
});