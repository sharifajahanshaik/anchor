/**
 * Health check API endpoint
 *
 * GET /api/health - Returns overall system health status
 * GET /api/health?component=shopify - Returns specific component health
 */

import type { RequestHandler } from '@sveltejs/kit';
import {
	checkSystemHealth,
	checkComponentHealth,
	toHealthCheckResponse,
	getHealthHttpStatus
} from '$lib/server/health';
import { logger } from '$lib/server/logger';

export const GET: RequestHandler = async ({ url }) => {
	const component = url.searchParams.get('component');

	try {
		// If a specific component is requested
		if (component) {
			logger.debug('Health check requested for specific component', { component });

			const componentHealth = await checkComponentHealth(component);
			const httpStatus = getHealthHttpStatus(componentHealth.status);

			return new Response(
				JSON.stringify({
					status: componentHealth.status,
					timestamp: new Date().toISOString(),
					component: componentHealth
				}),
				{
					status: httpStatus,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache, no-store, must-revalidate'
					}
				}
			);
		}

		// Full system health check
		logger.debug('Full system health check requested');

		const systemHealth = await checkSystemHealth();
		const healthResponse = toHealthCheckResponse(systemHealth);
		const httpStatus = getHealthHttpStatus(systemHealth.status);

		// Log unhealthy status
		if (systemHealth.status !== 'healthy') {
			logger.warn('System health check returned non-healthy status', {
				status: systemHealth.status,
				unhealthyComponents: systemHealth.components
					.filter((c) => c.status !== 'healthy')
					.map((c) => c.name)
			});
		}

		return new Response(JSON.stringify(healthResponse), {
			status: httpStatus,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache, no-store, must-revalidate'
			}
		});
	} catch (error) {
		logger.error('Health check endpoint failed', error as Error);

		return new Response(
			JSON.stringify({
				status: 'unhealthy',
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : 'Unknown error'
			}),
			{
				status: 503,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-cache, no-store, must-revalidate'
				}
			}
		);
	}
};
