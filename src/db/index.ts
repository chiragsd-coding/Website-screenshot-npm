import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new Database(config.DATABASE_URL);
db.pragma('journal_mode = WAL');

export const initDb = () => {
  try {
    const paths = [
      path.join(__dirname, 'schema.sql'),
      path.join(__dirname, '../../src/db/schema.sql'),
      path.join(process.cwd(), 'src/db/schema.sql'),
      path.join(process.cwd(), 'dist/db/schema.sql'),
    ];
    let schemaPath = '';
    for (const p of paths) {
      if (fs.existsSync(p)) {
        schemaPath = p;
        break;
      }
    }

    if (schemaPath) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schema);
      logger.info(`Database initialized successfully using schema from ${schemaPath}`);
    } else {
      logger.warn('schema.sql not found in any candidate paths, skipping database initialization');
    }
  } catch (error) {
    logger.error('Failed to initialize database', { error });
    throw error;
  }
};

export { db };
export default db;
