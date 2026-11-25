// Pretends to be a room terminal so you can test the server without hardware.
//   ROOM=LH-101 KEY=<device key> node scripts/simulate-terminal.js heartbeat
//   ROOM=LH-101 KEY=<device key> node scripts/simulate-terminal.js swipe 04A1B2C3
//   ... swipe-queued 04A1B2C3 [secondsAgo]   (simulates an event saved during an outage)
//   ... sync
const BASE = process.env.API || 'http://localhost:3000/api';
const headers = { 'Content-Type': 'application/json', 'X-Room-Code': process.env.ROOM || '', 'X-Device-Key': process.env.KEY || '' };
const [cmd, uid, ago] = process.argv.slice(2);

async function call(method, path, body) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
  const ms = Math.round(performance.now() - t0);
  console.log(`${method} ${path} -> ${res.status} in ${ms} ms`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

if (cmd === 'heartbeat') await call('POST', '/heartbeat', {});
else if (cmd === 'sync') await call('GET', '/timetable/sync');
else if (cmd === 'swipe') await call('POST', '/swipe', { card_uid: uid });
else if (cmd === 'swipe-queued') await call('POST', '/swipe', { card_uid: uid, queued: true, timestamp: Math.floor(Date.now() / 1000) - Number(ago || 60) });
else console.log('Commands: heartbeat | sync | swipe <UID> | swipe-queued <UID> [secondsAgo]');
