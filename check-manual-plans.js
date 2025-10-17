const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'activity_tracker.db');
const db = new Database(dbPath);

console.log('Checking manual study plans...');

try {
  // List all manual study plans
  const allPlans = db.prepare(`
    SELECT p.*, a.name as activity_name, sa.name as sub_activity_name,
           ac.color_hex, ac.background_color, ac.text_color
    FROM manual_study_plans p
    LEFT JOIN activities a ON p.activity_id = a.id
    LEFT JOIN sub_activities sa ON p.sub_activity_id = sa.id
    LEFT JOIN activity_colors ac ON a.id = ac.activity_id
  `).all();
  
  console.log('Manual study plans count:', allPlans.length);
  
  if (allPlans.length > 0) {
  console.log('\nFirst 5 records:');
    allPlans.slice(0, 5).forEach((plan, i) => {
  console.log(`${i + 1}. Date: ${plan.date}`);
  console.log(`   Time: ${plan.start_time} - ${plan.end_time}`);
  console.log(`   Original: ${plan.subject}${plan.subcategory ? ' / ' + plan.subcategory : ''}`);
  console.log(`   Mapped activity: ${plan.activity_name || 'unset'}${plan.sub_activity_name ? ' / ' + plan.sub_activity_name : ''}`);
  console.log(`   Color: ${plan.color_hex || 'none'}`);
      console.log('   ---');
    });
  }
  
  // Inspect records for a specific date (today)
  const today = new Date().toISOString().split('T')[0];
  console.log(`\nInspecting records for today (${today}):`);
  
  const todayPlans = db.prepare(`
    SELECT p.*, a.name as activity_name, sa.name as sub_activity_name,
           ac.color_hex, ac.background_color, ac.text_color
    FROM manual_study_plans p
    LEFT JOIN activities a ON p.activity_id = a.id
    LEFT JOIN sub_activities sa ON p.sub_activity_id = sa.id
    LEFT JOIN activity_colors ac ON a.id = ac.activity_id
    WHERE p.date = ?
  `).all(today);
  
  console.log(`Manual records for today: ${todayPlans.length}`);
  
  if (todayPlans.length > 0) {
    todayPlans.forEach((plan, i) => {
      console.log(`${i + 1}. ${plan.start_time}-${plan.end_time} ${plan.activity_name || plan.subject} (color: ${plan.color_hex || 'none'})`);
    });
  }
  
} catch (error) {
  console.error('Query failed:', error);
} finally {
  db.close();
}