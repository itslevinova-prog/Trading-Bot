import {loadCostReport} from './cost-report.js';

const args = process.argv.slice(2);
try {
  if (args.length !== 2 || args[0] !== '--month')
    throw Error('Usage: pnpm cost:report --month YYYY-MM');
  // A JSON observation report is not the final certified docs/cost-hurdle-latest.json.
  console.log(JSON.stringify(loadCostReport(args[1]!), null, 2));
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
