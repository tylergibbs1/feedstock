export enum CacheMode {
	Enabled = "enabled",
	Disabled = "disabled",
	ReadOnly = "read_only",
	WriteOnly = "write_only",
	Bypass = "bypass",
}

export function shouldReadCache(mode: CacheMode): boolean {
	return mode === CacheMode.Enabled || mode === CacheMode.ReadOnly;
}

export function shouldWriteCache(mode: CacheMode): boolean {
	return mode === CacheMode.Enabled || mode === CacheMode.WriteOnly;
}
