/**
 * feedstock cache stats|clear|prune — cache management
 */

import { CrawlCache } from "../../cache/database";
import { exitUsageError } from "../errors";
import { emitJSON } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getNumber } from "../parse-args";

export async function runCache(args: ParsedArgs): Promise<void> {
	const sub = args.positionals[0];
	if (!sub) exitUsageError("Missing subcommand", "Usage: feedstock cache <stats|clear|prune>");

	const cache = new CrawlCache();

	try {
		switch (sub) {
			case "stats": {
				const dbPath = `${process.env.HOME ?? "~"}/.feedstock/cache.db`;
				const fileSize = (await Bun.file(dbPath).exists()) ? Bun.file(dbPath).size : 0;
				emitJSON({
					entries: cache.size,
					path: dbPath,
					sizeBytes: fileSize,
					sizeMB: +(fileSize / 1024 / 1024).toFixed(2),
				});
				break;
			}
			case "clear": {
				const count = cache.size;
				cache.clear();
				emitJSON({ cleared: count, message: `Cleared ${count} entries` });
				break;
			}
			case "prune": {
				const olderThan = getNumber(args.flags, "older-than");
				if (olderThan === undefined) {
					exitUsageError(
						"--older-than is required for prune",
						"Usage: feedstock cache prune --older-than <ms>",
					);
				}
				const removed = cache.pruneOlderThan(olderThan);
				emitJSON({
					pruned: removed,
					message: `Pruned ${removed} entries older than ${olderThan}ms`,
				});
				break;
			}
			default:
				exitUsageError(`Unknown cache subcommand: ${sub}`, "Available: stats, clear, prune");
		}
	} finally {
		cache.close();
	}
}
