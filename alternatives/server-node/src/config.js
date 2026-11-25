import 'dotenv/config';

// All timetable times are campus-local (East Africa Time).
process.env.TZ = process.env.TZ || 'Africa/Kampala';

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mmu_rooms',
  },
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long.');
}
