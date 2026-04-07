declare module "@lightpanda/browser" {
	interface LightpandaServeOptions {
		host?: string;
		port?: number;
	}

	interface LightpandaProcess {
		stdout: { destroy(): void } | null;
		stderr: { destroy(): void } | null;
		kill(): void;
	}

	interface Lightpanda {
		serve(opts: LightpandaServeOptions): Promise<LightpandaProcess>;
	}

	export const lightpanda: Lightpanda;
}
