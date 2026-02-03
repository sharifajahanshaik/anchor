/**
 * Configuration service for managing and validating application configuration
 */

import { join } from 'path';
import type {
	AppConfig,
	TelemetryConfig,
	ExternalServicesConfig,
	DebugConfig,
	AppEnvironment
} from './config.types';

/**
 * Get and validate telemetry configuration
 */
function getTelemetryConfig(): TelemetryConfig {
	const enabled = process.env.ENABLE_TELEMETRY !== 'false';
	const collectorEndpoint = process.env.OTEL_COLLECTOR_ENDPOINT || 'https://crane.beta.breeze.in';
	const environment = (process.env.PUBLIC_APP_ENVIRONMENT || 'release') as AppEnvironment;
	const appName = process.env.PUBLIC_APP_NAME || 'abandonment';
	const appVersion = process.env.PUBLIC_APP_VERSION || '1.0.0';
	const buildTimestamp = process.env.PUBLIC_BUILD_TIMESTAMP || '';

	return {
		enabled,
		collectorEndpoint,
		environment,
		appName,
		appVersion,
		buildTimestamp
	};
}

/**
 * Get external services configuration (optional services)
 */
function getExternalServicesConfig(): ExternalServicesConfig {
	return {
		slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
		craneEndpoint: process.env.CRANE_ENDPOINT
	};
}

/**
 * Get debug configuration
 */
function getDebugConfig(): DebugConfig {
	const environment = (process.env.PUBLIC_APP_ENVIRONMENT || 'release') as AppEnvironment;
	const isDevelopment = environment === 'dev' || environment === 'development' || environment === 'test';

	return {
		enabled: isDevelopment,
		saveHtmlFiles: isDevelopment,
		logPayloads: isDevelopment,
		logResponses: isDevelopment,
		outputDirectory: join(process.cwd(), 'dev', 'debug')
	};
}

/**
 * Load and validate complete application configuration
 */
export function loadConfig(): AppConfig {
	return {
		telemetry: getTelemetryConfig(),
		externalServices: getExternalServicesConfig(),
		debug: getDebugConfig()
	};
}

/**
 * Validate configuration without throwing errors
 * Returns validation results
 */
export function validateConfig(): {
	valid: boolean;
	errors: string[];
	warnings: string[];
} {
	const warnings: string[] = [];

	// Check optional but recommended configurations
	if (!process.env.SLACK_WEBHOOK_URL) {
		warnings.push('SLACK_WEBHOOK_URL not configured - alerts will not be sent to Slack');
	}

	if (!process.env.CRANE_ENDPOINT) {
		warnings.push('CRANE_ENDPOINT not configured - external crane service integration disabled');
	}

	return {
		valid: true,
		errors: [],
		warnings
	};
}

// Singleton instance - load config once at startup
let configInstance: AppConfig | null = null;

/**
 * Get application configuration
 * Loads and caches configuration on first call
 */
export function getConfig(): AppConfig {
	if (!configInstance) {
		configInstance = loadConfig();
	}
	return configInstance;
}

/**
 * Reset cached configuration (useful for testing)
 */
export function resetConfig(): void {
	configInstance = null;
}
