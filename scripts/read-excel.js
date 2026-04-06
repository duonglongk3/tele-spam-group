const XLSX = require('xlsx');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'formmail.xlsx');
const workbook = XLSX.readFile(filePath);

workbook.SheetNames.forEach(sheetName => {
  console.log(`\n=== Sheet: ${sheetName} ===`);
  const sheet = workbook.Sheets[sheetName];
  
  // Print raw cell data with formulas for first 5 rows
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  console.log(`Range: ${sheet['!ref']}`);
  
  for (let r = range.s.r; r <= Math.min(range.e.r, 3); r++) {
    console.log(`\n--- ROW ${r} ---`);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellAddr];
      if (cell) {
        console.log(`  ${cellAddr}: value="${cell.v}" ${cell.f ? `formula="${cell.f}"` : ''} type=${cell.t}`);
      }
    }
  }
});
