const fs = require('fs');
const data = require('./member_app_screens_dump.json');
let md = '# Member App Flow\\n\\n';
data['Screens List'].forEach((row) => {
    if (row['Screen Name']) {
        md += '## Screen: ' + row['Screen Name'] + '\\n';
        if (row['API curl']) {
            // Just extract the URL, method
            let curl = row['API curl'];
            let urlMatch = curl.match(/'(http.*?)'/);
            let url = urlMatch ? urlMatch[1] : curl.split('\\n')[0];
            let methodMatch = curl.match(/-X\\s+([A-Z]+)|--request\\s+([A-Z]+)/);
            let method = methodMatch ? (methodMatch[1] || methodMatch[2]) : (curl.includes('--data') ? 'POST' : 'GET');
            md += '- **API**: ' + method + ' ' + url + '\\n';
        }
    }
});
fs.writeFileSync('member_app_flow_summary.md', md);
