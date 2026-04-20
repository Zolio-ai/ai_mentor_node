export function buildAttendanceInsights(record) {
  const samples = Array.isArray(record?.samples) ? [...record.samples] : [];
  samples.sort((a, b) => new Date(a?.at || 0).getTime() - new Date(b?.at || 0).getTime());
  const nowMs = Date.now();
  const maxTailMs = 10_000;

  let totalPresentMs = 0;
  let totalAwayMs = 0;
  let firstSampleMs = null;
  let lastSampleMs = null;
  let firstSampleAt = null;
  let lastSeenAt = null;
  let lastOutAt = null;
  let outSince = null;

  const classifySample = (sample) => {
    if (Boolean(sample?.personDetected) || sample?.status === "present") return "present";
    if (sample?.status === "away") return "away";
    return "neutral";
  };

  for (let i = 0; i < samples.length; i += 1) {
    const current = samples[i];
    const currentMs = new Date(current?.at || 0).getTime();
    if (!Number.isFinite(currentMs)) continue;
    if (firstSampleMs === null) firstSampleMs = currentMs;
    lastSampleMs = currentMs;
    if (firstSampleAt === null) firstSampleAt = new Date(currentMs).toISOString();

    const next = samples[i + 1];
    const nextMsRaw = next ? new Date(next?.at || 0).getTime() : nowMs;
    const nextMs = Number.isFinite(nextMsRaw) ? nextMsRaw : currentMs;
    const rawDelta = Math.max(0, nextMs - currentMs);
    const deltaMs = next ? rawDelta : Math.min(rawDelta, maxTailMs);

    const classification = classifySample(current);
    if (classification === "present") {
      totalPresentMs += deltaMs;
      lastSeenAt = new Date(currentMs).toISOString();
    } else if (classification === "away") {
      totalAwayMs += deltaMs;
      lastOutAt = new Date(currentMs).toISOString();
    }
  }

  // If session had only neutral states (e.g. "checking"), avoid showing all 0s.
  if (totalPresentMs === 0 && totalAwayMs === 0 && firstSampleMs !== null && lastSampleMs !== null) {
    const observedMs = Math.max(0, lastSampleMs - firstSampleMs);
    if (observedMs > 0) {
      totalAwayMs = observedMs;
      lastOutAt = new Date(lastSampleMs).toISOString();
    }
  }

  const currentlyDetected = Boolean(record?.personDetected) || record?.status === "present";
  if (!currentlyDetected && samples.length > 0) {
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      if (classifySample(samples[i]) === "away") {
        const ts = new Date(samples[i]?.at || 0).getTime();
        if (Number.isFinite(ts)) {
          outSince = new Date(ts).toISOString();
        }
        break;
      }
    }
  }

  return {
    sampleCount: samples.length,
    firstSampleAt,
    currentlyDetected,
    lastSeenAt,
    lastOutAt,
    outSince,
    totalPresentMs,
    totalAwayMs,
    totalTrainingMs: totalPresentMs + totalAwayMs,
    presentMinutes: Number((totalPresentMs / 60000).toFixed(1)),
    awayMinutes: Number((totalAwayMs / 60000).toFixed(1)),
    totalTrainingMinutes: Number(((totalPresentMs + totalAwayMs) / 60000).toFixed(1)),
  };
}
