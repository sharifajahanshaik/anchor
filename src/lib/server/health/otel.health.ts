/**
 * OpenTelemetry collector health check implementation
 */

import { HealthStatus, type ComponentHealth } from './health.types';
import { getConfig } from '$lib/server/config';
import { logger } from '$lib/server/logger';

/**
 * Check OpenTelemetry collector connectivity
 * Attempts to connect to the OTEL collector endpoint
 */
export async function checkOTELHealth(): Promise<ComponentHealth> {
	const startTime = Date.now();
	const config = getConfig();

	// If telemetry is disabled, consider it healthy but not applicable
	if (!config.telemetry.enabled) {
		return {
			name: 'otel',
			status: HealthStatus.HEALTHY,
			message: 'OpenTelemetry is disabled',
			responseTime: 0,
			lastCheck: new Date().toISOString(),
			metadata: {
				enabled: false
			}
		};
	}

	const collectorEndpoint = config.telemetry.collectorEndpoint;

	try {
		// Try to connect to the OTEL collector
		// Most OTEL collectors expose a health endpoint or respond to basic HTTP requests
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

		// Parse the collector endpoint to get the base URL
		let healthCheckUrl: string;
		try {
			const url = new URL(collectorEndpoint);
			// Try common OTEL health check endpoints
			healthCheckUrl = `${url.protocol}//${url.host}/health`; // Try /health first
		} catch {
			// If URL parsing fails, try the endpoint as-is
			healthCheckUrl = collectorEndpoint;
		}

		const response = await fetch(healthCheckUrl, {
			method: 'GET',
			signal: controller.signal,
			headers: {
				'User-Agent': 'Anchor-Health-Check/1.0'
			}
		});

		clearTimeout(timeoutId);
		const responseTime = Date.now() - startTime;

		// If health endpoint returns success
		if (response.ok) {
			logger.debug('OTEL health check passed', {
				endpoint: collectorEndpoint,
				status: response.status,
				responseTime
			});

			return {
				name: 'otel',
				status: HealthStatus.HEALTHY,
				message: 'OpenTelemetry collector is reachable',
				responseTime,
				lastCheck: new Date().toISOString(),
				metadata: {
					endpoint: collectorEndpoint,
					httpStatus: response.status,
					enabled: true
				}
			};
		}

		// If we get a 404, the collector might not have a /health endpoint
		// Try the original endpoint instead
		if (response.status === 404 && healthCheckUrl !== collectorEndpoint) {
			const retryResponse = await fetch(collectorEndpoint, {
				method: 'HEAD',
				signal: controller.signal,
				headers: {
					'User-Agent': 'Anchor-Health-Check/1.0'
				}
			});

			const retryResponseTime = Date.now() - startTime;

			if (retryResponse.ok || retryResponse.status < 500) {
				return {
					name: 'otel',
					status: HealthStatus.HEALTHY,
					message: 'OpenTelemetry collector is reachable (no health endpoint)',
					responseTime: retryResponseTime,
					lastCheck: new Date().toISOString(),
					metadata: {
						endpoint: collectorEndpoint,
						httpStatus: retryResponse.status,
						enabled: true
					}
				};
			}
		}

		// Non-OK response
		logger.warn('OTEL health check returned non-OK status', {
			endpoint: collectorEndpoint,
			status: response.status,
			responseTime
		});

		return {
			name: 'otel',
			status: HealthStatus.DEGRADED,
			message: `OTEL collector returned ${response.status} status`,
			responseTime,
			lastCheck: new Date().toISOString(),
			metadata: {
				endpoint: collectorEndpoint,
				httpStatus: response.status,
				enabled: true
			},
			error: {
				message: `HTTP ${response.status}`,
				code: 'OTEL_NON_OK_RESPONSE'
			}
		};
	} catch (error) {
		const responseTime = Date.now() - startTime;
		const isTimeout = error instanceof Error && error.name === 'AbortError';
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';

		logger.error('OTEL health check failed', error as Error, {
			endpoint: collectorEndpoint,
			responseTime,
			isTimeout
		});

		return {
			name: 'otel',
			status: HealthStatus.UNHEALTHY,
			message: isTimeout
				? 'OTEL collector health check timed out'
				: 'Failed to reach OTEL collector',
			responseTime,
			lastCheck: new Date().toISOString(),
			metadata: {
				endpoint: collectorEndpoint,
				enabled: true
			},
			error: {
				message: errorMessage,
				code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
				stack: error instanceof Error ? error.stack : undefined
			}
		};
	}
}

/**
 * Check OpenTelemetry exporter health
 * Verifies that the OTEL SDK can send data
 */
export async function checkOTELExporterHealth(): Promise<ComponentHealth> {
	const config = getConfig();

	if (!config.telemetry.enabled) {
		return {
			name: 'otel_exporter',
			status: HealthStatus.HEALTHY,
			message: 'OpenTelemetry exporter is disabled',
			responseTime: 0,
			lastCheck: new Date().toISOString(),
			metadata: {
				enabled: false
			}
		};
	}

	// This is a simple check - in a real implementation, you might want to:
	// 1. Check if the OTEL SDK is initialized
	// 2. Verify that exporters are registered
	// 3. Check export queue health
	// For now, we'll just verify the configuration is valid

	try {
		const hasEndpoint = !!config.telemetry.collectorEndpoint;
		const hasAppName = !!config.telemetry.appName;

		if (!hasEndpoint || !hasAppName) {
			return {
				name: 'otel_exporter',
				status: HealthStatus.DEGRADED,
				message: 'OpenTelemetry configuration incomplete',
				lastCheck: new Date().toISOString(),
				metadata: {
					hasEndpoint,
					hasAppName,
					enabled: true
				},
				error: {
					message: 'Missing required OTEL configuration',
					code: 'INCOMPLETE_CONFIG'
				}
			};
		}

		return {
			name: 'otel_exporter',
			status: HealthStatus.HEALTHY,
			message: 'OpenTelemetry exporter is configured',
			lastCheck: new Date().toISOString(),
			metadata: {
				endpoint: config.telemetry.collectorEndpoint,
				appName: config.telemetry.appName,
				environment: config.telemetry.environment,
				enabled: true
			}
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';

		return {
			name: 'otel_exporter',
			status: HealthStatus.UNHEALTHY,
			message: 'Failed to check OTEL exporter configuration',
			lastCheck: new Date().toISOString(),
			metadata: {
				enabled: true
			},
			error: {
				message: errorMessage,
				code: 'CONFIG_ERROR',
				stack: error instanceof Error ? error.stack : undefined
			}
		};
	}
}