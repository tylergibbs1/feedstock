/**
 * Minimal argument parser — no external dependencies.
 * Designed for agent consumption: long flags only, no aliases.
 */

export interface ParsedArgs {
	command: string;
	positionals: string[];
	flags: Record<string, string | boolean | string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(0); // don't mutate
	const command = args.shift() ?? "";
	const positionals: string[] = [];
	const flags: Record<string, string | boolean | string[]> = {};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		// Stop parsing flags after --
		if (arg === "--") {
			positionals.push(...args.slice(i + 1));
			break;
		}

		if (arg.startsWith("--")) {
			// --no-flag negation
			if (arg.startsWith("--no-")) {
				flags[arg.slice(5)] = false;
				i++;
				continue;
			}

			// --flag=value
			const eqIdx = arg.indexOf("=");
			if (eqIdx !== -1) {
				const key = arg.slice(2, eqIdx);
				const val = arg.slice(eqIdx + 1);
				appendFlag(flags, key, val);
				i++;
				continue;
			}

			// --flag value or --flag (boolean)
			const key = arg.slice(2);
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				appendFlag(flags, key, next);
				i += 2;
			} else {
				flags[key] = true;
				i++;
			}
		} else {
			positionals.push(arg);
			i++;
		}
	}

	return { command, positionals, flags };
}

function appendFlag(
	flags: Record<string, string | boolean | string[]>,
	key: string,
	value: string,
): void {
	const existing = flags[key];
	if (existing === undefined) {
		flags[key] = value;
	} else if (Array.isArray(existing)) {
		existing.push(value);
	} else if (typeof existing === "string") {
		flags[key] = [existing, value];
	} else {
		flags[key] = value; // overwrite boolean
	}
}

/** Get a flag value as string, or undefined */
export function getString(
	flags: Record<string, string | boolean | string[]>,
	key: string,
): string | undefined {
	const v = flags[key];
	return typeof v === "string" ? v : undefined;
}

/** Get a flag value as number, or undefined */
export function getNumber(
	flags: Record<string, string | boolean | string[]>,
	key: string,
): number | undefined {
	const v = getString(flags, key);
	if (v === undefined) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

/** Get a flag value as boolean (true if present, false if --no-flag) */
export function getBool(
	flags: Record<string, string | boolean | string[]>,
	key: string,
): boolean | undefined {
	const v = flags[key];
	if (v === undefined) return undefined;
	if (typeof v === "boolean") return v;
	if (v === "true") return true;
	if (v === "false") return false;
	return true; // --flag with any value = true
}

/** Get a flag value as string array (handles repeated flags and comma-separated) */
export function getStringArray(
	flags: Record<string, string | boolean | string[]>,
	key: string,
): string[] | undefined {
	const v = flags[key];
	if (v === undefined) return undefined;
	if (Array.isArray(v)) return v.flatMap((s) => s.split(","));
	if (typeof v === "string") return v.split(",");
	return undefined;
}
