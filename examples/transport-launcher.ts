#!/usr/bin/env bun
/**
 * Single-transport launcher (language-server style).
 *
 * A launcher that must be started over exactly one transport. dreamcli has no
 * native "mutually exclusive" / "exactly one of" modifier, so the rule is
 * expressed in `.derive()` — the resolution-time hook that runs after flags
 * resolve and before the action. The derived, fully typed `Transport` is then
 * handed to `.action()` through `ctx`.
 *
 * Demonstrates: an "exactly one of" rule via `.derive()` throwing `CLIError`, a
 * kebab-case flag name accessed with bracket notation (`flags['node-ipc']`), and
 * passing a typed result to the action through derived context.
 *
 * Usage:
 *   npx tsx examples/transport-launcher.ts --stdio
 *   npx tsx examples/transport-launcher.ts --node-ipc
 *   npx tsx examples/transport-launcher.ts --socket 6009
 *   npx tsx examples/transport-launcher.ts            # error: pick exactly one
 *   npx tsx examples/transport-launcher.ts --stdio --node-ipc  # error: only one
 *   npx tsx examples/transport-launcher.ts --help
 */

import { CLIError, cli, command, flag } from '@kjanat/dreamcli';

// One resolved transport — illegal states are unrepresentable.
type Transport =
	| { readonly kind: 'stdio' }
	| { readonly kind: 'node-ipc' }
	| { readonly kind: 'socket'; readonly port: number };

const launcher = command('lsp-server')
	.description('Launch the language server over exactly one transport')
	.flag('stdio', flag.boolean().describe('Use the stdio transport'))
	.flag('node-ipc', flag.boolean().describe('Use the Node IPC transport'))
	.flag('socket', flag.number().describe('Use a TCP socket on <port>'))
	// `.derive()` runs after resolution and before the action — the idiomatic
	// place for a constraint dreamcli does not express declaratively.
	.derive(({ flags }): { transport: Transport } => {
		const selected: Transport[] = [];
		if (flags.stdio) selected.push({ kind: 'stdio' });
		// Kebab-case flag names stay kebab in the handler: bracket access, no camelCasing.
		if (flags['node-ipc']) selected.push({ kind: 'node-ipc' });
		if (flags.socket !== undefined) {
			if (!Number.isInteger(flags.socket)) {
				throw new CLIError(`--socket expects an integer port (got ${flags.socket}).`, {
					code: 'INVALID_SOCKET_PORT',
					suggest: 'Pass a whole number, e.g. --socket 6009',
				});
			}
			selected.push({ kind: 'socket', port: flags.socket });
		}

		const [transport, ...rest] = selected;
		if (transport === undefined) {
			throw new CLIError('No transport selected.', {
				code: 'NO_TRANSPORT',
				suggest: 'Pass exactly one of --stdio, --node-ipc, or --socket <port>',
			});
		}
		if (rest.length > 0) {
			throw new CLIError('Choose exactly one transport flag.', {
				code: 'TOO_MANY_TRANSPORTS',
				suggest: 'Use only one of --stdio, --node-ipc, or --socket <port>',
			});
		}

		return { transport };
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
