/**
 * Circuit Breaker Alert Integration
 *
 * Sends Slack alerts when circuit breakers open/close
 * Integrates resilience module with monitoring alerts
 */

import { getAlertService } from '../alerts';
import { AlertType, AlertSeverity, type Alert } from '../alerts/alert.types';
import { circuitBreaker, CircuitState } from './circuit-breaker';
import { logger } from '../logger';

/**
 * Circuit breaker state tracker for detecting state changes
 */
class CircuitBreakerAlerter {
	private knownStates: Map<string, CircuitState> = new Map();

	/**
	 * Start monitoring circuit breaker state changes
	 */
	start(): void {
		// Check circuit breaker states every 10 seconds
		setInterval(() => {
			this.checkForStateChanges();
		}, 10000);

		logger.info('Circuit breaker alerter started');
	}

	/**
	 * Check for circuit breaker state changes and send alerts
	 */
	private async checkForStateChanges(): Promise<void> {
		const currentStates = circuitBreaker.getAllStates();

		for (const [shop, currentState] of currentStates.entries()) {
			const previousState = this.knownStates.get(shop);

			// Detect state changes
			if (previousState !== currentState) {
				await this.sendStateChangeAlert(shop, previousState, currentState);
				this.knownStates.set(shop, currentState);
			}
		}
	}

	/**
	 * Send alert for circuit breaker state change
	 */
	private async sendStateChangeAlert(
		shop: string,
		previousState: CircuitState | undefined,
		newState: CircuitState
	): Promise<void> {
		// Only alert on OPEN and CLOSED transitions (HALF_OPEN is internal)
		if (newState === CircuitState.OPEN) {
			await this.sendCircuitOpenedAlert(shop);
		} else if (newState === CircuitState.CLOSED && previousState === CircuitState.HALF_OPEN) {
			await this.sendCircuitClosedAlert(shop);
		}
	}

	/**
	 * Send alert when circuit opens
	 */
	private async sendCircuitOpenedAlert(shop: string): Promise<void> {
		const metrics = circuitBreaker.getMetrics(shop);

		const alert: Alert = {
			type: AlertType.CIRCUIT_BREAKER,
			severity: AlertSeverity.CRITICAL,
			title: '🔴 Circuit Breaker OPENED',
			message: this.formatCircuitOpenedMessage(shop, metrics),
			timestamp: new Date(),
			context: {
				shop,
				state: CircuitState.OPEN,
				consecutiveFailures: metrics?.consecutiveFailures
			},
			// Mention users for critical circuit breaker events
			mentionUsers: ['U06BPLC172N', 'U0403DP9FJ6']
		};

		await getAlertService().sendAlert(alert);

		logger.warn('Circuit breaker opened alert sent', { shop });
	}

	/**
	 * Send alert when circuit closes (recovers)
	 */
	private async sendCircuitClosedAlert(shop: string): Promise<void> {
		const metrics = circuitBreaker.getMetrics(shop);

		const alert: Alert = {
			type: AlertType.CIRCUIT_BREAKER,
			severity: AlertSeverity.INFO,
			title: '🟢 Circuit Breaker RECOVERED',
			message: this.formatCircuitClosedMessage(shop, metrics),
			timestamp: new Date(),
			context: {
				shop,
				state: CircuitState.CLOSED,
				totalSuccesses: metrics?.successCount,
				totalFailures: metrics?.failureCount
			}
		};

		await getAlertService().sendAlert(alert);

		logger.info('Circuit breaker recovered alert sent', { shop });
	}

	/**
	 * Format circuit opened alert message
	 */
	private formatCircuitOpenedMessage(
		shop: string,
		metrics: {
			consecutiveFailures: number;
			lastFailureTime: number;
			successCount: number;
			failureCount: number;
			halfOpenAttempts: number;
		} | null
	): string {
		const lines = [
			`*Shop:* ${shop}`,
			`*Status:* Circuit breaker is now OPEN - failing fast to prevent cascading failures`,
			``,
			`*Details:*`,
			`• Consecutive Failures: ${metrics?.consecutiveFailures ?? 'unknown'}`,
			`• Total Failures: ${metrics?.failureCount ?? 'unknown'}`,
			`• Last Failure: ${metrics?.lastFailureTime ? new Date(metrics.lastFailureTime).toISOString() : 'unknown'}`,
			``,
			`*What This Means:*`,
			`• All requests to this shop will fail fast for the next 60 seconds`,
			`• This prevents wasting resources on a failing shop`,
			`• The circuit will automatically attempt recovery after cooldown`,
			``,
			`*Action Required:*`,
			`• Check if the shop is experiencing issues`,
			`• Monitor for automatic recovery`,
			`• If issue persists, investigate shop configuration`
		];

		return lines.join('\n');
	}

	/**
	 * Format circuit closed alert message
	 */
	private formatCircuitClosedMessage(
		shop: string,
		metrics: {
			consecutiveFailures: number;
			lastFailureTime: number;
			successCount: number;
			failureCount: number;
			halfOpenAttempts: number;
		} | null
	): string {
		const lines = [
			`*Shop:* ${shop}`,
			`*Status:* Circuit breaker has RECOVERED - requests flowing normally`,
			``,
			`*Recovery Details:*`,
			`• Total Successes: ${metrics?.successCount ?? 'unknown'}`,
			`• Total Failures: ${metrics?.failureCount ?? 'unknown'}`,
			``,
			`✅ System has automatically recovered. No action needed.`
		];

		return lines.join('\n');
	}
}

/**
 * Global circuit breaker alerter instance
 */
let alerterInstance: CircuitBreakerAlerter | null = null;

/**
 * Initialize circuit breaker alerting
 */
export function initializeCircuitBreakerAlerting(): void {
	if (!alerterInstance) {
		alerterInstance = new CircuitBreakerAlerter();
		alerterInstance.start();
		logger.info('Circuit breaker alerting initialized');
	}
}
