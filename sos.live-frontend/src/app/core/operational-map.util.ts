import {
  DashboardAgent,
  DashboardAlert,
  DashboardCompanyProfile,
  DashboardMapLocation,
} from './dashboard-data.service';

type MapLocationResolverOptions = {
  allowApproximate?: boolean;
};

type MapLocationRecord = Record<string, unknown>;

const APPROXIMATE_LOCATION_SOURCES: DashboardMapLocation['source'][] = [
  'heuristic',
  'unresolved',
];

const BOGOTA_BOUNDS = {
  north: 4.8366,
  south: 4.472,
  west: -74.3076,
  east: -73.9865,
};

const PIN_OFFSETS = [
  { top: 0, left: 0 },
  { top: -1.4, left: 1.1 },
  { top: 1.2, left: -1.2 },
  { top: 0.8, left: 1.5 },
  { top: -1, left: -1.5 },
];

const BOGOTA_FALLBACKS = [
  { keywords: ['usaquen', 'usaquén'], lat: 4.7086, lng: -74.03, label: 'Usaquén, Bogotá, Colombia' },
  { keywords: ['suba'], lat: 4.7437, lng: -74.0854, label: 'Suba, Bogotá, Colombia' },
  { keywords: ['chapinero'], lat: 4.6486, lng: -74.0628, label: 'Chapinero, Bogotá, Colombia' },
  { keywords: ['barrios unidos'], lat: 4.669, lng: -74.0752, label: 'Barrios Unidos, Bogotá, Colombia' },
  { keywords: ['teusaquillo'], lat: 4.6453, lng: -74.0839, label: 'Teusaquillo, Bogotá, Colombia' },
  { keywords: ['engativa', 'engativá'], lat: 4.69, lng: -74.1076, label: 'Engativá, Bogotá, Colombia' },
  { keywords: ['fontibon', 'fontibón'], lat: 4.6781, lng: -74.1425, label: 'Fontibón, Bogotá, Colombia' },
  { keywords: ['puente aranda'], lat: 4.6227, lng: -74.1166, label: 'Puente Aranda, Bogotá, Colombia' },
  { keywords: ['martires', 'mártires', 'los martires', 'los mártires'], lat: 4.6033, lng: -74.0908, label: 'Los Mártires, Bogotá, Colombia' },
  { keywords: ['candelaria', 'la candelaria'], lat: 4.5964, lng: -74.0721, label: 'La Candelaria, Bogotá, Colombia' },
  { keywords: ['santa fe', 'santa fé'], lat: 4.6092, lng: -74.0743, label: 'Santa Fe, Bogotá, Colombia' },
  { keywords: ['antonio nariño'], lat: 4.5932, lng: -74.1011, label: 'Antonio Nariño, Bogotá, Colombia' },
  { keywords: ['rafael uribe', 'rafael uribe uribe'], lat: 4.5664, lng: -74.1087, label: 'Rafael Uribe Uribe, Bogotá, Colombia' },
  { keywords: ['san cristobal', 'san cristóbal'], lat: 4.5468, lng: -74.0841, label: 'San Cristóbal, Bogotá, Colombia' },
  { keywords: ['kennedy'], lat: 4.6276, lng: -74.1536, label: 'Kennedy, Bogotá, Colombia' },
  { keywords: ['bosa'], lat: 4.6162, lng: -74.1854, label: 'Bosa, Bogotá, Colombia' },
  { keywords: ['tunjuelito'], lat: 4.5762, lng: -74.129, label: 'Tunjuelito, Bogotá, Colombia' },
  { keywords: ['ciudad bolivar', 'ciudad bolívar'], lat: 4.5075, lng: -74.1501, label: 'Ciudad Bolívar, Bogotá, Colombia' },
  { keywords: ['usme'], lat: 4.4772, lng: -74.1168, label: 'Usme, Bogotá, Colombia' },
  { keywords: ['sumapaz'], lat: 4.2338, lng: -74.3494, label: 'Sumapaz, Bogotá, Colombia' },
  { keywords: ['soacha'], lat: 4.5794, lng: -74.2168, label: 'Soacha, Cundinamarca, Colombia' },
  { keywords: ['norte'], lat: 4.7496, lng: -74.0339, label: 'Norte de Bogotá, Colombia' },
  { keywords: ['sur'], lat: 4.5416, lng: -74.1258, label: 'Sur de Bogotá, Colombia' },
  { keywords: ['occidente', 'oeste'], lat: 4.6874, lng: -74.1547, label: 'Occidente de Bogotá, Colombia' },
  { keywords: ['oriente', 'este'], lat: 4.6144, lng: -74.0316, label: 'Oriente de Bogotá, Colombia' },
  { keywords: ['centro'], lat: 4.6097, lng: -74.0817, label: 'Centro de Bogotá, Colombia' },
];

