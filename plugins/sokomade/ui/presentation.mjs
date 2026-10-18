// Project controls from current server state, never from AI-written labels or historical IDs.
export function presentation(workspace) {
  const places = workspace.places.filter(p => p.id !== workspace.originId);
  const selected = places.find(p => p.id === workspace.selectedPlaceId);
  const pairs = workspace.routePairs || [];
  const propertyPairs = pairs.filter(pair => workspace.places.find(p => p.id === pair.comparisonId)?.role === 'property');
  const propertyMode = !!selected && (selected.role === 'property' || propertyPairs.some(p => p.comparisonId === selected.id));
  const ids = propertyMode && propertyPairs.length ? propertyPairs.map(p => p.comparisonId) : workspace.searchResultIds?.includes(selected?.id) ? workspace.searchResultIds : places.map(p => p.id);
  const candidates = places.filter(p => ids.includes(p.id));
  const routes = workspace.routes.filter(r => r.destinationId === selected?.id && r.leg === workspace.leg && r.extraSeconds <= workspace.conditions.maxDetourMinutes * 60);
  const route = routes.find(r => r.id === workspace.selectedRoutes[`${selected?.id}:${workspace.leg}`]) || routes[0];
  const from = workspace.places.find(p => p.id === route?.fromId);
  const to = workspace.places.find(p => p.id === route?.toId);
  const evaluation = workspace.walkEvaluations?.find(p => p.comparisonId === selected?.id);
  return { selected, candidates, routes, route, from, to, propertyMode, evaluation,
    limitFailed: workspace.conditions.maxRoundTripMinutes !== null && evaluation?.status !== 'within' };
}
export const candidateLetter = (workspace, id) => {
  const properties = workspace.places.filter(p => p.role === 'property');
  const index = properties.findIndex(p => p.id === id);
  return index < 0 ? null : String.fromCharCode(65 + index);
};
