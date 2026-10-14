// Builds the GitHub Pages copy of the app into _site/. Same Index.html as Apps
// Script serves; it just talks to the web app's doPost JSON API instead of
// google.script.run. Required env: DEPLOYMENT_ID (the live web app deployment).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const { DEPLOYMENT_ID } = process.env;
if (!DEPLOYMENT_ID) { console.error('Missing env DEPLOYMENT_ID'); process.exit(1); }

const swap = (html, from, to) => {
  if (!html.includes(from)) throw new Error('Marker not found in Index.html: ' + from);
  return html.replace(from, to);
};

let html = readFileSync('apps-script-planner/Index.html', 'utf8');
html = swap(html, "var API_URL='';", `var API_URL='https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec';`);
html = swap(html, "'<?= inviteToken ?>'", "''"); // Apps Script template tag; the page reads ?k= itself
// Head tags doGet adds on the Apps Script side.
html = swap(html, '<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>CM Planner</title>\n'
  + `<link rel="icon" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%231f4d39'/><path d='M28 13h8v13h13v8H36v17h-8V34H15v-8h13z' fill='%23fbfdf9'/></svg>">`);
if (html.includes('<?')) throw new Error('Unhandled Apps Script template tag left in Index.html');

mkdirSync('_site', { recursive: true });
writeFileSync('_site/index.html', html);
console.log('✓ built _site/index.html');