export const OPERATIONAL_MAP_EMBED_URL =
  'https://www.openstreetmap.org/export/embed.html?bbox=-74.3076%2C4.4720%2C-73.9865%2C4.8366&layer=mapnik';

const normalizeText = (value = '') =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const isRecord = (value: unknown): value is MapLocationRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toFiniteNumber = (value: unknown) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const toLocationText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const isApproximateLocation = (location: DashboardMapLocation | null | undefined) => {
  if (!location) {
    return true;
  }

  const precision = toLocationText(location?.precision).toLowerCase();

  if (precision) {
    return precision !== 'exact';
  }

  if (location.source === 'device') {
    return false;
  }

  return true;
};

const buildResolvedMapLocation = (
  candidate: MapLocationRecord,
  fallbackText = ''
): DashboardMapLocation | null => {
  const lat = toFiniteNumber(candidate['lat'] ?? candidate['latitude']);
  const lng = toFiniteNumber(
    candidate['lng'] ?? candidate['longitude'] ?? candidate['lon'] ?? candidate['long']
  );

  if (lat === null || lng === null) {
    return null;
  }

  const label =
    toLocationText(candidate['label']) ||
    toLocationText(candidate['display_name']) ||
    fallbackText ||
    `Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)}`;
  const query =
    toLocationText(candidate['query']) ||
    toLocationText(candidate['address']) ||
    label ||
    `${lat},${lng}`;
  const source = toLocationText(candidate['source']) as DashboardMapLocation['source'] | '';
  const resolvedSource = (source || 'device') as DashboardMapLocation['source'];
  const precisionText = toLocationText(candidate['precision']).toLowerCase();
  const score = toFiniteNumber(candidate['score']);
  const matchType =
    toLocationText(candidate['matchType']) ||
    toLocationText(candidate['addrType']) ||
    toLocationText(candidate['Addr_type']) ||
    undefined;

  return {
    lat,
    lng,
    label,
    query,
    source: resolvedSource,
    precision:
      precisionText === 'exact' || precisionText === 'approximate'
        ? (precisionText as DashboardMapLocation['precision'])
        : resolvedSource === 'device'
          ? 'exact'
          : 'approximate',
    score: score ?? undefined,
    matchType,
  };
};

const resolveCoordinatesFromCandidates = (
  candidates: unknown[],
  fallbackText = ''
): DashboardMapLocation | null => {
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const resolvedLocation = buildResolvedMapLocation(candidate, fallbackText);

    if (resolvedLocation) {
      return resolvedLocation;
    }
  }

  return null;
};

const resolveFallbackMapLocation = (value: string): DashboardMapLocation | null => {
  const normalizedValue = normalizeText(value);

  const match = BOGOTA_FALLBACKS.find((entry) =>
    entry.keywords.some((keyword) => normalizedValue.includes(normalizeText(keyword)))
  );

  if (!match) {
    return null;
  }

  return {
    lat: match.lat,
    lng: match.lng,
    label: match.label,
    query: value,
    source: 'heuristic',
  };
};

