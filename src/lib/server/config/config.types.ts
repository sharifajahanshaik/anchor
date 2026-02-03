/**
 * Configuration types for the application
 */

/**
 * Application environment
 */
export type AppEnvironment = 'dev' | 'development' | 'staging' | 'production' | 'test' | 'release';

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
	enabled: boolean;
	collectorEndpoint: string;
	environment: AppEnvironment;
	appName: string;
	appVersion: string;
	buildTimestamp: string;
}

/**
 * External services configuration
 */
export interface ExternalServicesConfig {
	slackWebhookUrl?: string;
	craneEndpoint?: string;
}

/**
 * Debug configuration
 */
export interface DebugConfig {
	enabled: boolean;
	saveHtmlFiles: boolean;
	logPayloads: boolean;
	logResponses: boolean;
	outputDirectory: string;
}

/**
 * Complete application configuration
 */
export interface AppConfig {
	telemetry: TelemetryConfig;
	externalServices: ExternalServicesConfig;
	debug: DebugConfig;
}

/**
 * Configuration validation error
 */
export class ConfigValidationError extends Error {
	constructor(
		message: string,
		public readonly missingKeys: string[] = [],
		public readonly invalidKeys: string[] = []
	) {
		super(message);
		this.name = 'ConfigValidationError';
	}
}
