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

  if (/bogota|bogotá/i.test(trimmedValue)) {
    return `${trimmedValue}, Colombia`;
  }

  return `${trimmedValue}, Bogota, Colombia`;
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
        }
      : null;
  }

  return {
    query,
    label: match.label,
    lat: match.lat,
    lng: match.lng,
    source: 'heuristic',
  };
};

const geocodeLocation = async (value, { type = 'address' } = {}) => {
  const query = buildSearchQuery(value, type);

  if (!query) {
    return null;
  }

  const fallbackLocation = fallbackLocationFromText(query, type);

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'co');
    url.searchParams.set('q', query);

    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
        'User-Agent': 'SOS.Live/1.0 (local dashboard geocoder)',
      },
    });

    if (!response.ok) {
      return fallbackLocation;
    }

    const data = await response.json();
    const firstResult = Array.isArray(data) ? data[0] : null;
    const lat = Number(firstResult?.lat);
    const lng = Number(firstResult?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fallbackLocation;
    }

    return {
      query,
      label: firstResult?.display_name || query,
      lat,
      lng,
      source: 'geocoded',
    };
  } catch {
    return fallbackLocation;
  }
};

module.exports = {
  geocodeLocation,
};
