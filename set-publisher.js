// usage: node set-publisher.js <publisherId>
const fs = require('fs');
const id = process.argv[2];
if (!id) { console.error('missing publisher id'); process.exit(1); }
const p = require('path').join(__dirname, 'package.json');
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.publisher = id;
fs.writeFileSync(p, JSON.stringify(j, null, '\t'), 'utf8');
console.log('publisher set to:', id);
