import { getTonightWorkflowCardData } from '../packages/workflow/src';

async function main() {
  const result = await getTonightWorkflowCardData();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Workflow card failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});