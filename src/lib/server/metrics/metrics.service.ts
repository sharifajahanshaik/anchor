/**
 * Metrics Service
 *
 * Provides a unified interface for collecting application metrics using OpenTelemetry.
 * Supports counters, gauges, and histograms with automatic label handling.
 *
 * @module metrics/metrics.service
 */

import { metrics, type Meter } from '@opentelemetry/api';
import {
	type Counter as OtelCounter,
	type Histogram as OtelHistogram,
	type ObservableGauge as OtelObservableGauge,
	type UpDownCounter as OtelUpDownCounter
} from '@opentelemetry/api';
import { getConfig } from '../config';
import { getLogger } from '../logger';
import type {
	Counter,
	CounterConfig,
	Gauge,
	GaugeConfig,
	Histogram,
	HistogramConfig,
	MetricLabels,
	MetricsService
} from './metrics.types';

// Logger for metrics service
const logger = getLogger('metrics');

// Configuration
const config = getConfig();
const METER_NAME = config.telemetry.appName;
const METER_VERSION = config.telemetry.appVersion;

/**
 * Get OpenTelemetry meter instance
 */
function getMeter(): Meter {
	return metrics.getMeter(METER_NAME, METER_VERSION);
}

/**
 * Counter implementation using OpenTelemetry
 */
class CounterImpl implements Counter {
	private otelCounter: OtelCounter;

	constructor(config: CounterConfig) {
		const meter = getMeter();
		this.otelCounter = meter.createCounter(config.name, {
			description: config.description,
			unit: config.unit
		});

		logger.debug('Counter created', {
			name: config.name,
			description: config.description,
			unit: config.unit
		});
	}

	inc(labels?: MetricLabels): void {
		this.add(1, labels);
	}

	add(value: number, labels?: MetricLabels): void {
		if (value < 0) {
			logger.warn('Counter value must be non-negative', { value });
			return;
		}

		this.otelCounter.add(value, labels || {});
	}
}

/**
 * Gauge implementation using OpenTelemetry UpDownCounter
 *
 * Note: OpenTelemetry doesn't have a native Gauge that can be directly set.
 * We use UpDownCounter which can increment/decrement, and maintain internal state
 * for the 'set' operation.
 */
class GaugeImpl implements Gauge {
	private upDownCounter: OtelUpDownCounter;
	private currentValues: Map<string, number> = new Map();

	constructor(config: GaugeConfig) {
		const meter = getMeter();
		this.upDownCounter = meter.createUpDownCounter(config.name, {
			description: config.description,
			unit: config.unit
		});

		logger.debug('Gauge created', {
			name: config.name,
			description: config.description,
			unit: config.unit
		});
	}

	set(value: number, labels?: MetricLabels): void {
		const key = this.getLabelsKey(labels);
		const currentValue = this.currentValues.get(key) || 0;
		const delta = value - currentValue;

		this.upDownCounter.add(delta, labels || {});
		this.currentValues.set(key, value);
	}

	inc(labels?: MetricLabels): void {
		this.add(1, labels);
	}

	dec(labels?: MetricLabels): void {
		this.add(-1, labels);
	}

	add(value: number, labels?: MetricLabels): void {
		const key = this.getLabelsKey(labels);
		const currentValue = this.currentValues.get(key) || 0;
		const newValue = currentValue + value;

		this.upDownCounter.add(value, labels || {});
		this.currentValues.set(key, newValue);
	}

	/**
	 * Generate a unique key for label combination
	 */
	private getLabelsKey(labels?: MetricLabels): string {
		if (!labels) return '__default__';
		return JSON.stringify(Object.entries(labels).sort());
	}
}

/**
 * Histogram implementation using OpenTelemetry
 */
class HistogramImpl implements Histogram {
	private otelHistogram: OtelHistogram;

	constructor(config: HistogramConfig) {
		const meter = getMeter();

		// Default boundaries for latency measurements (in seconds)
		const defaultBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

		this.otelHistogram = meter.createHistogram(config.name, {
			description: config.description,
			unit: config.unit,
			advice: {
				explicitBucketBoundaries: config.boundaries || defaultBoundaries
			}
		});

		logger.debug('Histogram created', {
			name: config.name,
			description: config.description,
			unit: config.unit,
			boundaries: config.boundaries || defaultBoundaries
		});
	}

	record(value: number, labels?: MetricLabels): void {
		this.otelHistogram.record(value, labels || {});
	}
}

/**
 * Metrics service implementation
 */
class MetricsServiceImpl implements MetricsService {
	private counters: Map<string, Counter> = new Map();
	private gauges: Map<string, Gauge> = new Map();
	private histograms: Map<string, Histogram> = new Map();
	private enabled: boolean;

	constructor() {
		this.enabled = config.telemetry.enabled;

		if (this.enabled) {
			logger.info('Metrics service initialized', {
				meterName: METER_NAME,
				meterVersion: METER_VERSION
			});
		} else {
			logger.info('Metrics service disabled', {
				reason: 'ENABLE_TELEMETRY=false'
			});
		}
	}

	counter(config: CounterConfig): Counter {
		if (!this.enabled) {
			return this.createNoOpCounter();
		}

		const existing = this.counters.get(config.name);
		if (existing) {
			return existing;
		}

		const counter = new CounterImpl(config);
		this.counters.set(config.name, counter);
		return counter;
	}

	gauge(config: GaugeConfig): Gauge {
		if (!this.enabled) {
			return this.createNoOpGauge();
		}

		const existing = this.gauges.get(config.name);
		if (existing) {
			return existing;
		}

		const gauge = new GaugeImpl(config);
		this.gauges.set(config.name, gauge);
		return gauge;
	}

	histogram(config: HistogramConfig): Histogram {
		if (!this.enabled) {
			return this.createNoOpHistogram();
		}

		const existing = this.histograms.get(config.name);
		if (existing) {
			return existing;
		}

		const histogram = new HistogramImpl(config);
		this.histograms.set(config.name, histogram);
		return histogram;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Create a no-op counter (when telemetry is disabled)
	 */
	private createNoOpCounter(): Counter {
		return {
			inc: () => {},
			add: () => {}
		};
	}

	/**
	 * Create a no-op gauge (when telemetry is disabled)
	 */
	private createNoOpGauge(): Gauge {
		return {
			set: () => {},
			inc: () => {},
			dec: () => {},
			add: () => {}
		};
	}

	/**
	 * Create a no-op histogram (when telemetry is disabled)
	 */
	private createNoOpHistogram(): Histogram {
		return {
			record: () => {}
		};
	}
}

// Singleton instance
let metricsServiceInstance: MetricsService | null = null;

/**
 * Get the metrics service singleton instance
 *
 * @returns MetricsService instance
 *
 * @example
 * ```typescript
 * import { getMetricsService, MetricNames, LabelNames } from '$lib/server/metrics';
 *
 * const metrics = getMetricsService();
 *
 * // Create a counter
 * const requestCounter = metrics.counter({
 *   name: MetricNames.API_REQUESTS,
 *   description: 'Total API requests',
 *   unit: 'requests'
 * });
 *
 * // Increment counter with labels
 * requestCounter.inc({
 *   [LabelNames.ENDPOINT]: '/api/abandon',
 *   [LabelNames.STATUS_CODE]: '200'
 * });
 * ```
 */
export function getMetricsService(): MetricsService {
	if (!metricsServiceInstance) {
		metricsServiceInstance = new MetricsServiceImpl();
	}
	return metricsServiceInstance;
}

/**
 * Reset the metrics service instance (for testing)
 * @internal
 */
export function resetMetricsService(): void {
	metricsServiceInstance = null;
}
