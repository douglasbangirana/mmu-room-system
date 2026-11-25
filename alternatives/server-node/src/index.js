import { config } from './config.js';
import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

createApp().listen(config.port, () => {
  console.log(`MMU room server listening on :${config.port} (TZ=${process.env.TZ})`);
  startScheduler();
});
