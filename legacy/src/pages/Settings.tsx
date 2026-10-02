import { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import type { WeeklySchedule, ActivityColor } from '../types';
import './Settings.css';

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="slider"></span>
    </label>
  );
}

export default function Settings({ isWallpaperMode, setIsWallpaperMode }: { isWallpaperMode: boolean; setIsWallpaperMode: (v: boolean) => void }) {
  // Timezone setting
  const [timezone, setTimezone] = useState('PST');
  
  // Daily schedule settings
  const [wakeTime, setWakeTime] = useState('08:00');
  const [sleepTime, setSleepTime] = useState('21:40');
  
  // Weekly schedule settings
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>({
    1: [], // Mon
    2: [], // Tue
    3: [], // Wed
    4: [], // Thu
    5: [], // Fri
    6: [], // Sat
    0: [], // Sun
  });

  // Add-event modal state
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [currentDayNum, setCurrentDayNum] = useState(0);
  const [newEvent, setNewEvent] = useState({
    start: '09:00',
    end: '10:00',
    activityId: '',
    subActivityId: '',
    title: '',
    subtitle: ''
  });
  
  // Activity data (used for manual records and weekly schedule)
  const [activities, setActivities] = useState<{id: number, name: string}[]>([]);
  const [subActivities, setSubActivities] = useState<{id: number, activityId: number, name: string}[]>([]);
  const [manualRecords, setManualRecords] = useState<any[]>([]);
  const [recordsPagination, setRecordsPagination] = useState({
    currentPage: 1,
    pageSize: 8,
    total: 0,
    totalPages: 0
  });

  // Load manual records with simple pagination
  async function loadManualRecords(page = 1) {
    try {
      const result = await (window.api as any).getManualRecords(page, 8);
      setManualRecords(result.records || []);
      setRecordsPagination(result.pagination || {
        currentPage: 1,
        pageSize: 8,
        total: 0,
        totalPages: 0
      });
    } catch (error) {
      console.error('Failed to load manual records:', error);
    }
  }
  const [showAddRecordModal, setShowAddRecordModal] = useState(false);
  const [newRecord, setNewRecord] = useState({
  recordDate: new Date().toISOString().split('T')[0], // default: today
    startTime: '09:00',
    endTime: '10:00',
    activityId: 0,
    subActivityId: 0,
    note: ''
  });

  // Color management state
  const [activityColors, setActivityColors] = useState<ActivityColor[]>([]);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const [tempColor, setTempColor] = useState('');
  const [tempTextColor, setTempTextColor] = useState('');
  const [devMode, setDevMode] = useState(false);

  // Load settings data
  useEffect(() => {
    async function loadSettings() {
  try {
  // Load activities and sub-activities
        await loadActivities();
  // Load manual study records
        await loadManualRecords(1);
  // Load weekly schedule
        await loadWeeklySchedule();
  // Load color configuration
        await loadActivityColors();
        try { const s:any = await (window.api as any).getSettings(); setDevMode(!!s?.devMode); } catch {}
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }
    loadSettings();
  }, []);

  // Load activities and sub-activities
  async function loadActivities() {
    try {
      const activitiesData = await window.api.listActivities();
      const subActivitiesData = await window.api.listSubActivities(null);
      setActivities(activitiesData);
      setSubActivities(subActivitiesData);
    } catch (error) {
      console.error('Failed to load activities:', error);
    }
  }

  // Load activity color configuration
  async function loadActivityColors() {
      try {
      const colorsData = await (window.api as any).getActivityColors();
      setActivityColors(colorsData);
    } catch (error) {
      console.error('Failed to load activity colors:', error);
    }
  }

  // Color management helpers
  const handleEditColor = (activityId: number, currentColor: string, currentTextColor: string) => {
    setEditingColorId(activityId);
    setTempColor(currentColor);
    setTempTextColor(currentTextColor);
  };

  const handleCancelColorEdit = () => {
    setEditingColorId(null);
    setTempColor('');
    setTempTextColor('');
  };

  const handleSaveColor = async (activityId: number) => {
    try {
  await (window.api as any).saveActivityColor(activityId, tempColor, null, tempTextColor);
  await loadActivityColors(); // Reload color configuration
      setEditingColorId(null);
      setTempColor('');
      setTempTextColor('');
    } catch (error) {
  console.error('Failed to save color:', error);
  alert('Failed to save color');
    }
  };

  const handleResetColors = () => {
    const confirmed = window.confirm(
      'Reset all activity color settings?\n\nThis will restore the following defaults:\n' +
      '• Class: purple\n' +
      '• Study: blue\n' +
      '• Game: light pink\n' +
      '• Exercise: orange\n' +
      '• Other: gray\n\n' +
      'This action cannot be undone.'
    );
    
    if (confirmed) {
      resetColorsToDefault();
    }
  };

  const resetColorsToDefault = async () => {
    try {
      // Note: these keys match activity names used in some databases/seeds.
      // We intentionally keep the original keys here to avoid breaking stored data.
      const defaultColors: { [key: string]: { color: string; textColor: string } } = {
        '上课': { color: '#8B5CF6', textColor: '#FFFFFF' }, // purple
        '测试': { color: '#F59E0B', textColor: '#FFFFFF' }, // orange (keep as-is)
        '自习': { color: '#3B82F6', textColor: '#FFFFFF' }, // blue (keep as-is)
        '复习': { color: '#8B5CF6', textColor: '#FFFFFF' }, // purple (keep as-is)
        '学习': { color: '#3B82F6', textColor: '#FFFFFF' }, // blue
        '运动': { color: '#F97316', textColor: '#FFFFFF' }, // orange
        '游戏': { color: '#F8D7DA', textColor: '#721C24' }, // light pink with dark text
      };

      // Reset color for each activity (fall back to gray/white if not found)
      for (const activity of activities) {
        const defaultColor = defaultColors[activity.name] || { color: '#6B7280', textColor: '#FFFFFF' };
        await (window.api as any).saveActivityColor(
          activity.id,
          defaultColor.color,
          null,
          defaultColor.textColor
        );
      }

      await loadActivityColors(); // Reload color configuration
      alert('Colors have been reset to defaults');
    } catch (error) {
      console.error('Failed to reset colors:', error);
      alert('Failed to reset colors, please try again later');
    }
  }

  // Load weekly schedule
  async function loadWeeklySchedule() {
    try {
      const schedule = await (window.api as any).getWeeklyTemplate();
      setWeeklySchedule(schedule || {
        1: [], // Mon
        2: [], // Tue
        3: [], // Wed
        4: [], // Thu
        5: [], // Fri
        6: [], // Sat
        0: [], // Sun
      });
    } catch (error) {
      console.error('Failed to load weekly schedule:', error);
    }
  }

  async function handleToggleWallpaper(e: ChangeEvent<HTMLInputElement>) {
    const newIsWallpaperMode = e.target.checked;
    setIsWallpaperMode(newIsWallpaperMode);
    // When saving to backend we still use the key `isOpaque` so main.js doesn't need changes
    await (window.api as any).setSettings({ isOpaque: newIsWallpaperMode });
  }

  async function handleTimezoneChange(e: ChangeEvent<HTMLSelectElement>) {
    const newTimezone = e.target.value;
    setTimezone(newTimezone);
    await (window.api as any).setSettings({ timezone: newTimezone });
  }

  async function handleWakeTimeChange(e: ChangeEvent<HTMLInputElement>) {
    const newWakeTime = e.target.value;
    setWakeTime(newWakeTime);
    await (window.api as any).setSettings({ wakeTime: newWakeTime });
  }

  async function handleSleepTimeChange(e: ChangeEvent<HTMLInputElement>) {
    const newSleepTime = e.target.value;
    setSleepTime(newSleepTime);
    await (window.api as any).setSettings({ sleepTime: newSleepTime });
  }

  function handleAddEvent(dayNum: number) {
    setCurrentDayNum(dayNum);
    setNewEvent({
      start: '09:00',
      end: '10:00',
      activityId: activities.length > 0 ? activities[0].id.toString() : '',
      subActivityId: '',
      title: '',
      subtitle: ''
    });
    setShowAddEventModal(true);
  }

  async function handleSaveEvent() {
    if (!newEvent.activityId || !newEvent.start || !newEvent.end) return;

  // Find the selected activity and sub-activity info
    const selectedActivity = activities.find(a => a.id.toString() === newEvent.activityId);
    const selectedSubActivity = newEvent.subActivityId ? 
      subActivities.find(sa => sa.id.toString() === newEvent.subActivityId) : null;

  // Build display title
  let displayTitle = selectedActivity?.name || 'Unknown activity';
    if (selectedSubActivity) {
      displayTitle += ` / ${selectedSubActivity.name}`;
    }

    const eventToSave = {
      start: newEvent.start,
      end: newEvent.end,
      title: displayTitle,
      subtitle: selectedSubActivity?.name || '',
      activityId: parseInt(newEvent.activityId),
      subActivityId: newEvent.subActivityId ? parseInt(newEvent.subActivityId) : undefined
    };

    const updatedSchedule = {
      ...weeklySchedule,
      [currentDayNum]: [...(weeklySchedule[currentDayNum] || []), eventToSave]
    };

  setWeeklySchedule(updatedSchedule);
    await (window.api as any).setWeeklySchedule(updatedSchedule);
    setShowAddEventModal(false);
  }

  function handleCancelEvent() {
    setShowAddEventModal(false);
  }

  // Manual record helpers
  function handleAddRecord() {
    setNewRecord({
      recordDate: new Date().toISOString().split('T')[0], // default: today
      startTime: '09:00',
      endTime: '10:00',
      activityId: activities.length > 0 ? activities[0].id : 0,
      subActivityId: 0,
      note: ''
    });
    setShowAddRecordModal(true);
  }

  async function handleSaveRecord() {
    if (!newRecord.recordDate || !newRecord.startTime || !newRecord.endTime || !newRecord.activityId) return;
    
    try {
  // Convert date/time into timestamps
      const startDateTime = new Date(`${newRecord.recordDate}T${newRecord.startTime}`);
      const endDateTime = new Date(`${newRecord.recordDate}T${newRecord.endTime}`);
      const startMs = startDateTime.getTime();
      const endMs = endDateTime.getTime();
      const durationMs = endMs - startMs;
      
      if (durationMs <= 0) {
        alert('End time must be after start time');
        return;
      }
      
  // Use the new insertManualRecord API
      await (window.api as any).insertManualRecord({
        activityId: newRecord.activityId,
        subActivityId: newRecord.subActivityId || null,
        note: newRecord.note,
        startMs,
        endMs,
        durationMs
      });
      
      setShowAddRecordModal(false);
      await loadManualRecords(recordsPagination.currentPage);
  alert('Record added');
    } catch (error) {
      console.error('Failed to save record:', error);
      alert('Save failed, please try again');
    }
  }

  function handleCancelRecord() {
    setShowAddRecordModal(false);
  }

  function handleActivityChange(activityId: number) {
    setNewRecord({
      ...newRecord,
      activityId,
      subActivityId: 0 // reset sub-activity
    });
  }

  async function handleDeleteRecord(recordId: number) {
  if (!confirm('Delete this manual record?')) return;
    
    try {
      await (window.api as any).deleteManualRecord(recordId);
      await loadManualRecords(recordsPagination.currentPage);
  alert('Record deleted');
    } catch (error) {
      console.error('Failed to delete record:', error);
      alert('Delete failed, please try again');
    }
  }

  async function handleRecordsPageChange(newPage: number) {
    await loadManualRecords(newPage);
  }



  async function handleDeleteEvent(dayNum: number, eventIndex: number) {
    const updatedSchedule = {
      ...weeklySchedule,
      [dayNum]: weeklySchedule[dayNum].filter((_, index) => index !== eventIndex)
    };

    setWeeklySchedule(updatedSchedule);
    await (window.api as any).setWeeklySchedule(updatedSchedule);
  }

  async function handleExport() {
    const res = await (window.api as any).exportData();
    if (res.ok) {
      alert(`Data successfully exported to:\n${res.path}`);
    } else {
      alert(`Export failed: ${res.error || 'user canceled'}`);
    }
  }

  async function handleImport() {
    const res = await (window.api as any).importData();
    if (!res.ok && res.error) {
       if (res.error !== 'user canceled') {
         alert(`Import failed: ${res.error}`);
       }
    }
  }

  return (
    <div>
  <h2 style={{ marginTop: 0 }}>Settings</h2>
      
    <div className="settings-section">
  <h3>Appearance</h3>
        <div className="setting-item">
          <div className="setting-item-label">
            {/* --- Edited: updated heading and description --- */}
            <h4>Wallpaper mode</h4>
            <p>Makes the HUD background fully transparent, showing only text and buttons.</p>
          </div>
          <div className="setting-item-action">
            <ToggleSwitch checked={isWallpaperMode} onChange={handleToggleWallpaper} />
          </div>
        </div>
      </div>

    <div className="settings-section">
  <h3>Time settings</h3>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>Timezone</h4>
            <p>Select your timezone for accurate stats and display.</p>
          </div>
          <div className="setting-item-action">
            <select value={timezone} onChange={handleTimezoneChange}>
              <option value="PST">PST (Pacific Standard Time)</option>
              <option value="Beijing">Beijing Time (UTC+8)</option>
            </select>
          </div>
        </div>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>Wake time</h4>
            <p>Set your daily wake-up time for day activity calculations.</p>
          </div>
          <div className="setting-item-action">
            <input 
              type="time" 
              value={wakeTime} 
              onChange={handleWakeTimeChange}
            />
          </div>
        </div>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>Sleep time</h4>
            <p>Set your daily sleep time for day activity calculations.</p>
          </div>
          <div className="setting-item-action">
            <input 
              type="time" 
              value={sleepTime} 
              onChange={handleSleepTimeChange}
            />
          </div>
        </div>
      </div>

    <div className="settings-section">
  <h3>Weekly schedule</h3>
        <div className="weekly-schedule-container">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, index) => {
            const dayNum = index === 6 ? 0 : index + 1; // Sunday is 0, Monday is 1
            return (
              <div key={dayNum} className="day-schedule">
                <h5>{dayName}</h5>
                <div className="schedule-list">
                  {weeklySchedule[dayNum]?.map((event, eventIndex) => (
                    <div key={eventIndex} className="schedule-event">
                      <span className="event-time">
                        {event.start} - {event.end}
                      </span>
                      <span className="event-title">
                        {(() => {
                                      // Prefer resolving by id first to avoid duplicate display
                          if (event.activityId) {
                            const act = activities.find(a => a.id === event.activityId);
                            const sub = event.subActivityId ? subActivities.find(sa => sa.id === event.subActivityId) : null;
                            return sub ? `${act?.name || event.title} / ${sub.name}` : (act?.name || event.title || '');
                          }
                                      // No id (legacy data): if title already contains '/', use it; otherwise, join title and subtitle
                                      if (event.title && String(event.title).includes(' / ')) return event.title;
                                      return event.subtitle ? `${event.title || ''} / ${event.subtitle}` : (event.title || '');
                        })()}
                      </span>
                      <button 
                        className="delete-event-btn"
                        onClick={() => handleDeleteEvent(dayNum, eventIndex)}
                      >
                        Delete
                      </button>
                    </div>
                  )) || []}
                </div>
                <button 
                  className="add-event-btn"
                  onClick={() => handleAddEvent(dayNum)}
                >
                  + Add event
                </button>
              </div>
            );
          })}
        </div>
      </div>

    <div className="settings-section">
  <h3>Colors</h3>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <small style={{opacity:.7}}>Set a custom color for each activity type used in charts and lists.</small>
          <button className="btn-reset-colors" onClick={async()=>{
            const res = await (window.api as any).backfillDailyPlans?.();
            if(res?.ok){
              alert(`Backfilled historical daily-plan activity references: ${res.updated||0} items`);
            }else{
              alert(`Backfill failed: ${res?.error||'unknown error'}`);
            }
          }}>Backfill plan colors</button>
        </div>
        <div className="colors-container">
          <div className="colors-header">
            <p className="colors-description">Set a custom color for each activity type used in charts and lists.</p>
            <button className="btn-reset-colors" onClick={handleResetColors}>Reset colors</button>
          </div>
          <div className="activity-colors-list">
            {activities.map(activity => {
              const colorConfig = activityColors.find(c => c.activity_id === activity.id);
              const currentColor = colorConfig?.color_hex || '#3B82F6';
              const currentTextColor = colorConfig?.text_color || '#FFFFFF';
              const isEditing = editingColorId === activity.id;
              
              return (
                <div key={activity.id} className="activity-color-item">
                  <div className="activity-info">
                    <div 
                      className="color-preview"
                      style={{ 
                        backgroundColor: isEditing ? tempColor : currentColor,
                        color: isEditing ? tempTextColor : currentTextColor
                      }}
                    >
                      {activity.name}
                    </div>
                  </div>
                  
                  <div className="color-controls">
                    {isEditing ? (
                      <>
                        <div className="color-inputs">
                          <label>
                            Background:
                            <input 
                              type="color" 
                              value={tempColor}
                              onChange={(e) => setTempColor(e.target.value)}
                            />
                          </label>
                          <label>
                            Text color:
                            <input 
                              type="color" 
                              value={tempTextColor}
                              onChange={(e) => setTempTextColor(e.target.value)}
                            />
                          </label>
                        </div>
                        <div className="color-actions">
                          <button 
                            className="btn-save-color"
                            onClick={() => handleSaveColor(activity.id)}
                          >
                            Save
                          </button>
                          <button 
                            className="btn-cancel-color"
                            onClick={handleCancelColorEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <button 
                        className="btn-edit-color"
                        onClick={() => handleEditColor(activity.id, currentColor, currentTextColor)}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Manual records</h3>
        <div className="manual-records-container">
          <div className="records-header">
            <button className="add-record-btn" onClick={handleAddRecord}>
              + Add record
            </button>
          </div>
          
          <div className="records-info">
            <p>Added manual records will be reflected in daily and monthly statistics.</p>
            <p>Please pick the activity and the sub-activity, and set correct time ranges.</p>
          </div>

          {recordsPagination.totalPages > 1 && (
            <div className="records-pagination-info">
              Page {recordsPagination.currentPage} / {recordsPagination.totalPages}
            </div>
          )}
          
          <div className="records-list">
            {manualRecords.map((record) => (
              <div key={record.id} className="record-item">
                <div className="record-header">
                  <div className="record-date">{record.record_date}</div>
                  <div className="record-time">
                    {record.start_time} - {record.end_time}
                  </div>
                </div>
                <div className="record-content">
                  <span className="record-activity">{record.activity_name}</span>
                  {record.sub_activity_name && (
                    <span className="record-subactivity">/ {record.sub_activity_name}</span>
                  )}
                  {record.note && (
                    <span className="record-note">({record.note})</span>
                  )}
                </div>
                <button 
                  className="delete-record-btn"
                  onClick={() => handleDeleteRecord(record.id)}
                >
                  Delete
                </button>
              </div>
            ))}
            
            {manualRecords.length === 0 && (
              <div className="empty-records">
                No manual records yet — click the button above to add one
              </div>
            )}
          </div>

          {recordsPagination.totalPages > 1 && (
            <div className="records-pagination">
              <div className="records-pagination-controls">
                <button
                  className="page-btn"
                  onClick={() => handleRecordsPageChange(recordsPagination.currentPage - 1)}
                  disabled={recordsPagination.currentPage <= 1}
                >
                  Previous
                </button>
                <button
                  className="page-btn"
                  onClick={() => handleRecordsPageChange(recordsPagination.currentPage + 1)}
                  disabled={recordsPagination.currentPage >= recordsPagination.totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3>Data management</h3>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>Export data</h4>
            <p>Export all of your historical records into a standalone database file.</p>
          </div>
          <div className="setting-item-action">
            <button onClick={handleExport}>Export</button>
          </div>
        </div>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>Import backup</h4>
            <p>Restore data from a backup file. This will overwrite your current data.</p>
          </div>
          <div className="setting-item-action">
            <button onClick={handleImport}>Import</button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Developer mode</h3>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>Enter / Exit developer mode</h4>
            <p>When enabled, a "Developer" item will appear in the sidebar for deleting sessions and journal entries.</p>
          </div>
          <div className="setting-item-action" style={{gap:8}}>
            <button onClick={async()=>{
              if (!devMode) {
                if (!confirm('Enter developer mode?')) return;
                await (window.api as any).setSettings({ devMode: true });
                setDevMode(true);
              } else {
                if (!confirm('Exit developer mode?')) return;
                await (window.api as any).setSettings({ devMode: false });
                setDevMode(false);
              }
            }}>
              {devMode ? 'Exit' : 'Enter'}
            </button>
          </div>
        </div>
      </div>

  {/* Add event modal window */}
      {showAddEventModal && (
        <div className="modal-backdrop" onClick={handleCancelEvent}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add event</h3>
            <div className="form-row">
              <label>Activity *</label>
              <select 
                value={newEvent.activityId}
                onChange={(e) => {
                  setNewEvent({
                    ...newEvent, 
                    activityId: e.target.value,
                    subActivityId: '' // reset sub-activity selection
                  });
                }}
              >
                <option value="">Please select an activity</option>
                {activities.map(activity => (
                  <option key={activity.id} value={activity.id}>
                    {activity.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Sub-activity</label>
              <select 
                value={newEvent.subActivityId}
                onChange={(e) => setNewEvent({...newEvent, subActivityId: e.target.value})}
                disabled={!newEvent.activityId}
              >
                <option value="">No sub-activity</option>
                {subActivities
                  .filter(sub => sub.activityId.toString() === newEvent.activityId)
                  .map(subActivity => (
                    <option key={subActivity.id} value={subActivity.id}>
                      {subActivity.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-row-group">
              <div className="form-row">
                <label>Start time *</label>
                <input 
                  type="time"
                  value={newEvent.start}
                  onChange={(e) => setNewEvent({...newEvent, start: e.target.value})}
                />
              </div>
              <div className="form-row">
                <label>End time *</label>
                <input 
                  type="time"
                  value={newEvent.end}
                  onChange={(e) => setNewEvent({...newEvent, end: e.target.value})}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={handleCancelEvent}>Cancel</button>
              <button 
                className="btn-save" 
                onClick={handleSaveEvent}
                disabled={!newEvent.activityId || !newEvent.start || !newEvent.end}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

  {/* Add manual record modal window */}
      {showAddRecordModal && (
        <div className="modal-backdrop" onClick={handleCancelRecord}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add manual record</h3>
            <div className="form-row">
              <label>Date *</label>
              <input 
                type="date"
                value={newRecord.recordDate}
                onChange={(e) => setNewRecord({...newRecord, recordDate: e.target.value})}
              />
            </div>
            <div className="form-row">
              <label>Activity *</label>
              <select 
                value={newRecord.activityId}
                onChange={(e) => handleActivityChange(Number(e.target.value))}
              >
                <option value={0}>Please select an activity</option>
                {activities.map(activity => (
                  <option key={activity.id} value={activity.id}>
                    {activity.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Sub-activity</label>
              <select 
                value={newRecord.subActivityId}
                onChange={(e) => setNewRecord({...newRecord, subActivityId: Number(e.target.value)})}
              >
                <option value={0}>No sub-activity</option>
                {subActivities
                  .filter(sub => sub.activityId === newRecord.activityId)
                  .map(sub => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-row-group">
              <div className="form-row">
                <label>Start time *</label>
                <input 
                  type="time"
                  value={newRecord.startTime}
                  onChange={(e) => setNewRecord({...newRecord, startTime: e.target.value})}
                />
              </div>
              <div className="form-row">
                <label>End time *</label>
                <input 
                  type="time"
                  value={newRecord.endTime}
                  onChange={(e) => setNewRecord({...newRecord, endTime: e.target.value})}
                />
              </div>
            </div>
            <div className="form-row">
                <label>Note</label>
              <input 
                type="text"
                value={newRecord.note}
                onChange={(e) => setNewRecord({...newRecord, note: e.target.value})}
                  placeholder="Optional note"
              />
            </div>
            <div className="modal-actions">
                <button className="btn-cancel" onClick={handleCancelRecord}>Cancel</button>
                <button 
                className="btn-save" 
                onClick={handleSaveRecord}
                disabled={!newRecord.recordDate || !newRecord.startTime || !newRecord.endTime || !newRecord.activityId}
              >
                  Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}