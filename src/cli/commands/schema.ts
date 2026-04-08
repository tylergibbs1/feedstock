/**
 * feedstock schema [command] — runtime introspection for agents
 */

import { emitJSON } from "../output";
import type { ParsedArgs } from "../parse-args";
import { SCHEMAS } from "../schema";

export async function runSchema(args: ParsedArgs): Promise<void> {
	const command = args.positionals[0];

	if (!command) {
		// List all commands
		const commands = Object.values(SCHEMAS).map((s) => ({
			name: s.name,
			description: s.description,
			args: s.args.length,
			flags: Object.keys(s.flags).length,
		}));
		emitJSON({ commands });
		return;
	}

	const schema = SCHEMAS[command];
	if (!schema) {
		const available = Object.keys(SCHEMAS).join(", ");
		emitJSON({
			error: true,
			code: "UNKNOWN_COMMAND",
			message: `Unknown command: ${command}`,
			available,
		});
		process.exit(2);
	}

	emitJSON(schema);
}
