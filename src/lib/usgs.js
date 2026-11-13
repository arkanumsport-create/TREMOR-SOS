/**
 * Клиент сейсмических данных USGS (Геологическая служба США)
 * Фокус на СИЛЬНЫХ (M4.5+) и ЗНАЧИМЫХ/РАЗРУШИТЕЛЬНЫХ (Significant) землетрясениях
 * + расчёт расстояний по прямой (формула гаверсинусов).
 */

export const USGS_FEEDS = {
  strong: {
    id: 'strong',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'
  },
  significant: {
    id: 'significant',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson'
  },
  day25: {
    id: 'day25',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
  }
};

/**
 * Формула гаверсинусов — точное расстояние по прямой в километрах
 */
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371; // Радиус Земли, км
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.round(R * c));
}

/**
 * Классификация по цветам из ТЗ и Figma:
 * - Зелёный (Minor / Норма)
 * - Оранжевый (Moderate / Внимание)
 * - Красный (Severe / Опасность)
 */
export function getSeverityInfo(mag) {
  const m = Number(mag) || 0;
  if (m >= 4.8) {
    return {
      level: 'severe',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.18)',
      border: 'rgba(239, 68, 68, 0.5)'
    };
  }
  if (m >= 4.0) {
    return {
      level: 'moderate',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.18)',
      border: 'rgba(245, 158, 11, 0.5)'
    };
  }
  return {
    level: 'minor',
    color: '#2dd4bf',
    bg: 'rgba(45, 212, 191, 0.16)',
    border: 'rgba(45, 212, 191, 0.45)'
  };
}

/**
 * Загрузка реальных сильных и значимых землетрясений из интернета (USGS GeoJSON API)
 */
export async function fetchEarthquakes(feedKey = 'strong', userLocation = null) {
  // Загружаем основную ленту + значимые (разрушительные) за месяц для полноты картины
  const primaryUrl = (USGS_FEEDS[feedKey] || USGS_FEEDS.strong).url;
  const [primaryRes, sigRes] = await Promise.all([
    fetch(primaryUrl),
    feedKey !== 'significant'
      ? fetch(USGS_FEEDS.significant.url).catch(() => null)
      : Promise.resolve(null)
  ]);

  if (!primaryRes.ok) {
    throw new Error(`USGS API Error (${primaryRes.status})`);
  }

  const primaryData = await primaryRes.json();
  let features = Array.isArray(primaryData.features) ? [...primaryData.features] : [];

  if (sigRes && sigRes.ok) {
    const sigData = await sigRes.json();
    if (Array.isArray(sigData.features)) {
      const existingIds = new Set(features.map((f) => f.id));
      sigData.features.forEach((f) => {
        if (!existingIds.has(f.id)) features.push(f);
      });
    }
  }

  const MAX_SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  return features
    .map((item) => {
      const coords = item.geometry?.coordinates || [0, 0, 0];
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      const depthKm = Math.max(0, Math.round(Number(coords[2]) || 0));
      const mag = Number(item.properties?.mag) || 0;
      const time = item.properties?.time || now;
      const distanceKm = userLocation
        ? calculateDistanceKm(userLocation.lat, userLocation.lng, lat, lng)
        : null;

      return {
        id: item.id,
        mag,
        place: item.properties?.place || 'Unknown Region',
        time,
        url: item.properties?.url || 'https://earthquake.usgs.gov',
        tsunami: Boolean(item.properties?.tsunami),
        felt: item.properties?.felt || 0,
        alert: item.properties?.alert || (mag >= 6.0 ? 'red' : mag >= 5.2 ? 'orange' : 'green'),
        significance: item.properties?.sig || Math.round(mag * 100),
        mmi: item.properties?.mmi || null,
        lat,
        lng,
        depthKm,
        distanceKm,
        severity: getSeverityInfo(mag)
      };
    })
    .filter(
      (q) =>
        !Number.isNaN(q.lat) &&
        !Number.isNaN(q.lng) &&
        q.mag > 0 &&
        now - q.time <= MAX_SEVEN_DAYS_MS
    )
    .sort((a, b) => b.time - a.time);
}

