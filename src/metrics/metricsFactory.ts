// SPDX-License-Identifier: Apache-2.0

import { Counter, Gauge, Histogram, type Registry } from 'prom-client';

import { type CounterDefinition, type GaugeDefinition, type HistogramDefinition } from './definitions';

interface GaugeOptions {
  collect?: (this: Gauge) => void | Promise<void>;
}

/**
 * Creates Prometheus metrics on a single Registry.
 */
export class MetricsFactory {
  /**
   * @param registry - The registry every metric produced by this factory is registered on.
   */
  constructor(private readonly registry: Registry) {}

  /**
   * Creates a counter from its definition.
   *
   * @param definition - The catalog entry describing the counter.
   * @returns The registered counter.
   */
  public counter(definition: CounterDefinition): Counter {
    this.registry.removeSingleMetric(definition.name);
    return new Counter({
      name: definition.name,
      help: definition.help,
      labelNames: [...(definition.labelNames ?? [])],
      registers: [this.registry],
    });
  }

  /**
   * Creates a gauge from its definition.
   *
   * @param definition - The catalog entry describing the gauge.
   * @param options - Optional `collect` callback invoked when the registry is scraped.
   * @returns The registered gauge.
   */
  public gauge(definition: GaugeDefinition, options: GaugeOptions = {}): Gauge {
    this.registry.removeSingleMetric(definition.name);
    return new Gauge({
      name: definition.name,
      help: definition.help,
      labelNames: [...(definition.labelNames ?? [])],
      registers: [this.registry],
      ...options,
    });
  }

  /**
   * Creates a histogram from its definition.
   *
   * @param definition - The catalog entry describing the histogram.
   * @returns The registered histogram.
   */
  public histogram(definition: HistogramDefinition): Histogram {
    this.registry.removeSingleMetric(definition.name);
    return new Histogram({
      name: definition.name,
      help: definition.help,
      labelNames: [...(definition.labelNames ?? [])],
      registers: [this.registry],
      ...(definition.buckets ? { buckets: [...definition.buckets] } : {}),
    });
  }
}
