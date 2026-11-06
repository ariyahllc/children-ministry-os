// Self-check for the next-year calendar draft (draftYear_ in Code.gs). Runs in CI before deploy.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const ctx = { PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) } }; // Code.gs reads this at load time
vm.runInNewContext(readFileSync('apps-script-planner/Code.gs', 'utf8'), ctx);
const ev = (name, event_date, extra = {}) => ({ id: name + event_date, name, event_date, month: '', ...extra });
const epics = [
  ev('Mothers Day', '2025-05-11'), ev('Mothers Day', '2026-05-10'),            // 2nd Sunday of May
  ev('Christmas Day', '2024-12-25'), ev('Christmas Day', '2025-12-25'),        // fixed date
  ev('Resurrection Sunday', '2025-04-20'), ev('Resurrection Sunday', '2026-04-05'), // Easter
  ev('Picnic', '2024-08-25'), ev('Picnic', '2025-08-31'),                      // last Sunday of August
  ev('VBS 2024', '2024-07-14'), ev('VBS 2026', '2026-06-21'),                  // no pattern: month pin, year dropped
  ev('Coat Drive', '2025-11-02'),                                              // one year only: month pin
  ev('Team Meeting', '2025-09-07'), ev('Team Meeting', '2025-10-05'),          // repeats: one per month
  ev('Sunday School', '2025-09-07'), ev('Action Items 2025-26', ''),           // buckets: never copied
  ev('Harvest', '2024-10-06'), ev('Harvest', '2025-10-05'),                    // already on next year's calendar
  ev('Harvest', '2027-10-03'),
  ev('Fall Bash', '2024-10-13'), ev('Fall Bash', '2025-10-26'), ev('Fall Bash', '2026-10-25'), // moved: newest 2 years decide (4th Sunday)
  ev('New This Year', '2026-09-13'),                                           // only in the current year: still carried over
];
const { items, skipped } = ctx.draftYear_(epics, 2027);
const get = (n) => items.find((i) => i.name === n);
assert.equal(get('Mothers Day').event_date, '2028-05-14');
assert.equal(get('Mothers Day').tentative, 'yes');
assert.equal(get('Christmas Day').event_date, '2027-12-25');
assert.equal(get('Christmas Day').tentative, '');
assert.equal(get('Resurrection Sunday').event_date, '2028-04-16');
assert.equal(get('Picnic').event_date, '2027-08-29');
assert.equal(get('VBS').month, '2028-06');
assert.equal(get('Coat Drive').month, '2027-11');
assert.equal(items.filter((i) => i.name === 'Team Meeting').length, 2);
assert.ok(!get('Sunday School') && !get('Harvest') && !items.some((i) => /action/i.test(i.name)));
assert.equal(get('Fall Bash').event_date, '2027-10-24');
assert.equal(get('New This Year').month, '2027-09');
assert.equal(skipped, 1);
assert.equal(ctx.draftYear_([...epics, ...items.map((i) => ({ ...i, id: i.name + 'x' }))], 2027).items.length, 0); // running twice adds nothing
console.log('draft year checks pass');
