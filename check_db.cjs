const Database = require('better-sqlite3');
const db = new Database('./data/cyber_basketball.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
for (const t of tables) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
  console.log(t.name + ': ' + count.c + ' rows');
}
db.close();
