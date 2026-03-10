const XLSX = require('xlsx');
const fs = require('fs');
const workbook = XLSX.readFile('c:\\\\Users\\\\FNS\\\\flyde\\\\form-data\\\\ofis-square\\\\Member Panel Screens List with API.xlsx');
let out = {};
workbook.SheetNames.forEach(sheetName => {
    out[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
});
fs.writeFileSync('c:\\\\Users\\\\FNS\\\\flyde\\\\form-data\\\\ofis-square\\\\member_app_screens_dump.json', JSON.stringify(out, null, 2));
