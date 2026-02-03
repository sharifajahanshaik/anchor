/**
 * Health check service - aggregates all health checks and provides system health status
 */

import {
	HealthStatus,
	type SystemHealth,
	type ComponentHealth,
	type HealthCheckResponse
} from './health.types';
import { checkShopifyHealth } from './shopify.health';
import { checkOTELHealth, checkOTELExporterHealth } from './otel.health';
import { getConfig } from '$lib/server/config';
import { logger } from '$lib/server/logger';

/**
 * Determine the worst health status from a list of component healths
 */
function getWorstStatus(statuses: HealthStatus[]): HealthStatus {
	// Priority: UNHEALTHY > DEGRADED > UNKNOWN > HEALTHY
	if (statuses.includes(HealthStatus.UNHEALTHY)) {
		return HealthStatus.UNHEALTHY;
	}
	if (statuses.includes(HealthStatus.DEGRADED)) {
		return HealthStatus.DEGRADED;
	}
	if (statuses.includes(HealthStatus.UNKNOWN)) {
		return HealthStatus.UNKNOWN;
	}
	return HealthStatus.HEALTHY;
}

/**
 * Run all health checks and aggregate results
 */
export async function checkSystemHealth(): Promise<SystemHealth> {
	const startTime = Date.now();
	const config = getConfig();

	try {
		// Run all health checks in parallel for faster response
		const [shopifyHealth, otelHealth, otelExporterHealth] = await Promise.all([
			checkShopifyHealth().catch((error) => {
				logger.error('Shopify health check threw error', error);
				return {
					name: 'shopify',
					status: HealthStatus.UNHEALTHY,
					message: 'Health check failed with exception',
					error: {
						message: error instanceof Error ? error.message : 'Unknown error',
						code: 'HEALTH_CHECK_EXCEPTION'
					}
				} as ComponentHealth;
			}),
			checkOTELHealth().catch((error) => {
				logger.error('OTEL health check threw error', error);
				return {
					name: 'otel',
					status: HealthStatus.UNHEALTHY,
					message: 'Health check failed with exception',
					error: {
						message: error instanceof Error ? error.message : 'Unknown error',
						code: 'HEALTH_CHECK_EXCEPTION'
					}
				} as ComponentHealth;
			}),
			checkOTELExporterHealth().catch((error) => {
				logger.error('OTEL exporter health check threw error', error);
				return {
					name: 'otel_exporter',
					status: HealthStatus.UNHEALTHY,
					message: 'Health check failed with exception',
					error: {
						message: error instanceof Error ? error.message : 'Unknown error',
						code: 'HEALTH_CHECK_EXCEPTION'
					}
				} as ComponentHealth;
			})
		]);

		const components = [shopifyHealth, otelHealth, otelExporterHealth];
		const statuses = components.map((c) => c.status);
		const overallStatus = getWorstStatus(statuses);
		const totalResponseTime = Date.now() - startTime;

		const systemHealth: SystemHealth = {
			status: overallStatus,
			timestamp: new Date().toISOString(),
			version: config.telemetry.appVersion || '1.0.0',
			environment: config.telemetry.environment,
			components,
			totalResponseTime
		};

		logger.debug('System health check completed', {
			status: overallStatus,
			totalResponseTime,
			componentStatuses: components.map((c) => ({ name: c.name, status: c.status }))
		});

		return systemHealth;
	} catch (error) {
		logger.error('System health check failed catastrophically', error as Error);

		// Return unhealthy system health
		return {
			status: HealthStatus.UNHEALTHY,
			timestamp: new Date().toISOString(),
			version: config.telemetry.appVersion || '1.0.0',
			environment: config.telemetry.environment,
			components: [
				{
					name: 'system',
					status: HealthStatus.UNHEALTHY,
					message: 'System health check failed',
					error: {
						message: error instanceof Error ? error.message : 'Unknown error',
						code: 'SYSTEM_HEALTH_CHECK_FAILURE',
						stack: error instanceof Error ? error.stack : undefined
					}
				}
			],
			totalResponseTime: Date.now() - startTime
		};
	}
}

/**
 * Run health check for a specific component
 */
export async function checkComponentHealth(componentName: string): Promise<ComponentHealth> {
	switch (componentName.toLowerCase()) {
		case 'shopify':
			return checkShopifyHealth();

		case 'otel':
		case 'opentelemetry':
			return checkOTELHealth();

		case 'otel_exporter':
		case 'exporter':
			return checkOTELExporterHealth();

		default:
			return {
				name: componentName,
				status: HealthStatus.UNKNOWN,
				message: `Unknown component: ${componentName}`,
				lastCheck: new Date().toISOString()
			};
	}
}

/**
 * Convert SystemHealth to a simple API response format
 */
export function toHealthCheckResponse(systemHealth: SystemHealth): HealthCheckResponse {
	const checks: HealthCheckResponse['checks'] = {};

	for (const component of systemHealth.components) {
		checks[component.name] = {
			status: component.status,
			message: component.message,
			responseTime: component.responseTime,
			error: component.error?.message
		};
	}

	return {
		status: systemHealth.status,
		timestamp: systemHealth.timestamp,
		checks
	};
}

/**
 * Get a simple boolean health status
 * Returns true if the system is healthy or degraded, false if unhealthy
 */
export function isSystemHealthy(systemHealth: SystemHealth): boolean {
	return (
		systemHealth.status === HealthStatus.HEALTHY ||
		systemHealth.status === HealthStatus.DEGRADED
	);
}

/**
 * Get HTTP status code based on health status
 */
export function getHealthHttpStatus(status: HealthStatus): number {
	switch (status) {
		case HealthStatus.HEALTHY:
			return 200;
		case HealthStatus.DEGRADED:
			return 200; // Still operational
		case HealthStatus.UNHEALTHY:
			return 503; // Service Unavailable
		case HealthStatus.UNKNOWN:
			return 500; // Internal Server Error
		default:
			return 500;
	}
}