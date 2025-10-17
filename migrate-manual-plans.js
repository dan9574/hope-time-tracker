const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'activity_tracker.db');
const db = new Database(dbPath);

console.log('Starting migration of manual study plans...');

try {
  // Check whether manual_study_plans already has activity_id column
  const columns = db.prepare("PRAGMA table_info(manual_study_plans)").all();
  const hasActivityId = columns.some(col => col.name === 'activity_id');
  
  console.log('Table columns:', columns.map(col => col.name));
  
  if (!hasActivityId) {
  console.log('Adding activity_id and sub_activity_id columns...');
    db.exec(`
      ALTER TABLE manual_study_plans ADD COLUMN activity_id INTEGER;
      ALTER TABLE manual_study_plans ADD COLUMN sub_activity_id INTEGER;
    `);
  }
  
  // Inspect existing manual plans
  const existingPlans = db.prepare("SELECT * FROM manual_study_plans").all();
  console.log('Existing manual plans count:', existingPlans.length);
  
  if (existingPlans.length > 0) {
  console.log('First 3 sample records:');
    existingPlans.slice(0, 3).forEach((plan, i) => {
      console.log(`${i + 1}:`, {
        subject: plan.subject,
        subcategory: plan.subcategory,
        activity_id: plan.activity_id,
        date: plan.date
      });
    });
  }
  
  // Inspect existing activities
  const activities = db.prepare("SELECT * FROM activities").all();
  console.log('Existing activities:');
  activities.forEach(activity => {
    console.log(`- ${activity.name} (ID: ${activity.id})`);
  });
  
  // Inspect sub-activities
  const subActivities = db.prepare("SELECT * FROM sub_activities").all();
  console.log('Existing sub-activities:');
  subActivities.forEach(sub => {
    console.log(`- ${sub.name} (ID: ${sub.id}, 父活动: ${sub.activity_id})`);
  });
  
  // Migration logic
  let migratedCount = 0;
  
  for (const plan of existingPlans) {
    if (!plan.activity_id) {  // 只迁移未设置activity_id的记录
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
        db.prepare(`
          UPDATE manual_study_plans 
          SET activity_id = ?, sub_activity_id = ? 
          WHERE id = ?
        `).run(activity.id, subActivityId, plan.id);
        
        migratedCount++;
            console.log(`✓ Migrated record ${plan.id}: ${plan.subject}${plan.subcategory ? ' / ' + plan.subcategory : ''} -> activity ID ${activity.id}${subActivityId ? ', sub-activity ID ' + subActivityId : ''}`);
      } else {
        console.log(`⚠ No matching activity found: ${plan.subject}`);
      }
    }
  }
  
  console.log(`\nMigration complete! Migrated ${migratedCount} records`);
  
  // 验证迁移结果
  const migratedPlans = db.prepare(`
    SELECT p.*, a.name as activity_name, sa.name as sub_activity_name
    FROM manual_study_plans p
    LEFT JOIN activities a ON p.activity_id = a.id
    LEFT JOIN sub_activities sa ON p.sub_activity_id = sa.id
    LIMIT 5
  `).all();
  
  console.log('\nSample migrated records:');
  migratedPlans.forEach((plan, i) => {
    console.log(`${i + 1}:`, {
      original_subject: plan.subject,
      original_subcategory: plan.subcategory,
      new_activity: plan.activity_name,
      new_sub_activity: plan.sub_activity_name,
      activity_id: plan.activity_id
    });
  });
  
} catch (error) {
  console.error('Migration failed:', error);
} finally {
  db.close();
}