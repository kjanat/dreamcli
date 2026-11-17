#!/usr/bin/env bun
/**
 * Single-transport launcher (language-server style).
 *
 * A launcher that starts over exactly one transport. The command validates
 * the selection with `.constrain()`, then derives a typed `Transport` for
 * the action.
 *
 * Demonstrates: an exactly-one constraint,
 * declarative numeric constraints (`flag.number({ int: true, min: 1, max: 65535 })`),
 * a kebab-case flag name accessed with bracket notation (`flags['node-ipc']`),
 * and passing a typed result to the action through derived context.
 *
 * Usage:
 *   npx tsx examples/transport-launcher.ts --stdio
 *   npx tsx examples/transport-launcher.ts --node-ipc
 *   npx tsx examples/transport-launcher.ts --socket 6009
 *   npx tsx examples/transport-launcher.ts            # error: pick exactly one
 *   npx tsx examples/transport-launcher.ts --stdio --node-ipc  # error: only one
 *   npx tsx examples/transport-launcher.ts --help
 */

import { cli, command, flag } from '@kjanat/dreamcli';

// One resolved transport — illegal states are unrepresentable.
type Transport =
	| { readonly kind: 'stdio' }
	| { readonly kind: 'node-ipc' }
	| { readonly kind: 'socket'; readonly port: number };

const launcher = command('lsp-server')
	.description('Launch the language server over exactly one transport')
	.flag('stdio', flag.boolean().describe('Use the stdio transport'))
	.flag('node-ipc', flag.boolean().describe('Use the Node IPC transport'))
	.flag(
		'socket',
		flag.number({ int: true, min: 1, max: 65535 }).describe('Use a TCP socket on <port>'),
	)
	.constrain((c) => [c.exactlyOne('stdio', 'node-ipc', 'socket')])
	.derive(({ flags }): { transport: Transport } => {
		if (flags.stdio) return { transport: { kind: 'stdio' } };
		if (flags['node-ipc']) return { transport: { kind: 'node-ipc' } };
		if (flags.socket !== undefined) {
			return { transport: { kind: 'socket', port: flags.socket } };
		}

		throw new Error('Validated transport selection is missing');
	})
	.action(({ ctx, out }) => {
		// ctx.transport: Transport — fully typed, ready to hand to the server.
		switch (ctx.transport.kind) {
			case 'stdio':
				out.log('Starting language server over stdio');
				break;
			case 'node-ipc':
				out.log('Starting language server over node-ipc');
				break;
			case 'socket':
				out.log(`Starting language server over socket :${ctx.transport.port}`);
				break;
		}
	});

void cli('lsp-server').default(launcher).run();
