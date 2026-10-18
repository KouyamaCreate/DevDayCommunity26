export const defaultConditions = () => ({ maxDetourMinutes: 5, maxRoundTripMinutes: null, categories: ['assault','robbery','theft'], radiusMeters: 500 });

export function evaluateWalks(state) {
  return state.routePairs.map(pair => {
    const chosen = leg => state.routes.find(r => r.id === state.selectedRoutes[`${pair.comparisonId}:${leg}`] && r.pairId === pair.id && r.leg === leg);
    const out = chosen('out'), back = chosen('back');
    const totalSeconds = out && back ? out.durationSeconds + back.durationSeconds : null;
    const limitSeconds = state.conditions.maxRoundTripMinutes === null ? null : state.conditions.maxRoundTripMinutes * 60;
    const detourOK = out && back && [out,back].every(r => r.extraSeconds <= state.conditions.maxDetourMinutes * 60);
    const status = totalSeconds === null ? 'unknown' : !detourOK || (limitSeconds !== null && totalSeconds > limitSeconds) ? 'exceeds' : 'within';
    return { pairId: pair.id, comparisonId: pair.comparisonId, fromId: pair.fromId, toId: pair.toId, outRouteId: out?.id || null, backRouteId: back?.id || null,
      totalSeconds, totalMinutes: totalSeconds === null ? null : Math.ceil(totalSeconds / 60), limitSeconds, status };
  });
}
