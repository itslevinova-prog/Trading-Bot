/** Sampling evidence, never a continuous-service or profitability proof. Clocks are injectable for tests. */
export class SamplingEvidence {
  constructor({startWall, startMonotonic, durationMs, intervalMs}) {
    if (![startWall, startMonotonic, durationMs, intervalMs].every(Number.isFinite) || startWall < 0 || startMonotonic < 0 || durationMs <= 0 || intervalMs <= 0) throw Error('Invalid sampling clocks/duration');
    Object.assign(this, {startWall, startMonotonic, durationMs, intervalMs});
    this.graceMs = Math.min(15000, intervalMs / 4);
    this.clockToleranceMs = 5000;
    this.samples = this.failures = this.disconnectedSamples = this.staleBookSamples = this.unvaluedAccountSamples = this.unreadyFeatureSamples = this.unverifiedIdentitySamples = this.unexpectedProfileSamples = 0;
    this.identityChanges = this.identityDriftSamples = this.clockAnomalies = this.cadenceViolations = this.estimatedMissedSamples = 0;
    this.maximumSampleGapMs = this.supportedSampleIntervalMs = 0;
    this.firstIdentity = this.lastIdentity = null;
    this.firstSample = this.lastSample = null;
    this.identityEvents = [];
  }

  gap(now, previous) {
    const wall = now.wall - previous.wall, monotonic = now.monotonic - previous.monotonic;
    return {ms: Math.max(0, wall, monotonic), clockAnomaly: wall < 0 || monotonic < 0 || Math.abs(wall - monotonic) > this.clockToleranceMs};
  }

  observe({wall, monotonic, sample}) {
    if (![wall, monotonic].every(Number.isFinite)) throw Error('Invalid observation clocks');
    const previous = this.lastSample ?? {wall: this.startWall, monotonic: this.startMonotonic};
    const gap = this.gap({wall, monotonic}, previous);
    this.maximumSampleGapMs = Math.max(this.maximumSampleGapMs, gap.ms);
    if (gap.clockAnomaly) this.clockAnomalies++;
    if (gap.ms > this.intervalMs + this.graceMs) {
      this.cadenceViolations++;
      this.estimatedMissedSamples += Math.max(0, Math.floor(gap.ms / this.intervalMs) - 1);
    }
    this.samples++;
    let qualified = false, identitySignature = null;
    if (sample.error) this.failures++;
    else {
      const {health, accounts, identity, freeProfile} = sample;
      if (!health.connected) this.disconnectedSamples++;
      if (health.staleBooks > 0) this.staleBookSamples++;
      const unvalued = accounts.some(a => a.equity === null || !a.valuationComplete);
      if (unvalued) this.unvaluedAccountSamples++;
      const unready = health.pairs <= 0 || health.readyFeatures < health.pairs;
      if (unready) this.unreadyFeatureSamples++;
      if (!freeProfile) this.unexpectedProfileSamples++;
      if (!identity) this.unverifiedIdentitySamples++;
      else {
        if (!this.firstIdentity) this.firstIdentity = identity;
        const signature = value => JSON.stringify(value);
        if (this.lastIdentity && signature(identity) !== signature(this.lastIdentity)) {
          this.identityChanges++;
          if (this.identityEvents.length < 50) this.identityEvents.push({at: wall, from: this.lastIdentity, to: identity});
        }
        if (signature(identity) !== signature(this.firstIdentity)) this.identityDriftSamples++;
        this.lastIdentity = identity; identitySignature = JSON.stringify(identity);
      }
      qualified = health.connected && !unvalued && !unready && freeProfile && identity !== null;
    }
    if (this.lastSample?.qualified && qualified && this.lastSample.identitySignature === identitySignature && !gap.clockAnomaly && gap.ms <= this.intervalMs + this.graceMs) this.supportedSampleIntervalMs += Math.max(0, monotonic - this.lastSample.monotonic);
    const point = {wall, monotonic, qualified, identitySignature};
    this.firstSample ??= point;
    this.lastSample = point;
  }

