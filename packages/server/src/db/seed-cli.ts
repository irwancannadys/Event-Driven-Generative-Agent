import { loadConfig } from '../config';
import { openDatabase } from './database';
import { loadMigrations, runMigrations } from './migrate';
import { seedReferenceData } from './seed';

const config = loadConfig();
const db = openDatabase(config.databasePath);
runMigrations(db, loadMigrations());
const counts = seedReferenceData(db);
console.log(`Seeded reference data into ${config.databasePath}`);
for (const [table, count] of Object.entries(counts)) {
  console.log(`  ${table}: ${count}`);
}
db.close();