/**
 * Генерация демо-толчков вокруг текущих координат пользователя (как на макете Figma: Berkeley M4.8, Oakland и т.д.),
 * чтобы можно было в 1 клик проверить работу 50 км радиуса и Push-уведомлений рядом с собой.
 */
export function generateNearbyPreviewQuakes(userLocation) {
  const baseLat = userLocation?.lat ?? 37.7749;
  const baseLng = userLocation?.lng ?? -122.4194;
  const isSf = Math.abs(baseLat - 37.7749) < 0.5;

  const items = [
    {
      id: 'preview-severe-1',
      mag: 4.8,
      place: isSf ? 'Berkeley, CA' : '12 km NE of Your Location',
      time: Date.now() - 2 * 60 * 1000,
      url: 'https://earthquake.usgs.gov',
      tsunami: false,
      felt: 428,
      alert: 'orange',
      significance: 560,
      lat: baseLat + 0.085,
      lng: baseLng + 0.115,
      depthKm: 10
    },
    {
      id: 'preview-moderate-2',
      mag: 4.2,
      place: isSf ? 'North Bay / Marin, CA' : '16 km NW of Your Location',
      time: Date.now() - 18 * 60 * 1000,
      url: 'https://earthquake.usgs.gov',
      tsunami: false,
      felt: 112,
      alert: 'yellow',
      significance: 390,
      lat: baseLat + 0.095,
      lng: baseLng - 0.09,
      depthKm: 8
    },
    {
      id: 'preview-minor-3',
      mag: 2.9,
      place: isSf ? 'Oakland Hills, CA' : '19 km SE of Your Location',
      time: Date.now() - 41 * 60 * 1000,
      url: 'https://earthquake.usgs.gov',
      tsunami: false,
      felt: 24,
      alert: 'green',
      significance: 180,
      lat: baseLat - 0.04,
      lng: baseLng + 0.16,
      depthKm: 6
    },
    {
      id: 'preview-minor-4',
      mag: 2.6,
      place: isSf ? 'Daly City, CA' : '14 km SW of Your Location',
      time: Date.now() - 75 * 60 * 1000,
      url: 'https://earthquake.usgs.gov',
      tsunami: false,
      felt: 9,
      alert: 'green',
      significance: 120,
      lat: baseLat - 0.095,
      lng: baseLng - 0.05,
      depthKm: 12
    }
  ];

  return items.map((q) => ({
    ...q,
    distanceKm: calculateDistanceKm(baseLat, baseLng, q.lat, q.lng),
    severity: getSeverityInfo(q.mag)
  }));
}

/**
 * Относительное время на выбранном языке (EN / ES / RU)
 */
export function formatRelativeTime(timestamp, lang = 'en') {
  const diffSec = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) {
    if (lang === 'ru') return `${diffSec} сек назад`;
    if (lang === 'es') return `hace ${diffSec} s`;
    return `${diffSec} sec ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    if (lang === 'ru') return `${diffMin} мин назад`;
    if (lang === 'es') return `hace ${diffMin} min`;
    return `${diffMin} min ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    if (lang === 'ru') return `${diffHours} ч назад`;
    if (lang === 'es') return `hace ${diffHours} h`;
    return `${diffHours} hr ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  const remHours = diffHours % 24;
  if (lang === 'ru') {
    return remHours > 0 ? `${diffDays} дн ${remHours} ч назад` : `${diffDays} дн назад`;
  }
  if (lang === 'es') {
    return remHours > 0 ? `hace ${diffDays} d ${remHours} h` : `hace ${diffDays} d`;
  }
  return remHours > 0 ? `${diffDays} d ${remHours} hr ago` : `${diffDays} d ago`;
}

/**
 * Обратное геокодирование координат в название города на английском (или локальном) языке
 */
export async function reverseGeocodeCity(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=en`
    );
    if (!res.ok) return `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`;
    const data = await res.json();
    const city =
      data.address?.city ||
      data.address?.town ||
      data.address?.municipality ||
      data.address?.county ||
      data.address?.state;
    const stateOrCountry = data.address?.state_code || data.address?.country_code?.toUpperCase();
    if (city && stateOrCountry) return `${city}, ${stateOrCountry}`;
    if (city) return city;
    return `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
  } catch {
    return `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
  }
}
