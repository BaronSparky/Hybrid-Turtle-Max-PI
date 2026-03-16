import { runTonightWorkflow } from '../packages/workflow/src';

async function main() {
  const result = await runTonightWorkflow();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Tonight workflow failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});