import { flag, readFlags } from '@kjanat/dreamcli';

const { name } = await readFlags({ name: flag.string().required() });
console.log(name);
