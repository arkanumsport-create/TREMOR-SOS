/**
 * Клиент сейсмических данных USGS (Геологическая служба США) + EMSC (SeismicPortal)
 * - Загрузка без кэша (cache: 'no-store') для мгновенного получения новых толчков
 * - Автоматическое удаление любых событий старше 7 дней (7 * 24 ч)
 * - Подгрузка как мировых сильных землетрясений (M4.5+), так и ближайших к пользователю опасных толчков
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
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'
  }
};

export const MAX_SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Загрузка реальных землетрясений из интернета (USGS + региональный радар вокруг пользователя)
 * Строгий фильтр: только за последние 7 дней (старые автоматически удаляются).
 */
export async function fetchEarthquakes(feedKey = 'strong', userLocation = null) {
  const now = Date.now();
  const primaryUrl = (USGS_FEEDS[feedKey] || USGS_FEEDS.strong).url;

  // Запрашиваем выбранную ленту + значимые мировые + региональные ощутимые (2.5_week), чтобы всегда видеть ближайшие к пользователю толчки
  const requests = [
    fetch(primaryUrl, { cache: 'no-store' }),
    feedKey !== 'significant'
      ? fetch(USGS_FEEDS.significant.url, { cache: 'no-store' }).catch(() => null)
      : Promise.resolve(null),
    feedKey !== 'day25'
      ? fetch(USGS_FEEDS.day25.url, { cache: 'no-store' }).catch(() => null)
      : Promise.resolve(null)
  ];

  const [primaryRes, sigRes, regionalRes] = await Promise.all(requests);

  if (!primaryRes || !primaryRes.ok) {
    throw new Error(`USGS API Error (${primaryRes?.status || 'network'})`);
  }

  const primaryData = await primaryRes.json();
  const rawFeatures = Array.isArray(primaryData.features) ? [...primaryData.features] : [];
  const seenIds = new Set(rawFeatures.map((f) => f.id));

  // Добавляем значимые/разрушительные события
  if (sigRes && sigRes.ok) {
    try {
      const sigData = await sigRes.json();
      if (Array.isArray(sigData.features)) {
        sigData.features.forEach((f) => {
          if (!seenIds.has(f.id)) {
            seenIds.add(f.id);
            rawFeatures.push(f);
          }
        });
      }
    } catch {
      // ignore
    }
  }

  // Добавляем ближайшие к пользователю опасные/ощутимые толчки (в радиусе до 2200 км или M4.0+)
  if (regionalRes && regionalRes.ok && userLocation) {
    try {
      const regData = await regionalRes.json();
      if (Array.isArray(regData.features)) {
        regData.features.forEach((f) => {
          if (seenIds.has(f.id)) return;
          const coords = f.geometry?.coordinates || [0, 0, 0];
          const mag = Number(f.properties?.mag) || 0;
          const dist = calculateDistanceKm(
            userLocation.lat,
            userLocation.lng,
            Number(coords[1]),
            Number(coords[0])
          );
          if (mag >= 4.0 || (dist != null && dist <= 2200 && mag >= 3.0)) {
            seenIds.add(f.id);
            rawFeatures.push(f);
          }
        });
      }
    } catch {
      // ignore
    }
  }

  return rawFeatures
    .map((item) => {
      const coords = item.geometry?.coordinates || [0, 0, 0];
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      const depthKm = Math.max(0, Math.round(Number(coords[2]) || 0));
      const mag = Number(item.properties?.mag) || 0;
      const time = Number(item.properties?.time) || now;
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
        now - q.time >= -60000 &&
        now - q.time <= MAX_SEVEN_DAYS_MS
    )
    .sort((a, b) => b.time - a.time);
}

/**
 * Генерация демо-толчков вокруг текущих координат пользователя (для теста радиуса 50 км)
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
 * Относительное время на выбранном языке (EN / ES / RU) в минутах, часах и днях
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
 * Обратное геокодирование координат в название города на английском (международный формат: Maracay, VE)
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
