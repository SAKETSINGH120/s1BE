import { executeRequest } from '../services/execution/execution.service.js';

export async function execute(req, res) {
  // Cancel the outbound request if the client disconnects before we respond.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const response = await executeRequest(req.workspace, req.body, { signal: controller.signal });
  res.json({ response });
}
