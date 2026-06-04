const BOGOTA_FALLBACKS = [
  { keywords: ['usaquen', 'usaquen'], lat: 4.7086, lng: -74.03, label: 'Usaquen, Bogota, Colombia' },
  { keywords: ['suba'], lat: 4.7437, lng: -74.0854, label: 'Suba, Bogota, Colombia' },
  { keywords: ['chapinero'], lat: 4.6486, lng: -74.0628, label: 'Chapinero, Bogota, Colombia' },
  { keywords: ['barrios unidos'], lat: 4.669, lng: -74.0752, label: 'Barrios Unidos, Bogota, Colombia' },
  { keywords: ['teusaquillo'], lat: 4.6453, lng: -74.0839, label: 'Teusaquillo, Bogota, Colombia' },
  { keywords: ['engativa', 'engativa'], lat: 4.69, lng: -74.1076, label: 'Engativa, Bogota, Colombia' },
  { keywords: ['fontibon', 'fontibon'], lat: 4.6781, lng: -74.1425, label: 'Fontibon, Bogota, Colombia' },
  { keywords: ['puente aranda'], lat: 4.6227, lng: -74.1166, label: 'Puente Aranda, Bogota, Colombia' },
  { keywords: ['martires', 'martires', 'los martires', 'los martires'], lat: 4.6033, lng: -74.0908, label: 'Los Martires, Bogota, Colombia' },
  { keywords: ['candelaria', 'la candelaria'], lat: 4.5964, lng: -74.0721, label: 'La Candelaria, Bogota, Colombia' },
  { keywords: ['santa fe', 'santa fe'], lat: 4.6092, lng: -74.0743, label: 'Santa Fe, Bogota, Colombia' },
  { keywords: ['antonio narino'], lat: 4.5932, lng: -74.1011, label: 'Antonio Narino, Bogota, Colombia' },
  { keywords: ['rafael uribe', 'rafael uribe uribe'], lat: 4.5664, lng: -74.1087, label: 'Rafael Uribe Uribe, Bogota, Colombia' },
  { keywords: ['san cristobal', 'san cristobal'], lat: 4.5468, lng: -74.0841, label: 'San Cristobal, Bogota, Colombia' },
  { keywords: ['kennedy'], lat: 4.6276, lng: -74.1536, label: 'Kennedy, Bogota, Colombia' },
  { keywords: ['bosa'], lat: 4.6162, lng: -74.1854, label: 'Bosa, Bogota, Colombia' },
  { keywords: ['tunjuelito'], lat: 4.5762, lng: -74.129, label: 'Tunjuelito, Bogota, Colombia' },
  { keywords: ['ciudad bolivar', 'ciudad bolivar'], lat: 4.5075, lng: -74.1501, label: 'Ciudad Bolivar, Bogota, Colombia' },
  { keywords: ['usme'], lat: 4.4772, lng: -74.1168, label: 'Usme, Bogota, Colombia' },
  { keywords: ['sumapaz'], lat: 4.2338, lng: -74.3494, label: 'Sumapaz, Bogota, Colombia' },
  { keywords: ['soacha'], lat: 4.5794, lng: -74.2168, label: 'Soacha, Cundinamarca, Colombia' },
  { keywords: ['norte'], lat: 4.7496, lng: -74.0339, label: 'Norte de Bogota, Colombia' },
  { keywords: ['sur'], lat: 4.5416, lng: -74.1258, label: 'Sur de Bogota, Colombia' },
  { keywords: ['occidente', 'oeste'], lat: 4.6874, lng: -74.1547, label: 'Occidente de Bogota, Colombia' },
  { keywords: ['oriente', 'este'], lat: 4.6144, lng: -74.0316, label: 'Oriente de Bogota, Colombia' },
  { keywords: ['centro'], lat: 4.6097, lng: -74.0817, label: 'Centro de Bogota, Colombia' },
];

const BOGOTA_SEARCH_EXTENT = '-74.3076,4.2338,-73.9865,4.8366';
const PRECISE_ADDRESS_TYPES = new Set([
  'PointAddress',
  'Subaddress',
  'StreetAddress',
  'StreetInt',
  'DistanceMarker',
  'StreetBetween',
]);

const normalizeText = (value = '') =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const buildSearchQuery = (value, type) => {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    return '';
  }

  if (/colombia/i.test(trimmedValue)) {
    return trimmedValue;
  }

  if (type === 'zone') {
    return `${trimmedValue}, Bogota, Colombia`;
  }

  if (/bogota|bogota/i.test(trimmedValue)) {
    return `${trimmedValue}, Colombia`;
  }

  return `${trimmedValue}, Bogota, Colombia`;
};

const buildPrecisionFromCandidate = (candidate, requestedType) => {
  if (requestedType === 'zone') {
    return 'approximate';
  }

  const score = Number(candidate?.score);
  const addrType = String(candidate?.attributes?.Addr_type || '').trim();

  return PRECISE_ADDRESS_TYPES.has(addrType) && Number.isFinite(score) && score >= 90
    ? 'exact'
    : 'approximate';
};

const buildGeocodedLocation = (candidate, query, requestedType) => {
  const lat = Number(candidate?.location?.y);
  const lng = Number(candidate?.location?.x);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const addrType = String(candidate?.attributes?.Addr_type || '').trim();
  const type = String(candidate?.attributes?.Type || '').trim();
  const score = Number(candidate?.score);

  return {
    query,
    label: candidate?.address || query,
    lat,
    lng,
    source: 'geocoded',
    precision: buildPrecisionFromCandidate(candidate, requestedType),
    score: Number.isFinite(score) ? score : undefined,
    matchType: addrType || type || undefined,
  };
};

const fallbackLocationFromText = (value, type) => {
  const query = buildSearchQuery(value, type);
  const normalized = normalizeText(query);

  const match = BOGOTA_FALLBACKS.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
  );

  if (!match) {
    return query
      ? {
          query,
          label: query,
          source: 'unresolved',
          precision: 'approximate',
        }
      : null;
  }

  return {
    query,
    label: match.label,
    lat: match.lat,
    lng: match.lng,
    source: 'heuristic',
    precision: 'approximate',
    matchType: 'Locality',
  };
};

const geocodeLocation = async (value, { type = 'address' } = {}) => {
  const query = buildSearchQuery(value, type);

  if (!query) {
    return null;
  }

  const fallbackLocation = fallbackLocationFromText(query, type);

  try {
    const url = new URL(
      'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
    );
    url.searchParams.set('f', 'pjson');
    url.searchParams.set('forStorage', 'false');
    url.searchParams.set('maxLocations', '1');
    url.searchParams.set('outFields', 'Addr_type,Type');
    url.searchParams.set('countryCode', 'COL');
    url.searchParams.set('SingleLine', query);
    url.searchParams.set('comprehensiveZoneMatch', 'false');

    if (type !== 'zone') {
      url.searchParams.set('searchExtent', BOGOTA_SEARCH_EXTENT);
    }

    const response = await fetch(url);

    if (!response.ok) {
      return fallbackLocation;
    }

    const data = await response.json();
    const firstResult = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    const geocodedLocation = buildGeocodedLocation(firstResult, query, type);

    if (!geocodedLocation) {
      return fallbackLocation;
    }

    return geocodedLocation;
  } catch {
    return fallbackLocation;
  }
};

module.exports = {
  geocodeLocation,
};
