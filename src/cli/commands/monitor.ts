/**
 * feedstock monitor — start live monitoring dashboard
 */

import { MonitorDashboard } from "../../utils/dashboard";
import { CrawlerMonitor } from "../../utils/monitor";
import { emitJSON } from "../output";
import type { ParsedArgs } from "../parse-args";
import { getNumber, getString } from "../parse-args";

export async function runMonitor(args: ParsedArgs): Promise<void> {
	const port = getNumber(args.flags, "port") ?? 3200;
	const hostname = getString(args.flags, "hostname") ?? "127.0.0.1";

	const monitor = new CrawlerMonitor();
	monitor.start();

	const dashboard = new MonitorDashboard(monitor, { port, hostname });
	dashboard.start();

	const url = dashboard.url;
	emitJSON({ status: "running", url, port, hostname });

	// Keep process alive
	process.on("SIGINT", () => {
		dashboard.stop();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		dashboard.stop();
		process.exit(0);
	});

	// Block forever
	await new Promise(() => {});
}
