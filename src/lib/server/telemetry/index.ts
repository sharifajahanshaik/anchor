/**
 * Telemetry Module
 *
 * OpenTelemetry infrastructure setup and utilities.
 * Provides tracing, metrics, and log export capabilities.
 */

export {
	getLogger,
	logData,
	getTracer,
	runWithActiveSpan,
	SeverityNumber
} from './telemetry.service';
