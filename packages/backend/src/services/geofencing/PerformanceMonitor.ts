import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  success: boolean;
  metadata?: any;
}

interface OperationStats {
  count: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  successRate: number;
  recentMetrics: PerformanceMetric[];
}

interface SystemMetrics {
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  activeConnections: number;
  queueSize: number;
  uptime: number;
}

export class PerformanceMonitor extends EventEmitter {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private activeOperations: Map<string, number> = new Map();
  private alertThresholds: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private metricsRetentionMs = 5 * 60 * 1000; // 5 minutes
  private cpuUsageBaseline: NodeJS.CpuUsage;

  constructor() {
    super();
    this.cpuUsageBaseline = process.cpuUsage();

    // Set default alert thresholds (in milliseconds)
    this.setAlertThreshold('setLocation', 100);
    this.setAlertThreshold('getLocation', 50);
    this.setAlertThreshold('nearbySearch', 200);
    this.setAlertThreshold('geofenceCheck', 150);
    this.setAlertThreshold('bulkInsert', 500);

    // Cleanup old metrics every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMetrics();
    }, 60000);
  }

  /**
   * Start tracking an operation
   */
  startOperation(operationId: string, operationType: string): void {
    this.activeOperations.set(operationId, performance.now());
  }

  /**
   * End tracking an operation and record metrics
   */
  endOperation(
    operationId: string,
    operationType: string,
    success: boolean = true,
    metadata?: any
  ): PerformanceMetric {
    const startTime = this.activeOperations.get(operationId);

    if (!startTime) {
      throw new Error(`Operation ${operationId} was not started`);
    }

    const duration = performance.now() - startTime;
    this.activeOperations.delete(operationId);

    const metric: PerformanceMetric = {
      operation: operationType,
      duration,
      timestamp: Date.now(),
      success,
      metadata
    };

    this.recordMetric(metric);

    // Check for performance alerts
    this.checkAlerts(metric);

    return metric;
  }

  /**
   * Record a performance metric
   */
  private recordMetric(metric: PerformanceMetric): void {
    if (!this.metrics.has(metric.operation)) {
      this.metrics.set(metric.operation, []);
    }

    const operationMetrics = this.metrics.get(metric.operation)!;
    operationMetrics.push(metric);

    // Emit metric event
    this.emit('metric', metric);
  }

  /**
   * Check if metric exceeds alert thresholds
   */
  private checkAlerts(metric: PerformanceMetric): void {
    const threshold = this.alertThresholds.get(metric.operation);

    if (threshold && metric.duration > threshold) {
      this.emit('performanceAlert', {
        operation: metric.operation,
        duration: metric.duration,
        threshold,
        timestamp: metric.timestamp
      });
    }
  }

  /**
   * Set alert threshold for an operation type
   */
  setAlertThreshold(operationType: string, thresholdMs: number): void {
    this.alertThresholds.set(operationType, thresholdMs);
  }

  /**
   * Get statistics for a specific operation type
   */
  getOperationStats(operationType: string): OperationStats | null {
    const metrics = this.metrics.get(operationType);

    if (!metrics || metrics.length === 0) {
      return null;
    }

    const successfulMetrics = metrics.filter(m => m.success);
    const durations = metrics.map(m => m.duration);

    return {
      count: metrics.length,
      totalDuration: durations.reduce((sum, d) => sum + d, 0),
      averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      successRate: successfulMetrics.length / metrics.length,
      recentMetrics: metrics.slice(-10) // Last 10 metrics
    };
  }

  /**
   * Get all operation statistics
   */
  getAllStats(): Map<string, OperationStats> {
    const allStats = new Map<string, OperationStats>();

    for (const operationType of this.metrics.keys()) {
      const stats = this.getOperationStats(operationType);
      if (stats) {
        allStats.set(operationType, stats);
      }
    }

    return allStats;
  }

  /**
   * Get current system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const memoryUsage = process.memoryUsage();
    const currentCpuUsage = process.cpuUsage(this.cpuUsageBaseline);

    return {
      memoryUsage,
      cpuUsage: currentCpuUsage,
      activeConnections: this.activeOperations.size,
      queueSize: 0, // Will be updated by BulkLocationProcessor
      uptime: process.uptime()
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    operationStats: Map<string, OperationStats>;
    systemMetrics: SystemMetrics;
    alertThresholds: Map<string, number>;
    totalMetrics: number;
  } {
    const totalMetrics = Array.from(this.metrics.values())
      .reduce((sum, metrics) => sum + metrics.length, 0);

    return {
      operationStats: this.getAllStats(),
      systemMetrics: this.getSystemMetrics(),
      alertThresholds: new Map(this.alertThresholds),
      totalMetrics
    };
  }

  /**
   * Clean up old metrics to prevent memory leaks
   */
  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - this.metricsRetentionMs;

    for (const [operationType, metrics] of this.metrics) {
      const filteredMetrics = metrics.filter(m => m.timestamp > cutoffTime);
      this.metrics.set(operationType, filteredMetrics);
    }
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportMetrics(): {
    timestamp: number;
    metrics: Record<string, PerformanceMetric[]>;
    stats: Record<string, OperationStats>;
    system: SystemMetrics;
  } {
    const metricsObj: Record<string, PerformanceMetric[]> = {};
    const statsObj: Record<string, OperationStats> = {};

    for (const [key, value] of this.metrics) {
      metricsObj[key] = value;
    }

    for (const [key, value] of this.getAllStats()) {
      statsObj[key] = value;
    }

    return {
      timestamp: Date.now(),
      metrics: metricsObj,
      stats: statsObj,
      system: this.getSystemMetrics()
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.activeOperations.clear();
    this.cpuUsageBaseline = process.cpuUsage();
  }

  /**
   * Shutdown the performance monitor
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.reset();
    this.removeAllListeners();
  }
}