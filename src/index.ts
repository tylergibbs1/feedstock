// Core

export { CrawlCache } from "./cache/database";
// Cache
export { CacheMode } from "./cache/mode";
export { type CacheValidationResult, CacheValidator } from "./cache/validator";
// Config
export {
	type BrowserBackend,
	type BrowserConfig,
	type BrowserType,
	type CrawlerRunConfig,
	createBrowserConfig,
	createCrawlerRunConfig,
	type ExtractionStrategyConfig,
	type ProxyConfig,
	type WaitForType,
} from "./config";
export { WebCrawler, type WebCrawlerOptions } from "./crawler";
// Deep Crawl
export {
	BestFirstDeepCrawlStrategy,
	BFSDeepCrawlStrategy,
	CompositeScorer,
	ContentTypeFilter,
	createDeepCrawlConfig,
	type DeepCrawlConfig,
	DeepCrawlStrategy,
	DFSDeepCrawlStrategy,
	DomainAuthorityScorer,
	DomainFilter,
	FilterChain,
	type FilterResult,
	type FilterStats,
	FreshnessScorer,
	KeywordRelevanceScorer,
	MaxDepthFilter,
	PathDepthScorer,
	type ScorerContext,
	URLFilter,
	URLPatternFilter,
	URLScorer,
} from "./deep-crawl";
// Engines
export {
	Engine,
	type EngineCapabilities,
	EngineManager,
	type EngineManagerConfig,
	type EngineResult,
	FetchEngine,
	likelyNeedsJavaScript,
	PlaywrightEngine,
} from "./engines";
// Models
export {
	type ConsoleMessage,
	type CrawlResponse,
	type CrawlResult,
	createEmptyLinks,
	createEmptyMedia,
	createErrorResult,
	type InteractiveElement,
	type LinkItem,
	type Links,
	type MarkdownGenerationResult,
	type Media,
	type MediaItem,
	type NetworkRequest,
	type ScrapingResult,
} from "./models";
// Snapshot
export {
	buildStaticSnapshot,
	type PageSnapshot,
	type SnapshotNode,
	type SnapshotOptions,
	takeSnapshot,
} from "./snapshot";
// Chunking
export {
	ChunkingStrategy,
	FixedSizeChunking,
	IdentityChunking,
	RegexChunking,
	SlidingWindowChunking,
} from "./strategies/chunking";
// Content Filters
export {
	BM25ContentFilter,
	ContentFilterStrategy,
	PruningContentFilter,
} from "./strategies/content-filter";
// Strategies
export {
	CrawlerStrategy,
	type HookFn,
	type HookType,
	PlaywrightCrawlerStrategy,
} from "./strategies/crawler-strategy";
export {
	type ExtractedItem,
	ExtractionStrategy,
	NoExtractionStrategy,
} from "./strategies/extraction/base";
export {
	type CssExtractionSchema,
	CssExtractionStrategy,
	type CssField,
} from "./strategies/extraction/css";
export { RegexExtractionStrategy } from "./strategies/extraction/regex";
// Additional Extraction
export { TableExtractionStrategy } from "./strategies/extraction/table";
export {
	type XPathExtractionSchema,
	XPathExtractionStrategy,
	type XPathField,
} from "./strategies/extraction/xpath";
export {
	DefaultMarkdownGenerator,
	MarkdownGenerationStrategy,
} from "./strategies/markdown";
export {
	CheerioScrapingStrategy,
	ContentScrapingStrategy,
} from "./strategies/scraping-strategy";
export {
	applyStealthMode,
	isBlocked,
	type RetryConfig,
	simulateUser,
	withRetry,
} from "./utils/antibot";
export {
	type ChangeReport,
	type ChangeStatus,
	ChangeTracker,
	type ChangeTrackerConfig,
	type DiffChunk,
	type PageChange,
	type TextDiff,
} from "./utils/change-tracker";
export { toFriendlyError, withFriendlyErrors } from "./utils/errors";
export {
	cleanHtml,
	extractLinks,
	extractMedia,
	extractMetadata,
	scrapeAll,
} from "./utils/html";
export { extractAllStreaming } from "./utils/html-rewriter";
export { extractIframeContent, type InlinedIframe, inlineIframeContent } from "./utils/iframe";
export { extractInPage, type InPageExtractionResult } from "./utils/in-page-extract";
export { detectInteractiveElements } from "./utils/interactive";
export { detectInteractiveElementsStatic } from "./utils/interactive-static";
// Utils
export {
	ConsoleLogger,
	type Logger,
	type LogLevel,
	SilentLogger,
} from "./utils/logger";
export { CrawlerMonitor, type CrawlStats } from "./utils/monitor";
export { type ProxyRotationConfig, ProxyRotationStrategy } from "./utils/proxy-rotation";
export { RateLimiter, type RateLimiterConfig } from "./utils/rate-limiter";
export { type RobotsDirectives, RobotsParser, type RobotsRule } from "./utils/robots";
export {
	applyStorageState,
	getStorageStatePath,
	loadStorageState,
	type StorageState,
	saveStorageState,
} from "./utils/storage";
export { type SeedResult, URLSeeder } from "./utils/url-seeder";
export { getRandomUserAgent, UserAgentRotator } from "./utils/user-agents";