export const resolveAlertMapLocation = (
  alert?: DashboardAlert | null,
  options: MapLocationResolverOptions = {}
) => {
  const fallbackText = alert?.ubicacion || '';
  const exactLocation = resolveCoordinatesFromCandidates(
    [
      alert,
      (alert as unknown as MapLocationRecord | null | undefined)?.['location'],
      (alert as unknown as MapLocationRecord | null | undefined)?.['ubicacion'],
      (alert as unknown as MapLocationRecord | null | undefined)?.['coords'],
      (alert as unknown as MapLocationRecord | null | undefined)?.['coordinates'],
      alert?.mapa,
    ],
    fallbackText
  );

  if (exactLocation) {
    if (!options.allowApproximate && isApproximateLocation(exactLocation)) {
      return null;
    }

    return exactLocation;
  }

  return options.allowApproximate && alert?.ubicacion
    ? resolveFallbackMapLocation(alert.ubicacion)
    : null;
};

export const resolveAgentMapLocation = (
  agent?: DashboardAgent | null,
  options: MapLocationResolverOptions = {}
) => {
  const fallbackText =
    agent?.ubicacionExacta || agent?.ultimaUbicacionTexto || agent?.zona || '';
  const directLocation = resolveCoordinatesFromCandidates(
    [
      agent,
      (agent as unknown as MapLocationRecord | null | undefined)?.['location'],
      (agent as unknown as MapLocationRecord | null | undefined)?.['ubicacion'],
      (agent as unknown as MapLocationRecord | null | undefined)?.['coords'],
      (agent as unknown as MapLocationRecord | null | undefined)?.['coordinates'],
    ],
    fallbackText
  );

  if (directLocation) {
    if (!options.allowApproximate && isApproximateLocation(directLocation)) {
      return null;
    }

    return directLocation;
  }

  const storedMapLocation = resolveCoordinatesFromCandidates([agent?.mapa], fallbackText);
  const hasExactAddress = !!agent?.ubicacionExacta?.trim();

  if (
    storedMapLocation &&
    !isApproximateLocation(storedMapLocation) &&
    (storedMapLocation.source === 'device' || hasExactAddress || options.allowApproximate)
  ) {
    return storedMapLocation;
  }

  return options.allowApproximate && agent?.zona ? resolveFallbackMapLocation(agent.zona) : null;
};

export const resolveCompanyMapLocation = (
  company: DashboardCompanyProfile,
  options: MapLocationResolverOptions = {}
) => {
  const fallbackText = company.direccion || '';
  const exactLocation = resolveCoordinatesFromCandidates(
    [
      company,
      (company as unknown as MapLocationRecord | null | undefined)?.['location'],
      (company as unknown as MapLocationRecord | null | undefined)?.['ubicacion'],
      (company as unknown as MapLocationRecord | null | undefined)?.['coords'],
      (company as unknown as MapLocationRecord | null | undefined)?.['coordinates'],
      (company as unknown as MapLocationRecord | null | undefined)?.['mapa'],
    ],
    fallbackText
  );

  if (exactLocation) {
    if (!options.allowApproximate && isApproximateLocation(exactLocation)) {
      return null;
    }

    return exactLocation;
  }

  return options.allowApproximate && company.direccion
    ? resolveFallbackMapLocation(company.direccion)
    : null;
};

export const getMapQueryLabel = (
  location: DashboardMapLocation | null | undefined,
  fallback: string
) => location?.label || location?.query || fallback;

export const projectMapLocation = (
  location: DashboardMapLocation | null | undefined,
  offsetIndex = 0
) => {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    return null;
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const offset = PIN_OFFSETS[offsetIndex % PIN_OFFSETS.length];

  const verticalRatio =
    (BOGOTA_BOUNDS.north - lat) / (BOGOTA_BOUNDS.north - BOGOTA_BOUNDS.south);
  const horizontalRatio =
    (lng - BOGOTA_BOUNDS.west) / (BOGOTA_BOUNDS.east - BOGOTA_BOUNDS.west);

  const top = clamp(verticalRatio * 100 + offset.top, 8, 92);
  const left = clamp(horizontalRatio * 100 + offset.left, 8, 92);

  return {
    top: `${top}%`,
    left: `${left}%`,
  };
};
