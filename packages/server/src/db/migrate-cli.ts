import { loadConfig } from '../config';
import { openDatabase } from './database';
import { loadMigrations, runMigrations } from './migrate';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const ran = runMigrations(db, loadMigrations());
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
console.log(`Database: ${config.databasePath}`);
db.close();
