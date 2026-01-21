import * as dotenv from 'dotenv';
dotenv.config();

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { awsEc2Detector, awsEksDetector } from '@opentelemetry/resource-detector-aws';
import { containerDetector } from '@opentelemetry/resource-detector-container';
import { DnsInstrumentation } from '@opentelemetry/instrumentation-dns';
import {
    Resource,
    envDetector,
    hostDetector,
    osDetector,
    processDetector
} from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import opentelemetry, { context, type Span, trace, type Tracer } from '@opentelemetry/api';
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
export { SeverityNumber } from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import type { AnyValueMap, Logger } from '@opentelemetry/api-logs';

// Random utils. To be moved to a common seperate file
// Not using common utils to avoid adding extra dependencies in this file
const getAppEnvironment = () => {
    return process.env.PUBLIC_APP_ENVIRONMENT || 'release';
};

const getAppVersion = (): string => {
    return process.env.PUBLIC_APP_VERSION ?? '1.0.0';
};

const getAppName = (): string => {
    return process.env.PUBLIC_APP_NAME ?? 'abandonment';
};

const getBuildTimestamp = (): string => {
    return process.env.PUBLIC_BUILD_TIMESTAMP ?? '';
};

const collectorUrl = process.env.OTEL_COLLECTOR_ENDPOINT || 'https://crane.beta.breeze.in';;

const isTelemetryEnabled = (): boolean => {
    return process.env.ENABLE_TELEMETRY !== 'false';
};
// Random utils - End

if (isTelemetryEnabled()) {
    console.log(
        'Instrumentation.ts',
        getAppEnvironment(),
        getAppName(),
        getAppVersion(),
        getBuildTimestamp(),
        collectorUrl
    );
}

// Only enable DEBUG logging if telemetry is enabled AND environment is dev
if (isTelemetryEnabled() && getAppEnvironment() === 'dev') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
        url: collectorUrl + '/v1/metrics'
    })
});

const logExporter = new OTLPLogExporter({
    url: collectorUrl + '/v1/logs'
});

const loggerProvider = new LoggerProvider();

loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));

export const getLogger = (identifier: string): Logger => {
    return loggerProvider.getLogger(identifier, getAppVersion());
};

export const logData = (
    identifier: string,
    body: string,
    severityNumber: number,
    attributes: Record<string, unknown> // Replace 'any' with 'unknown'
) => {
    // try {
    //     console.log('logData updated', identifier, body, severityNumber, JSON.stringify(attributes));
    // } catch (error) {
    //     console.log('logData updated', identifier, body, severityNumber, attributes);
    // }
    try {
        getLogger(identifier).emit({
            body,
            severityNumber,
            attributes: attributes as AnyValueMap
        });
    } catch (error) {
        getLogger('instrumentation').emit({
            body: 'Error while logging data',
            severityNumber: SeverityNumber.ERROR,
            attributes: {
                error: String(error)
            }
        });
    }
};

const resource = Resource.default().merge(
    new Resource({
        [ATTR_SERVICE_NAME]: getAppName(),
        [ATTR_SERVICE_VERSION]: getAppVersion(),
        'service.build.timestamp': getBuildTimestamp()
    })
);

const meterProvider = new MeterProvider({
    resource: resource,
    readers: [metricReader]
});

const traceExporter = new OTLPTraceExporter({
    url: collectorUrl + '/v1/traces'
});

const sdk = new NodeSDK({
    resource: resource,
    traceExporter: traceExporter,
    instrumentations: [
        new DnsInstrumentation(),
        new RuntimeNodeInstrumentation({
            monitoringPrecision: 5000
        }),
        new HttpInstrumentation(),
        getNodeAutoInstrumentations({
            // only instrument fs if it is part of another trace
            '@opentelemetry/instrumentation-fs': {
                requireParentSpan: true
            }
        })
    ],
    resourceDetectors: [
        containerDetector,
        envDetector,
        hostDetector,
        osDetector,
        processDetector,
        awsEksDetector,
        awsEc2Detector
    ]
});
// Only start telemetry if enabled
if (isTelemetryEnabled()) {
    logs.setGlobalLoggerProvider(loggerProvider);
    opentelemetry.metrics.setGlobalMeterProvider(meterProvider);
    sdk.start();

    // Ensure the SDK is shut down gracefully
    process.on('SIGTERM', () => {
        sdk
            .shutdown()
            .then(() => console.log('OpenTelemetry SDK shut down'))
            .catch((error) => console.error('Error shutting down OpenTelemetry SDK', error))
            .finally(() => process.exit(0));
    });
} else {
    console.log('📊 OpenTelemetry disabled (ENABLE_TELEMETRY=false)');
}

export const getTracer = (identifier: string): Tracer => {
    return trace.getTracer(identifier);
};

export async function runWithActiveSpan<T>(span: Span, fn: () => Promise<T>): Promise<T> {
    return await context.with(trace.setSpan(context.active(), span), fn);
}
