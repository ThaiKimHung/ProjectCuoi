// Loads <project>/.env into process.env; variables already set in the shell take precedence.
// index.js imports this first, before any module that reads process.env while loading.
// Tests import server modules directly, so a developer's .env never leaks into them.
import dotenv from 'dotenv';
import { fromProjectRoot } from './paths.js';

dotenv.config({ path: fromProjectRoot('.env') });

export const PORT = process.env.PORT || 3001;
