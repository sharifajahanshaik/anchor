/**
 * Health check types and interfaces
 */

/**
 * Health status of a component
 */
export enum HealthStatus {
	HEALTHY = 'healthy',
	DEGRADED = 'degraded',
	UNHEALTHY = 'unhealthy',
	UNKNOWN = 'unknown'
}

/**
 * Individual component health check result
 */
export interface ComponentHealth {
	/** Component name (e.g., "shopify", "otel", "database") */
	name: string;

	/** Current health status */
	status: HealthStatus;

	/** Human-readable message about the health status */
	message: string;

	/** Response time in milliseconds (if applicable) */
	responseTime?: number;

	/** Last successful check timestamp */
	lastCheck?: string;

	/** Additional metadata */
	metadata?: Record<string, unknown>;

	/** Error details if unhealthy */
	error?: {
		message: string;
		code?: string;
		stack?: string;
	};
}

/**
 * Overall system health result
 */
export interface SystemHealth {
	/** Overall system status (worst status among all components) */
	status: HealthStatus;

	/** Timestamp of this health check */
	timestamp: string;

	/** Application version */
	version: string;

	/** Environment (dev, staging, production) */
	environment: string;

	/** Individual component health statuses */
	components: ComponentHealth[];

	/** Overall response time for all checks */
	totalResponseTime: number;
}

/**
 * Health check function signature
 */
export type HealthCheckFunction = () => Promise<ComponentHealth>;

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
	/** Timeout for health check in milliseconds */
	timeout: number;

	/** Interval between health checks in milliseconds */
	interval?: number;

	/** Whether to enable detailed error messages */
	verbose: boolean;
}

/**
 * Health check result for API response
 */
export interface HealthCheckResponse {
	status: HealthStatus;
	timestamp: string;
	checks: {
		[key: string]: {
			status: HealthStatus;
			message: string;
			responseTime?: number;
			error?: string;
		};
	};
}