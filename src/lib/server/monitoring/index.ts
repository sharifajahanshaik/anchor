/**
 * Monitoring Module
 *
 * Exports all monitoring-related services and types.
 * Provides centralized API response monitoring and alerting.
 */

// Export types and enums
export {
	StatusCodeCategory,
	ApiEndpoint,
	isNon200,
	getStatusCodeCategory,
	formatEndpoint
} from './monitoring.types';

export type {
	ApiResponseData,
	StatusCodeStats,
	ApiResponseMonitorConfig,
	Non200AlertConfig,
	IApiResponseMonitor,
	IStatusCodeTracker,
	INon200Alerter
} from './monitoring.types';

// Export implementations
export { StatusCodeTracker } from './status-code.tracker';
export { ApiResponseMonitor } from './api-response.monitor';
export { Non200Alerter } from './non-200.alerter';
export { MonitoringSummaryReporter, createSummaryReporter } from './summary-reporter';
export type { SummaryReporterConfig, SummaryStats, ShopFailureStats } from './summary-reporter';
