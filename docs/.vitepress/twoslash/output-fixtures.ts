import { createOutput } from '@kjanat/dreamcli';

export const out = createOutput();
export const rows = [
  { name: 'web-1', status: 'running', uptime: 72 },
  { name: 'worker-1', status: 'degraded', uptime: 18 },
] as const;

export const deploy = async () => {};
export const tick = async () => {};
