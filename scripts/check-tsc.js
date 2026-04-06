const { execSync } = require('child_process');
const fs = require('fs');
try {
  execSync('npx tsc --noEmit', { stdio: 'pipe' });
  fs.writeFileSync('tsc-result.txt', 'TSC SUCCESS');
} catch (e) {
  let errStr = 'TSC ERROR\n';
  errStr += 'STDOUT:\n' + (e.stdout ? e.stdout.toString() : '') + '\n';
  errStr += 'STDERR:\n' + (e.stderr ? e.stderr.toString() : '');
  fs.writeFileSync('tsc-result.txt', errStr);
}