  summary({wall, monotonic, ended = false, stopped = false}) {
    const elapsedMs = Math.max(0, monotonic - this.startMonotonic), expectedSamples = Math.ceil(this.durationMs / this.intervalMs);
    const tail = this.gap({wall, monotonic}, this.lastSample ?? {wall: this.startWall, monotonic: this.startMonotonic});
    const trailingCadenceViolation = tail.ms > this.intervalMs + this.graceMs;
    const deadlineReached = elapsedMs >= this.durationMs;
    const passed = ended && !stopped && deadlineReached && this.samples >= expectedSamples && this.failures === 0 && this.disconnectedSamples === 0 && this.unvaluedAccountSamples === 0 && this.unreadyFeatureSamples === 0 && this.unverifiedIdentitySamples === 0 && this.unexpectedProfileSamples === 0 && this.identityChanges === 0 && this.identityDriftSamples === 0 && this.clockAnomalies === 0 && !tail.clockAnomaly && this.cadenceViolations === 0 && !trailingCadenceViolation;
    const hasObservedIssues = this.failures > 0 || this.disconnectedSamples > 0 || this.unvaluedAccountSamples > 0 || this.unreadyFeatureSamples > 0 || this.unverifiedIdentitySamples > 0 || this.unexpectedProfileSamples > 0 || this.identityChanges > 0 || this.identityDriftSamples > 0 || this.clockAnomalies > 0 || tail.clockAnomaly || this.cadenceViolations > 0 || trailingCadenceViolation;
    return {
      resultStatus: !ended ? (hasObservedIssues ? 'in_progress_with_issues' : 'in_progress') : stopped ? 'stopped' : passed ? 'sampled_run_passed' : 'completed_with_issues', hasObservedIssues,
      startedAt: new Date(this.startWall).toISOString(), expectedEndAt: new Date(this.startWall + this.durationMs).toISOString(), updatedAt: new Date(wall).toISOString(),
      intervalMs: this.intervalMs, clockToleranceMs: this.clockToleranceMs, cadenceGraceMs: this.graceMs, expectedSamples, samples: this.samples, failures: this.failures,
      disconnectedSamples: this.disconnectedSamples, staleBookSamples: this.staleBookSamples, unvaluedAccountSamples: this.unvaluedAccountSamples, unreadyFeatureSamples: this.unreadyFeatureSamples,
      unverifiedIdentitySamples: this.unverifiedIdentitySamples, unexpectedProfileSamples: this.unexpectedProfileSamples,
      firstIdentity: this.firstIdentity, lastIdentity: this.lastIdentity, identityChanges: this.identityChanges, identityDriftSamples: this.identityDriftSamples, identityEvents: this.identityEvents,
      firstSampleAt: this.firstSample?.wall ?? null, lastSampleAt: this.lastSample?.wall ?? null,
      maximumSampleGapMs: Math.max(this.maximumSampleGapMs, tail.ms), cadenceViolations: this.cadenceViolations + (trailingCadenceViolation ? 1 : 0),
      estimatedMissedSamples: this.estimatedMissedSamples + (trailingCadenceViolation ? Math.max(0, Math.floor(tail.ms / this.intervalMs) - 1) : 0),
      clockAnomalies: this.clockAnomalies + (tail.clockAnomaly ? 1 : 0), trailingUnobservedMs: tail.ms,
      supportedSampleIntervalMs: this.supportedSampleIntervalMs, registeredWindowSampleCoveragePct: elapsedMs > 0 && this.clockAnomalies === 0 && !tail.clockAnomaly ? this.supportedSampleIntervalMs / elapsedMs * 100 : null,
      elapsedMs, wallElapsedMs: wall - this.startWall, durationClock: 'monotonic; expectedEndAt is an informational wall-clock estimate', deadlineReached,
      ...(ended ? {completed: !stopped && deadlineReached, stopped, sampledRunPassed: passed} : {sampledRunPassed: false}),
      monitorOnly: true, activeDevelopmentTimeMs: 0, profitabilityEstablished: false,
      interpretation: 'Deadline completion alone is not a passing run. Samples do not prove continuous availability between probes, fresh books for every market, successful executions or profitability. Runtime identity is sampled from the local provenance API; file integrity is checked separately.'
    };
  }
}

export function validateProbe(health, accounts, provenance, before = provenance) {
  if (!health || health.paperOnly !== true || typeof health.connected !== 'boolean' || !Number.isSafeInteger(health.pairs) || health.pairs < 0 || !Number.isSafeInteger(health.readyFeatures) || health.readyFeatures < 0 || health.readyFeatures > health.pairs || !Number.isSafeInteger(health.staleBooks) || health.staleBooks < 0 || health.staleBooks > health.pairs || !Array.isArray(accounts) || !accounts.length) throw Error('Invalid paper endpoints');
  if (before?.runId !== provenance?.runId || before?.build?.buildId !== provenance?.build?.buildId || before?.execution?.evaluationVersion !== provenance?.execution?.evaluationVersion) throw Error('RUNTIME_CHANGED_DURING_PROBE');
  const marked = accounts.map(a => {
    if (!a || typeof a.id !== 'string' || !Number.isFinite(a.cash) || a.cash < 0 || a.equity !== null && (!Number.isFinite(a.equity) || a.equity < 0) || typeof a.valuation?.complete !== 'boolean') throw Error('Invalid paper account');
    if (a.valuation.complete !== (a.equity !== null)) throw Error('Contradictory valuation');
    return {id: a.id, equity: a.equity, cash: a.cash, status: a.status, fees: a.fees, positionCount: a.positionCount, valuationComplete: a.valuation.complete};
  });
  if (new Set(marked.map(a => a.id)).size !== marked.length) throw Error('Invalid duplicate paper account');
  const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  const identity = provenance?.verified === true && provenance.execution?.buildVerified === true && typeof provenance.runId === 'string' && /^[0-9a-f-]{36}$/.test(provenance.runId) && hex(provenance.build?.buildId) && hex(provenance.execution?.evaluationVersion) ? {runId: provenance.runId, buildId: provenance.build.buildId, evaluationVersion: provenance.execution.evaluationVersion} : null;
  const config = provenance?.tradingConfig;
  const freeProfile = config?.AI_ENABLED === false && config?.AI_ALLOW_REMOTE === false && config?.AI_PROVIDER === 'none';
  return {health, accounts: marked, identity, freeProfile};
}
