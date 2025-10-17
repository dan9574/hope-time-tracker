// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listActivities: () => ipcRenderer.invoke('listActivities'),
  listActivitiesWithColors: () => ipcRenderer.invoke('listActivitiesWithColors'),
  listSubActivities: (activityId) => ipcRenderer.invoke('listSubActivities', activityId),
  upsertActivity: (name) => ipcRenderer.invoke('upsertActivity', name),
  upsertSubActivity: (activityId, name) => ipcRenderer.invoke('upsertSubActivity', activityId, name),
  startSession: (payload) => ipcRenderer.invoke('startSession', payload),
  stopSession: () => ipcRenderer.invoke('stopSession'),
  insertSession: (payload) => ipcRenderer.invoke('insertSession', payload),
  getNowRunning: () => ipcRenderer.invoke('getNowRunning'),
  getToday: () => ipcRenderer.invoke('getToday'),
  getDay: (isoDate, timezoneOffset) => ipcRenderer.invoke('getDay', isoDate, timezoneOffset),
  getMonthSummary: (ym) => ipcRenderer.invoke('getMonthSummary', ym),
  getDaysWithDataInMonth: (yyyyMM) => ipcRenderer.invoke('getDaysWithDataInMonth', yyyyMM),
  getMonthPlannedSummary: (ym) => ipcRenderer.invoke('getMonthPlannedSummary', ym),
  getMonthCombinedSummary: (ym) => ipcRenderer.invoke('getMonthCombinedSummary', ym),
  deleteActivity: (id) => ipcRenderer.invoke('deleteActivity', id),
  deleteSubActivity: (id) => ipcRenderer.invoke('deleteSubActivity', id),
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    close: () => ipcRenderer.invoke('win:close'),
  },
  
  // --- 新增的 API ---
  getSettings: (targetDate) => ipcRenderer.invoke('settings:get', targetDate),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  backfillDailyPlans: () => ipcRenderer.invoke('maintenance:backfillDailyPlans'),
  getWeeklySchedule: (targetDate) => ipcRenderer.invoke('schedule:get', targetDate),
  setWeeklySchedule: (schedule) => ipcRenderer.invoke('schedule:set', schedule),
  getWeeklyTemplate: () => ipcRenderer.invoke('weekly-template:get'),
  getManualPlans: (page, pageSize) => ipcRenderer.invoke('manual-plans:get', page, pageSize),
  addManualPlan: (plan) => ipcRenderer.invoke('manual-plans:add', plan),
  deleteManualPlan: (planId) => ipcRenderer.invoke('manual-plans:delete', planId),
  getManualPlansForDate: (date) => ipcRenderer.invoke('manual-plans:get-for-date', date),
  
  // 每日计划切换API
  toggleDailyPlans: (date) => ipcRenderer.invoke('daily-plans:toggle', date),
  
  // 手动学习记录API
  insertManualRecord: (payload) => ipcRenderer.invoke('insertManualRecord', payload),
  getManualRecords: (page, pageSize) => ipcRenderer.invoke('getManualRecords', page, pageSize),
  deleteManualRecord: (recordId) => ipcRenderer.invoke('deleteManualRecord', recordId),
  getManualSessionsForDate: (date) => ipcRenderer.invoke('getManualSessionsForDate', date),
  
  // 颜色管理API
  getActivityColors: () => ipcRenderer.invoke('getActivityColors'),
  saveActivityColor: (activityId, colorHex, backgroundColor, textColor) => ipcRenderer.invoke('saveActivityColor', activityId, colorHex, backgroundColor, textColor),
  
  // 颜色管理API
  getActivityColors: () => ipcRenderer.invoke('getActivityColors'),
  getActivityColor: (activityId) => ipcRenderer.invoke('getActivityColor', activityId),
  saveActivityColor: (activityId, colorHex, backgroundColor, textColor) => 
    ipcRenderer.invoke('saveActivityColor', activityId, colorHex, backgroundColor, textColor),
  
  // 短信板 / 日志 API
  addJournal: (content) => ipcRenderer.invoke('journal:add', content),
  listJournalRecent: (limit, beforeMs) => ipcRenderer.invoke('journal:listRecent', limit, beforeMs ?? null),
  listJournalByDay: (dayDate) => ipcRenderer.invoke('journal:listByDay', dayDate),
  updateJournal: (id, content) => ipcRenderer.invoke('journal:update', id, content),
  deleteJournal: (id) => ipcRenderer.invoke('journal:delete', id),
  getJournalDaysInMonth: (yyyyMM) => ipcRenderer.invoke('journal:getDaysInMonth', yyyyMM),
  
  // 开发者工具 API
  dev: {
    sessions: {
      list: (page, pageSize) => ipcRenderer.invoke('dev:sessions:list', page, pageSize),
      delete: (ids) => ipcRenderer.invoke('dev:sessions:delete', ids),
      deleteAll: () => ipcRenderer.invoke('dev:sessions:deleteAll'),
    },
    journal: {
      list: (page, pageSize) => ipcRenderer.invoke('dev:journal:list', page, pageSize),
      delete: (ids) => ipcRenderer.invoke('dev:journal:delete', ids),
      deleteAll: () => ipcRenderer.invoke('dev:journal:deleteAll'),
    }
  }
});

contextBridge.exposeInMainWorld('hud', {
  enter: (width, height) => ipcRenderer.invoke('hud:enter', { width, height }),
  leave: () => ipcRenderer.invoke('hud:leave'),
});