const Database = require('better-sqlite3');
const db = new Database('./data.db');

console.log('=== Weekly Schedule Events Schema ===');
const schema = db.prepare('PRAGMA table_info(weekly_schedule_events)').all();
console.log(schema);

console.log('\n=== Sample Weekly Schedule Events ===');
const events = db.prepare('SELECT * FROM weekly_schedule_events LIMIT 5').all();
console.log(events);

console.log('\n=== Activities Table ===');
const activities = db.prepare('SELECT * FROM activities LIMIT 3').all();
console.log(activities);

console.log('\n=== Sub-Activities Table ===');
const subActivities = db.prepare('SELECT * FROM sub_activities LIMIT 3').all();
console.log(subActivities);

db.close();