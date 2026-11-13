import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ChevronDown, Layers, Navigation, Plus, Minus, LocateFixed } from 'lucide-react';
import { formatRelativeTime } from '../lib/usgs';

const RADIUS_PRESETS = [50, 100, 250, 500, 1000, 2500];

// Строго англоязычные тайлы согласно п. 2 ТЗ (международный стандарт картографии)
const MAP_TILES = {
  radar: {
    name: 'Dark Radar (EN)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  },
  voyager: {
    name: 'Tactical Street (EN)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
  }
};

export default function SeismicMap({
  quakes,
  selectedQuake,
  onSelectQuake,
  userLocation,
  alertRadiusKm,
  onChangeRadius,
  t,
  lang
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const userLayerRef = useRef(null);

  const [radiusMenuOpen, setRadiusMenuOpen] = useState(false);
  const [tileStyle, setTileStyle] = useState('radar');

  // Инициализация карты Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter = userLocation
      ? [userLocation.lat, userLocation.lng]
      : [37.79, -122.35]; // San Francisco Bay Area по умолчанию

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 10,
      minZoom: 2,
      maxZoom: 17,
      zoomControl: false,
      attributionControl: false
    });

    tileLayerRef.current = L.tileLayer(MAP_TILES.radar.url, {
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    userLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Переключение стиля карты (всегда на английском языке)
  const handleToggleLayer = () => {
    const next = tileStyle === 'radar' ? 'voyager' : 'radar';
    setTileStyle(next);
    if (tileLayerRef.current) {
      tileLayerRef.current.setUrl(MAP_TILES[next].url);
    }
  };

  // Отрисовка маркера пользователя "You are here" и пунктирного радиуса
  useEffect(() => {
    const map = mapInstanceRef.current;
    const userLayer = userLayerRef.current;
    if (!map || !userLayer) return;

    userLayer.clearLayers();
    if (!userLocation) return;

    // Пунктирный круг радиуса безопасности как в Figma
    L.circle([userLocation.lat, userLocation.lng], {
      radius: (alertRadiusKm || 50) * 1000,
      color: '#5eead4',
      weight: 1.8,
      dashArray: '7 7',
      fillColor: '#2dd4bf',
      fillOpacity: 0.08
    }).addTo(userLayer);

    // Синяя светящаяся точка с подписью "You are here"
    const userIcon = L.divIcon({
      className: 'custom-user-marker',
      html: `
        <div class="figma-user-pin">
          <div class="figma-user-halo"></div>
          <div class="figma-user-core"></div>
          <div class="figma-user-label">${t.youAreHere}</div>
        </div>
      `,
      iconSize: [110, 56],
      iconAnchor: [55, 18]
    });

    L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, zIndexOffset: 900 }).addTo(
      userLayer
    );
  }, [userLocation, alertRadiusKm, t.youAreHere]);

  // Центрирование карты при первом получении координат пользователя
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !userLocation) return;
    const zoomForRadius =
      alertRadiusKm <= 50
        ? 10
        : alertRadiusKm <= 150
          ? 8
          : alertRadiusKm <= 500
            ? 6
            : 4;
    map.setView([userLocation.lat, userLocation.lng], zoomForRadius, { animate: true });
  }, [userLocation?.lat, userLocation?.lng]);

  // Отрисовка маркеров землетрясений (Зелёный — Minor, Оранжевый — Moderate, Красный с "!" — Severe)
  useEffect(() => {
    const markersLayer = markersLayerRef.current;
    if (!markersLayer) return;

    markersLayer.clearLayers();

    const visibleQuakes = quakes.slice(0, 200);

    visibleQuakes.forEach((q) => {
      const isSelected = selectedQuake?.id === q.id;
      const isSevere = q.severity.level === 'severe';
      const isModerate = q.severity.level === 'moderate';

      let markerHtml = '';
      let iconSize = [32, 32];
      let iconAnchor = [16, 16];

      if (isSevere) {
        iconSize = [130, 74];
        iconAnchor = [65, 26];
        markerHtml = `
          <div class="figma-severe-marker ${isSelected ? 'is-selected' : ''}">
            <div class="severe-ripple-outer"></div>
            <div class="severe-ripple-mid"></div>
            <div class="severe-core">!</div>
            <div class="severe-pill">
              <strong>M ${q.mag.toFixed(1)}</strong>
              <span>SEVERE</span>
            </div>
          </div>
        `;
      } else if (isModerate) {
        iconSize = [36, 36];
        iconAnchor = [18, 18];
        markerHtml = `
          <div class="figma-dot-marker moderate ${isSelected ? 'is-selected' : ''}">
            <div class="dot-halo"></div>
            <div class="dot-core"></div>
          </div>
        `;
      } else {
        iconSize = [28, 28];
        iconAnchor = [14, 14];
        markerHtml = `
          <div class="figma-dot-marker minor ${isSelected ? 'is-selected' : ''}">
            <div class="dot-halo"></div>
            <div class="dot-core"></div>
          </div>
        `;
      }

      const icon = L.divIcon({
        className: 'custom-quake-div-icon',
        html: markerHtml,
        iconSize,
        iconAnchor
      });

      const distanceLine =
        q.distanceKm != null
          ? `<div class="popup-dist">${t.epicenterDistance(q.distanceKm)}</div>`
          : '';

      const marker = L.marker([q.lat, q.lng], {
        icon,
        zIndexOffset: isSevere ? 1000 : isModerate ? 600 : 300
      });

      marker.bindPopup(
        `<div class="quake-popup">
          <div class="popup-header">
            <span class="popup-mag" style="background:${q.severity.color}">M ${q.mag.toFixed(1)}</span>
            <span class="popup-time">${formatRelativeTime(q.time, lang)}</span>
          </div>
          <div class="popup-place">${q.place}</div>
          <div class="popup-meta">${t.depth}: <b>${q.depthKm} ${t.km}</b></div>
          ${distanceLine}
        </div>`
      );

      marker.on('click', () => {
        onSelectQuake(q);
      });

      marker.addTo(markersLayer);
    });
  }, [quakes, selectedQuake, onSelectQuake, lang, t]);

  // Перелёт к выбранному эпицентру
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedQuake) return;
    map.flyTo([selectedQuake.lat, selectedQuake.lng], Math.max(map.getZoom(), 8), {
      duration: 0.85
    });
  }, [selectedQuake]);

  const handleZoomIn = () => mapInstanceRef.current?.zoomIn();
  const handleZoomOut = () => mapInstanceRef.current?.zoomOut();
  const handleCenterOnUser = () => {
    const map = mapInstanceRef.current;
    if (!map || !userLocation) return;
    map.flyTo([userLocation.lat, userLocation.lng], 10, { duration: 0.8 });
  };

  return (
    <div className="figma-map-card">
      <div
        ref={mapContainerRef}
        className={`figma-map-canvas ${tileStyle === 'radar' ? 'radar-tint' : ''}`}
      />

      {/* ВЕРХНИЙ ЛЕВЫЙ СЕЛЕКТОР РАДИУСА: Radius 50 km ⌄ */}
      <div className="map-top-left">
        <button
          type="button"
          className="radius-dropdown-btn"
          onClick={() => setRadiusMenuOpen((o) => !o)}
        >
          <LocateFixed size={16} className="text-mint" />
          <span className="radius-label">{t.radius}</span>
          <strong className="radius-value">
            {alertRadiusKm} {t.km}
          </strong>
          <ChevronDown size={15} className="radius-chevron" />
        </button>

        {radiusMenuOpen && (
          <div className="radius-dropdown-menu">
            {RADIUS_PRESETS.map((r) => (
              <button
                key={r}
                type="button"
                className={`radius-option ${alertRadiusKm === r ? 'active' : ''}`}
                onClick={() => {
                  onChangeRadius(r);
                  setRadiusMenuOpen(false);
                }}
              >
                <span>
                  {r} {t.km}
                </span>
                {alertRadiusKm === r && <span className="dot-active" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ВЕРХНЯЯ ПРАВАЯ КНОПКА СЛОЁВ */}
      <button
        type="button"
        className="map-layers-btn"
        onClick={handleToggleLayer}
        title="Switch Map Layer (English Labels)"
      >
        <Layers size={18} />
      </button>

      {/* НИЖНЯЯ ЛЕВАЯ ЛЕГЕНДА И МАСШТАБ (как в Figma) */}
      <div className="map-bottom-left">
        <div className="map-scale-bar">
          <span>20 km</span>
          <div className="scale-line" />
        </div>
        <div className="figma-legend-pill">
          <div className="legend-entry">
            <span className="legend-dot minor" />
            <span>{t.minor}</span>
          </div>
          <div className="legend-entry">
            <span className="legend-dot moderate" />
            <span>{t.moderate}</span>
          </div>
          <div className="legend-entry">
            <span className="legend-dot severe" />
            <span>{t.severe}</span>
          </div>
        </div>
      </div>

      {/* НИЖНИЕ ПРАВЫЕ КНОПКИ ЗУМА И ЦЕНТРИРОВАНИЯ */}
      <div className="map-bottom-right">
        <div className="zoom-button-group">
          <button type="button" onClick={handleZoomIn} aria-label="Zoom in">
            <Plus size={18} />
          </button>
          <div className="zoom-divider" />
          <button type="button" onClick={handleZoomOut} aria-label="Zoom out">
            <Minus size={18} />
          </button>
        </div>

        <button
          type="button"
          className="locate-me-btn"
          onClick={handleCenterOnUser}
          aria-label="Center on my location"
        >
          <Navigation size={17} className="nav-arrow-icon" />
        </button>
      </div>
    </div>
  );
}
