import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ChevronDown, Layers, Navigation, Plus, Minus, LocateFixed } from 'lucide-react';
import { formatRelativeTime } from '../lib/usgs';

const RADIUS_PRESETS = [50, 100, 250, 500, 1000, 2500];

const TILE_PROVIDERS = [
  {
    id: 'esriDark',
    labelKey: 'layerDarkRadar',
    baseUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labelsUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    tintClass: 'radar-tint'
  },
  {
    id: 'esriSatellite',
    labelKey: 'layerSatellite',
    baseUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelsUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    tintClass: ''
  },
  {
    id: 'esriStreet',
    labelKey: 'layerStreet',
    baseUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    labelsUrl: null,
    tintClass: ''
  },
  {
    id: 'esriTopo',
    labelKey: 'layerTopo',
    baseUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    labelsUrl: null,
    tintClass: ''
  }
];

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
  const baseTileLayerRef = useRef(null);
  const labelsTileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const userLayerRef = useRef(null);

  const [radiusMenuOpen, setRadiusMenuOpen] = useState(false);
  const [layersMenuOpen, setLayersMenuOpen] = useState(false);
  const [providerIdx, setProviderIdx] = useState(0);

  // Прямое переключение тайлов на инстансе карты Leaflet
  const applyTileProvider = (index) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current);
      baseTileLayerRef.current = null;
    }
    if (labelsTileLayerRef.current) {
      map.removeLayer(labelsTileLayerRef.current);
      labelsTileLayerRef.current = null;
    }

    const provider = TILE_PROVIDERS[index % TILE_PROVIDERS.length];

    const baseLayer = L.tileLayer(provider.baseUrl, {
      maxZoom: 18
    }).addTo(map);
    baseLayer.bringToBack();
    baseTileLayerRef.current = baseLayer;

    if (provider.labelsUrl) {
      const labelsLayer = L.tileLayer(provider.labelsUrl, {
        maxZoom: 18,
        pane: 'tilePane'
      }).addTo(map);
      labelsTileLayerRef.current = labelsLayer;
    }

    setTimeout(() => map.invalidateSize(), 50);
  };

  // Инициализация карты Leaflet
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapInstanceRef.current) return;

    const initialCenter = userLocation
      ? [userLocation.lat, userLocation.lng]
      : [37.79, -122.35];

    const map = L.map(container, {
      center: initialCenter,
      zoom: 5,
      minZoom: 2,
      maxZoom: 17,
      zoomControl: false,
      attributionControl: false
    });

    userLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    applyTileProvider(providerIdx);

    setTimeout(() => map.invalidateSize(), 100);
    setTimeout(() => map.invalidateSize(), 400);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Обновление слоя при выборе в меню
  useEffect(() => {
    applyTileProvider(providerIdx);
  }, [providerIdx]);

  // Отрисовка маркера пользователя "You are here" и пунктирного круга радиуса
  useEffect(() => {
    const map = mapInstanceRef.current;
    const userLayer = userLayerRef.current;
    if (!map || !userLayer) return;

    userLayer.clearLayers();
    if (!userLocation) return;

    L.circle([userLocation.lat, userLocation.lng], {
      radius: (alertRadiusKm || 50) * 1000,
      color: '#5eead4',
      weight: 1.8,
      dashArray: '7 7',
      fillColor: '#2dd4bf',
      fillOpacity: 0.08
    }).addTo(userLayer);

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

  // Центрирование на координатах пользователя при их обновлении
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !userLocation) return;
    map.setView([userLocation.lat, userLocation.lng], map.getZoom(), { animate: true });
  }, [userLocation?.lat, userLocation?.lng]);

  // Отрисовка маркеров землетрясений
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
    map.flyTo([userLocation.lat, userLocation.lng], 9, { duration: 0.8 });
  };

  const currentProvider = TILE_PROVIDERS[providerIdx % TILE_PROVIDERS.length];

  return (
    <div className={`figma-map-card ${currentProvider.tintClass}`}>
      {/* ВАЖНО: className на самом контейнере Leaflet не должен динамически меняться React-ом, чтобы не затирать системный класс leaflet-container */}
      <div ref={mapContainerRef} className="figma-map-canvas" />

      {/* ВЕРХНИЙ ЛЕВЫЙ СЕЛЕКТОР РАДИУСА: Radius 50 km ⌄ */}
      <div className="map-top-left">
        <button
          type="button"
          className="radius-dropdown-btn"
          onClick={() => {
            setRadiusMenuOpen((o) => !o);
            setLayersMenuOpen(false);
          }}
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

      {/* ВЕРХНЯЯ ПРАВАЯ КНОПКА СЛОЁВ С ВЫПАДАЮЩИМ СПИСКОМ КАРТ */}
      <div className="map-top-right-wrap">
        <button
          type="button"
          className="map-layers-btn"
          onClick={() => {
            setLayersMenuOpen((o) => !o);
            setRadiusMenuOpen(false);
          }}
          title={t[currentProvider.labelKey] || currentProvider.id}
        >
          <Layers size={18} />
        </button>

        {layersMenuOpen && (
          <div className="layers-dropdown-menu">
            {TILE_PROVIDERS.map((prov, idx) => (
              <button
                key={prov.id}
                type="button"
                className={`radius-option ${providerIdx === idx ? 'active' : ''}`}
                onClick={() => {
                  setProviderIdx(idx);
                  setLayersMenuOpen(false);
                }}
              >
                <span>{t[prov.labelKey] || prov.id}</span>
                {providerIdx === idx && <span className="dot-active" />}
              </button>
            ))}
          </div>
        )}
      </div>

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
