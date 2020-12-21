import path from 'path';

export const PROJECT_DIR = path.resolve(`${__dirname}/../..`);
export const DB_PATH = path.resolve(`${PROJECT_DIR}`, 'db.json');
export const KEYS_DIR = path.resolve(`${PROJECT_DIR}`, '.keys/');
