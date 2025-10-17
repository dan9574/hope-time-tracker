// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listActivities: () => ipcRenderer.invoke('listActivities'),
  listSubActivities: (activityId) => ipcRenderer.invoke('listSubActivities', activityId),
  upsertActivity: (name) => ipcRenderer.invoke('upsertActivity', name),
  upsertSubActivity: (activityId, name) => ipcRenderer.invoke('upsertSubActivity', activityId, name),
  startSession: (payload) => ipcRenderer.invoke('startSession', payload),
  stopSession: () => ipcRenderer.invoke('stopSession'),
  getNowRunning: () => ipcRenderer.invoke('getNowRunning'),
  getToday: () => ipcRenderer.invoke('getToday'),
  getDay: (isoDate) => ipcRenderer.invoke('getDay', isoDate),
  getMonthSummary: (ym) => ipcRenderer.invoke('getMonthSummary', ym),
  getDaysWithDataInMonth: (yyyyMM) => ipcRenderer.invoke('getDaysWithDataInMonth', yyyyMM),
  deleteActivity: (id) => ipcRenderer.invoke('deleteActivity', id),
  deleteSubActivity: (id) => ipcRenderer.invoke('deleteSubActivity', id),
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    close: () => ipcRenderer.invoke('win:close'),
  },
  
  // --- Newly added APIs ---
  getSettings: (targetDate) => ipcRenderer.invoke('settings:get', targetDate),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  getWeeklySchedule: (targetDate) => ipcRenderer.invoke('schedule:get', targetDate),
  setWeeklySchedule: (schedule) => ipcRenderer.invoke('schedule:set', schedule),
  getManualPlans: (page, pageSize) => ipcRenderer.invoke('manual-plans:get', page, pageSize),
  addManualPlan: (plan) => ipcRenderer.invoke('manual-plans:add', plan),
  deleteManualPlan: (planId) => ipcRenderer.invoke('manual-plans:delete', planId),
  getManualPlansForDate: (date) => ipcRenderer.invoke('manual-plans:get-for-date', date),
});

contextBridge.exposeInMainWorld('hud', {
  enter: (width, height) => ipcRenderer.invoke('hud:enter', { width, height }),
  leave: () => ipcRenderer.invoke('hud:leave'),
});