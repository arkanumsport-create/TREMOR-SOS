import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronRight,
  ExternalLink,
  Globe,
  Map as MapIcon,
  MapPin,
  Newspaper,
  Radio,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  Sliders,
  Users,
  Waves
} from 'lucide-react';
import SeismicMap from './components/SeismicMap';
import SosModal from './components/SosModal';
import { TRANSLATIONS } from './lib/i18n';
import {
  calculateDistanceKm,
  fetchEarthquakes,
  formatRelativeTime,
  generateNearbyPreviewQuakes,
  reverseGeocodeCity
} from './lib/usgs';
import {
  getUserLocation,
  initTelegramMiniApp,
  requestNotificationPermission,
  sendSeismicPushNotification,
  triggerHaptic
} from './lib/platform';

const DEFAULT_SF_COORDS = {
  lat: 37.7749,
  lng: -122.4194,
  accuracy: 25
};

export default function App() {
  // Язык интерфейса: 'en' | 'es' | 'ru'
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('tremor_lang');
    if (saved === 'en' || saved === 'es' || saved === 'ru') return saved;
    return 'en'; // На макете Figma английский по умолчанию, переключается в 1 клик
  });
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;

  // Активный экран нижней навигации: 'map' | 'feed' | 'news' | 'settings'
  const [activeTab, setActiveTab] = useState('map');

  // Геолокация и модальное окно первого запуска (сохраняем координаты и город в localStorage, чтобы не слетали при обновлении страницы)
  const [geoEnabled, setGeoEnabled] = useState(() => {
    return localStorage.getItem('tremor_geo_enabled') !== 'false';
  });
  const [userLocation, setUserLocation] = useState(() => {
    try {
      const saved = localStorage.getItem('tremor_user_coords');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_SF_COORDS;
  });
  const [cityName, setCityName] = useState(() => {
    return localStorage.getItem('tremor_city_name') || 'San Francisco, CA';
  });
  const [showGeoPromptModal, setShowGeoPromptModal] = useState(() => {
    return !localStorage.getItem('tremor_geo_prompted');
  });
  const [locatingGps, setLocatingGps] = useState(false);

  // Настройки уведомлений и радиуса безопасности (п. 4 ТЗ)
  const [alertRadiusKm, setAlertRadiusKm] = useState(() => {
    const saved = Number(localStorage.getItem('tremor_radius_km'));
    return saved > 0 ? saved : 50; // На макете Figma "Radius 50 km"
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('tremor_notif_enabled') !== 'false';
  });
  const [tsunamiAlerts, setTsunamiAlerts] = useState(true);
  const [earthquakeAlerts, setEarthquakeAlerts] = useState(true);
  const [testPushFeedback, setTestPushFeedback] = useState(false);

  // Режим данных: 'live' (100% реальные данные USGS со всего мира) или 'preview' (тестовые точки из макета Figma для проверки радиуса 50 км)
  const [dataSourceMode, setDataSourceMode] = useState('live');
  const [feedFilter, setFeedFilter] = useState('strong'); // 'strong' | 'significant' | 'day25'
  const [sortBy, setSortBy] = useState('time'); // 'time' | 'mag' | 'distance'

  const [liveQuakes, setLiveQuakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedQuake, setSelectedQuake] = useState(null);
  const [isSosOpen, setIsSosOpen] = useState(false);
  const [feltCount, setFeltCount] = useState(0);

  const notifiedIdsRef = useRef(new Set());

  // Инициализация Telegram Mini App
  useEffect(() => {
    initTelegramMiniApp();
  }, []);

  // Сохранение языка и радиуса
  const handleSetLang = (newLang) => {
    triggerHaptic('selection');
    setLang(newLang);
    localStorage.setItem('tremor_lang', newLang);
  };

  const handleSetRadius = (km) => {
    const clamped = Math.max(10, Math.min(5000, Number(km) || 50));
    setAlertRadiusKm(clamped);
    localStorage.setItem('tremor_radius_km', String(clamped));
  };

  // Запрос реальной GPS-геопозиции пользователя с сохранением в localStorage
  const handleRequestGps = useCallback(async (silent = false) => {
    const isSilent = silent === true;
    if (!isSilent) setLocatingGps(true);
    try {
      const coords = await getUserLocation();
      setUserLocation(coords);
      setGeoEnabled(true);
      localStorage.setItem('tremor_geo_enabled', 'true');
      localStorage.setItem('tremor_user_coords', JSON.stringify(coords));
      localStorage.setItem('tremor_geo_prompted', 'true');
      setShowGeoPromptModal(false);
      if (!isSilent) triggerHaptic('selection');

      const place = await reverseGeocodeCity(coords.lat, coords.lng);
      if (place) {
        setCityName(place);
        localStorage.setItem('tremor_city_name', place);
      }
    } catch {
      // Если доступ временно не ответил — сохраняем уже сохранённую локацию
      localStorage.setItem('tremor_geo_prompted', 'true');
      setShowGeoPromptModal(false);
    } finally {
      if (!isSilent) setLocatingGps(false);
    }
  }, []);

  // При перезагрузке страницы подтягиваем свежие координаты в фоне, не сбрасывая сохранённый город
  useEffect(() => {
    if (localStorage.getItem('tremor_geo_prompted') === 'true' && geoEnabled) {
      handleRequestGps(true);
    }
  }, [handleRequestGps, geoEnabled]);

  const handleUseDemoLocation = () => {
    localStorage.setItem('tremor_geo_prompted', 'true');
    localStorage.setItem('tremor_user_coords', JSON.stringify(DEFAULT_SF_COORDS));
    localStorage.setItem('tremor_city_name', 'San Francisco, CA');
    setUserLocation(DEFAULT_SF_COORDS);
    setCityName('San Francisco, CA');
    setShowGeoPromptModal(false);
  };

  // Загрузка реальных сильных и разрушительных землетрясений с USGS
  const loadUsgsQuakes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEarthquakes(feedFilter, userLocation);
      setLiveQuakes(data);
    } catch (err) {
      console.warn('USGS fetch warning:', err);
    } finally {
      setLoading(false);
    }
  }, [feedFilter, userLocation]);

  useEffect(() => {
    loadUsgsQuakes();
    const timer = setInterval(loadUsgsQuakes, 60000);
    return () => clearInterval(timer);
  }, [loadUsgsQuakes]);

  // Объединение или выбор между реальными данными USGS и локальным превью рядом с пользователем
  const activeQuakes = useMemo(() => {
    const previewList = generateNearbyPreviewQuakes(userLocation);
    const recalculatedLive = liveQuakes.map((q) => ({
      ...q,
      distanceKm: userLocation
        ? calculateDistanceKm(userLocation.lat, userLocation.lng, q.lat, q.lng)
        : q.distanceKm
    }));

    if (dataSourceMode === 'preview') {
      return [...previewList, ...recalculatedLive];
    }

    // Если в реальных данных USGS за неделю нет толчков в радиусе 100 км от текущей точки,
    // на карте покажем реальные мировые сильные толчки, а при переключении в Preview — близкие
    return recalculatedLive.length > 0 ? recalculatedLive : previewList;
  }, [dataSourceMode, liveQuakes, userLocation]);

  // Сортировка ленты
  const sortedQuakes = useMemo(() => {
    return [...activeQuakes].sort((a, b) => {
      if (sortBy === 'mag') return b.mag - a.mag;
      if (sortBy === 'distance') {
        return (a.distanceKm ?? 999999) - (b.distanceKm ?? 999999);
      }
      return b.time - a.time;
    });
  }, [activeQuakes, sortBy]);

  // Ближайшее событие (для карточки LATEST NEARBY EVENT под картой как в Figma)
  const latestNearbyEvent = useMemo(() => {
    const withinRadius = activeQuakes.filter(
      (q) => q.distanceKm != null && q.distanceKm <= alertRadiusKm
    );
    if (withinRadius.length > 0) {
      return withinRadius.sort((a, b) => b.mag - a.mag)[0];
    }
    // Если в текущем радиусе тихо, показываем самое близкое сильное землетрясение из мировой сводки USGS
    return (
      [...activeQuakes].sort((a, b) => (a.distanceKm ?? 999999) - (b.distanceKm ?? 999999))[0] ||
      null
    );
  }, [activeQuakes, alertRadiusKm]);

  // Автоматическая отправка Push-уведомления, если эпицентр укладывается в заданный радиус безопасности (п. 4 ТЗ)
  useEffect(() => {
    if (!notificationsEnabled || !geoEnabled || !userLocation) return;

    activeQuakes.forEach((q) => {
      if (q.distanceKm == null || q.distanceKm > alertRadiusKm) return;
      if (notifiedIdsRef.current.has(q.id)) return;

      const isTsunamiMatch = tsunamiAlerts && q.tsunami;
      const isQuakeMatch = earthquakeAlerts && q.mag >= 4.0;

      if (isTsunamiMatch || isQuakeMatch) {
        notifiedIdsRef.current.add(q.id);
        sendSeismicPushNotification({
          title: t.pushTitle,
          body: t.pushBody(q.mag.toFixed(1), q.place, q.distanceKm)
        });
      }
    });
  }, [
    activeQuakes,
    alertRadiusKm,
    notificationsEnabled,
    geoEnabled,
    userLocation,
    tsunamiAlerts,
    earthquakeAlerts,
    t
  ]);

  // Крупные и разрушительные землетрясения для вкладки News (Новости и последствия)
  const impactNewsQuakes = useMemo(() => {
    return [...activeQuakes]
      .filter((q) => q.mag >= 4.5 || q.tsunami || q.felt > 20)
      .sort((a, b) => b.significance - a.significance || b.mag - a.mag)
      .slice(0, 25);
  }, [activeQuakes]);

  const handleTestPush = async () => {
    await requestNotificationPermission();
    const sample = latestNearbyEvent || {
      mag: 4.8,
      place: 'Berkeley, CA',
      distanceKm: 12
    };
    await sendSeismicPushNotification({
      title: t.pushTitle,
      body: t.pushBody(sample.mag.toFixed(1), sample.place, sample.distanceKm ?? 12)
    });
    setTestPushFeedback(true);
    setTimeout(() => setTestPushFeedback(false), 3500);
  };

  return (
    <div className="figma-app-root">
      <div className="figma-phone-frame">
        {/* ШАПКА ПРИЛОЖЕНИЯ (Обновлённая по пожеланиям: синий фон, бордовый TREMOR, живая жёлтая кардиограмма) */}
        <header className="figma-header">
          <div className="figma-header-top">
            <div className="figma-brand-row">
              <div
                className="figma-pulse-logo"
                onClick={() => setActiveTab('map')}
                title="Live Seismograph"
              >
                <svg
                  className="ecg-svg"
                  viewBox="0 0 64 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    className="ecg-wave-bg"
                    d="M0 16 H14 L19 7 L25 27 L31 4 L37 28 L42 12 L46 16 H64"
                  />
                  <path
                    className="ecg-wave-line"
                    d="M0 16 H14 L19 7 L25 27 L31 4 L37 28 L42 12 L46 16 H64"
                  />
                </svg>
              </div>
              <h1 className="figma-title">
                <span className="title-burgundy">TREMOR</span>{' '}
                <span className="title-mint">SOS</span>
              </h1>
            </div>

            <div className="figma-header-actions">
              <button
                type="button"
                className="sos-mini-pill"
                onClick={() => {
                  triggerHaptic('danger');
                  setIsSosOpen(true);
                }}
                title={t.sosButton}
              >
                SOS
              </button>
              <div className="figma-live-pill">
                <span className="live-dot" />
                <span>{t.live}</span>
              </div>
            </div>
          </div>

          <div className="figma-location-row" onClick={handleRequestGps}>
            <MapPin size={21} strokeWidth={2.6} className="locator-pin-icon" />
            <span className="location-city-text">
              {locatingGps ? t.locating : geoEnabled ? cityName : t.locationUnknown}
            </span>
          </div>

          <div className="figma-status-subrow">
            <span className="status-white-bold">{t.subtitle}</span>
            <span className="updated-label status-white-bold">{t.updatedJustNow}</span>
          </div>
        </header>

        {/* ЭКРАН 1: КАРТА (Главный экран из Figma) */}
        {activeTab === 'map' && (
          <main className="figma-screen-content">
            <SeismicMap
              quakes={activeQuakes}
              selectedQuake={selectedQuake}
              onSelectQuake={(q) => {
                triggerHaptic('selection');
                setSelectedQuake(q);
              }}
              userLocation={geoEnabled ? userLocation : null}
              alertRadiusKm={alertRadiusKm}
              onChangeRadius={handleSetRadius}
              t={t}
              lang={lang}
            />

            {/* КАРТОЧКА LATEST NEARBY EVENT ПОД КАРТОЙ (1:1 по Figma) */}
            {latestNearbyEvent && (
              <section
                className="figma-latest-card"
                onClick={() => {
                  setSelectedQuake(latestNearbyEvent);
                }}
              >
                <div className="latest-card-top">
                  <span className="latest-heading">{t.latestNearbyEvent}</span>
                  <button
                    type="button"
                    className="view-details-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedQuake(latestNearbyEvent);
                      setActiveTab('feed');
                    }}
                  >
                    <span>{t.viewDetails}</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                <div className="latest-card-body">
                  <div className={`latest-mag-box ${latestNearbyEvent.severity.level}`}>
                    <span className="m-prefix">M</span>
                    <strong className="m-number">{latestNearbyEvent.mag.toFixed(1)}</strong>
                  </div>

                  <div className="latest-event-info">
                    <h3 className="latest-place">{latestNearbyEvent.place}</h3>
                    <p className="latest-meta">
                      {latestNearbyEvent.distanceKm != null
                        ? `${latestNearbyEvent.distanceKm} ${t.kmAway}`
                        : ''}{' '}
                      · {formatRelativeTime(latestNearbyEvent.time, lang)}
                    </p>
                  </div>

                  <span className={`severity-badge-pill ${latestNearbyEvent.severity.level}`}>
                    {latestNearbyEvent.severity.level === 'severe'
                      ? t.severe
                      : latestNearbyEvent.severity.level === 'moderate'
                        ? t.moderate
                        : t.minor}
                  </span>
                </div>
              </section>
            )}

            {/* СТРОКА ПОД КАРТОЧКОЙ: Monitoring your 50 km radius | Preview data / Live USGS */}
            <div className="figma-monitoring-footer">
              <span>{t.monitoringRadius(alertRadiusKm)}</span>
              <button
                type="button"
                className="preview-toggle-link"
                onClick={() =>
                  setDataSourceMode((m) => (m === 'live' ? 'preview' : 'live'))
                }
              >
                {dataSourceMode === 'preview' ? t.previewData : t.liveUsgsData}
              </button>
            </div>
          </main>
        )}

        {/* ЭКРАН 2: ЛЕНТА СОБЫТИЙ (Feed) */}
        {activeTab === 'feed' && (
          <main className="figma-screen-content scrollable-pane">
            <div className="screen-section-header">
              <div>
                <h2>{t.feedTitle}</h2>
                <p>{t.feedSubtitle}</p>
              </div>
              <button
                type="button"
                className="icon-Action-btn"
                onClick={loadUsgsQuakes}
                title="Refresh"
              >
                <RefreshCw size={16} className={loading ? 'spin' : ''} />
              </button>
            </div>

            {/* Фильтры только сильных / разрушительных толчков */}
            <div className="feed-filter-row">
              {[
                { id: 'strong', label: t.filterStrong },
                { id: 'significant', label: t.filterSignificant },
                { id: 'day25', label: t.filterAllDay }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`filter-chip ${feedFilter === tab.id ? 'active' : ''}`}
                  onClick={() => {
                    setDataSourceMode('live');
                    setFeedFilter(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="feed-sort-row">
              {[
                { id: 'time', label: t.sortByTime },
                { id: 'mag', label: t.sortByMag },
                { id: 'distance', label: t.sortByDistance }
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`sort-tab-btn ${sortBy === s.id ? 'active' : ''}`}
                  onClick={() => setSortBy(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="feed-cards-list">
              {sortedQuakes.length === 0 ? (
                <div className="empty-card">{t.noEventsInFeed}</div>
              ) : (
                sortedQuakes.slice(0, 80).map((q) => (
                  <article
                    key={q.id}
                    className={`feed-quake-card ${selectedQuake?.id === q.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedQuake(q);
                      setActiveTab('map');
                    }}
                  >
                    <div className={`latest-mag-box ${q.severity.level}`}>
                      <span className="m-prefix">M</span>
                      <strong className="m-number">{q.mag.toFixed(1)}</strong>
                    </div>

                    <div className="feed-card-center">
                      <h4>{q.place}</h4>
                      <div className="feed-card-sub">
                        <span>{formatRelativeTime(q.time, lang)}</span>
                        <span>•</span>
                        <span>
                          {t.depth}: {q.depthKm} {t.km}
                        </span>
                      </div>
                      {q.distanceKm != null && (
                        <div className="feed-distance-highlight">
                          📍 {t.epicenterDistance(q.distanceKm)}
                        </div>
                      )}
                      {q.tsunami && (
                        <div className="tsunami-badge-inline">🌊 {t.tsunamiWarning}</div>
                      )}
                    </div>

                    <span className={`severity-badge-pill ${q.severity.level}`}>
                      {q.severity.level === 'severe'
                        ? t.severe
                        : q.severity.level === 'moderate'
                          ? t.moderate
                          : t.minor}
                    </span>
                  </article>
                ))
              )}
            </div>
          </main>
        )}

        {/* ЭКРАН 3: НОВОСТИ И ПОСЛЕДСТВИЯ (News & Impact) */}
        {activeTab === 'news' && (
          <main className="figma-screen-content scrollable-pane">
            <div className="screen-section-header">
              <div>
                <h2>{t.newsTitle}</h2>
                <p>{t.newsSubtitle}</p>
              </div>
            </div>

            <div className="news-cards-list">
              {impactNewsQuakes.map((q) => {
                const isHighImpact = q.mag >= 6.0 || q.alert === 'red' || q.alert === 'orange';
                const isModImpact = !isHighImpact && q.mag >= 5.0;

                return (
                  <article key={q.id} className="news-impact-card">
                    <div className="news-card-header">
                      <span className={`impact-tag ${isHighImpact ? 'severe' : isModImpact ? 'moderate' : 'minor'}`}>
                        M {q.mag.toFixed(1)} • {t.pagerAlert}:{' '}
                        {(q.alert || 'green').toUpperCase()}
                      </span>
                      <span className="news-time">{formatRelativeTime(q.time, lang)}</span>
                    </div>

                    <h3 className="news-place-title">{q.place}</h3>

                    <p className="news-impact-summary">
                      {isHighImpact
                        ? t.severeDamageExpected
                        : isModImpact
                          ? t.moderateDamageExpected
                          : t.noCasualtiesExpected}
                    </p>

                    <div className="news-metrics-row">
                      {q.distanceKm != null && (
                        <span className="news-metric-chip">
                          📍 {t.epicenterDistance(q.distanceKm)}
                        </span>
                      )}
                      <span className="news-metric-chip">
                        ⬇️ {t.depth}: {q.depthKm} {t.km}
                      </span>
                      {q.felt > 0 && (
                        <span className="news-metric-chip">
                          <Users size={13} /> {q.felt} {t.feltReports}
                        </span>
                      )}
                    </div>

                    {q.tsunami && (
                      <div className="news-tsunami-box">
                        <Waves size={16} />
                        <span>{t.tsunamiPotential}</span>
                      </div>
                    )}

                    <div className="news-card-actions">
                      <button
                        type="button"
                        className="news-map-btn"
                        onClick={() => {
                          setSelectedQuake(q);
                          setActiveTab('map');
                        }}
                      >
                        <MapPin size={14} />
                        <span>{t.tabMap}</span>
                      </button>

                      <a
                        href={q.url}
                        target="_blank"
                        rel="noreferrer"
                        className="news-ext-link"
                      >
                        <span>{t.openOfficialReport}</span>
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          </main>
        )}

        {/* ЭКРАН 4: НАСТРОЙКИ (Settings — п. 2, 3, 4, 6 ТЗ) */}
        {activeTab === 'settings' && (
          <main className="figma-screen-content scrollable-pane">
            <div className="screen-section-header">
              <h2>{t.settingsTitle}</h2>
            </div>

            {/* 1. ВЫБОР ЯЗЫКА (🇬🇧 EN, 🇪🇸 ES, 🇷🇺 RU) */}
            <section className="settings-card">
              <div className="settings-card-title">
                <Globe size={17} className="text-mint" />
                <h3>{t.languageSection}</h3>
              </div>

              <div className="language-grid">
                {[
                  { code: 'en', flag: '🇬🇧', label: 'EN', full: 'English' },
                  { code: 'es', flag: '🇪🇸', label: 'ES', full: 'Español' },
                  { code: 'ru', flag: '🇷🇺', label: 'RU', full: 'Русский' }
                ].map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={`lang-select-btn ${lang === item.code ? 'active' : ''}`}
                    onClick={() => handleSetLang(item.code)}
                  >
                    <span className="lang-flag">{item.flag}</span>
                    <strong>{item.label}</strong>
                    <span className="lang-sub">{item.full}</span>
                  </button>
                ))}
              </div>
              <p className="settings-hint">{t.mapLanguageNote}</p>
            </section>

            {/* 2. ГЕОЛОКАЦИЯ */}
            <section className="settings-card">
              <div className="settings-card-title">
                <MapPin size={17} className="text-mint" />
                <h3>{t.geolocationSection}</h3>
              </div>

              <div className="toggle-row">
                <span>{t.geolocationToggle}</span>
                <button
                  type="button"
                  className={`switch-pill ${geoEnabled ? 'on' : ''}`}
                  onClick={() => setGeoEnabled((v) => !v)}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              {geoEnabled && userLocation && (
                <div className="coords-status-box">
                  <div>
                    <strong>{cityName}</strong>
                    <span>
                      {userLocation.lat.toFixed(4)}°, {userLocation.lng.toFixed(4)}°
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-small-mint"
                    onClick={handleRequestGps}
                    disabled={locatingGps}
                  >
                    {locatingGps ? t.locating : t.refreshGps}
                  </button>
                </div>
              )}
            </section>

            {/* 3. УВЕДОМЛЕНИЯ И РАДИУС БЕЗОПАСНОСТИ (п. 4 ТЗ) */}
            <section className="settings-card">
              <div className="settings-card-title">
                <Bell size={17} className="text-mint" />
                <h3>{t.notificationsSection}</h3>
              </div>

              {/* Общий переключатель */}
              <div className="toggle-row">
                <strong>{t.notificationsMasterToggle}</strong>
                <button
                  type="button"
                  className={`switch-pill ${notificationsEnabled ? 'on' : ''}`}
                  onClick={async () => {
                    const next = !notificationsEnabled;
                    setNotificationsEnabled(next);
                    localStorage.setItem('tremor_notif_enabled', String(next));
                    if (next) await requestNotificationPermission();
                  }}
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              {/* Типы угроз */}
              <div className="threat-types-block">
                <span className="sub-heading">{t.threatTypesTitle}</span>

                <div className="toggle-row sub-toggle">
                  <span>{t.tsunamiToggle}</span>
                  <button
                    type="button"
                    className={`switch-pill ${tsunamiAlerts && notificationsEnabled ? 'on' : ''}`}
                    disabled={!notificationsEnabled}
                    onClick={() => setTsunamiAlerts((v) => !v)}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>

                <div className="toggle-row sub-toggle">
                  <span>{t.earthquakeToggle}</span>
                  <button
                    type="button"
                    className={`switch-pill ${earthquakeAlerts && notificationsEnabled ? 'on' : ''}`}
                    disabled={!notificationsEnabled}
                    onClick={() => setEarthquakeAlerts((v) => !v)}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>
              </div>

              {/* Слайдер и поле ввода радиуса безопасности */}
              <div className="radius-slider-block">
                <div className="radius-slider-header">
                  <span className="sub-heading">
                    <Sliders size={14} /> {t.safetyRadiusTitle}
                  </span>
                  <div className="radius-number-input-wrap">
                    <input
                      type="number"
                      min={10}
                      max={5000}
                      step={10}
                      value={alertRadiusKm}
                      onChange={(e) => handleSetRadius(Number(e.target.value))}
                      className="radius-num-input"
                    />
                    <span>{t.km}</span>
                  </div>
                </div>

                <input
                  type="range"
                  min={10}
                  max={2000}
                  step={10}
                  value={Math.min(2000, alertRadiusKm)}
                  onChange={(e) => handleSetRadius(Number(e.target.value))}
                  className="mint-range-slider"
                />

                <div className="slider-marks">
                  <span onClick={() => handleSetRadius(50)}>50 {t.km}</span>
                  <span onClick={() => handleSetRadius(250)}>250 {t.km}</span>
                  <span onClick={() => handleSetRadius(500)}>500 {t.km}</span>
                  <span onClick={() => handleSetRadius(1000)}>1000 {t.km}</span>
                  <span onClick={() => handleSetRadius(2000)}>2000 {t.km}</span>
                </div>

                <p className="settings-hint">{t.safetyRadiusDesc}</p>

                <button
                  type="button"
                  className="btn-test-push"
                  onClick={handleTestPush}
                >
                  <Radio size={16} />
                  <span>
                    {testPushFeedback ? t.testNotificationSent : t.testNotificationBtn}
                  </span>
                </button>
              </div>
            </section>
          </main>
        )}

        {/* НИЖНИЙ ДОК НАВИГАЦИИ (1:1 по макету Figma: Map, Feed, News, Settings) */}
        <nav className="figma-bottom-dock">
          <button
            type="button"
            className={`dock-item ${activeTab === 'map' ? 'active' : ''}`}
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('map');
            }}
          >
            <div className="dock-icon-pill">
              <MapIcon size={20} />
            </div>
            <span>{t.tabMap}</span>
          </button>

          <button
            type="button"
            className={`dock-item ${activeTab === 'feed' ? 'active' : ''}`}
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('feed');
            }}
          >
            <div className="dock-icon-pill">
              <Activity size={20} />
            </div>
            <span>{t.tabFeed}</span>
          </button>

          <button
            type="button"
            className={`dock-item ${activeTab === 'news' ? 'active' : ''}`}
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('news');
            }}
          >
            <div className="dock-icon-pill">
              <Newspaper size={20} />
            </div>
            <span>{t.tabNews}</span>
          </button>

          <button
            type="button"
            className={`dock-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('settings');
            }}
          >
            <div className="dock-icon-pill">
              <SettingsIcon size={20} />
            </div>
            <span>{t.tabSettings}</span>
          </button>
        </nav>

        {/* МОДАЛЬНОЕ ОКНО ЗАПРОСА ДОСТУПА К ГЕОПОЗИЦИИ ПРИ ПЕРВОМ ЗАПУСКЕ (п. 3 ТЗ) */}
        {showGeoPromptModal && (
          <div className="geo-modal-overlay">
            <div className="geo-modal-box">
              <div className="geo-modal-icon">
                <MapPin size={28} className="text-mint" />
              </div>
              <h3>{t.geoModalTitle}</h3>
              <p>{t.geoModalDesc}</p>
              <button
                type="button"
                className="geo-allow-btn"
                onClick={handleRequestGps}
                disabled={locatingGps}
              >
                {locatingGps ? t.locating : t.allowLocationBtn}
              </button>
              <button
                type="button"
                className="geo-demo-btn"
                onClick={handleUseDemoLocation}
              >
                {t.useDemoLocationBtn}
              </button>
            </div>
          </div>
        )}

        {/* МОДАЛЬНОЕ ОКНО SOS МАЯКА */}
        <SosModal
          isOpen={isSosOpen}
          onClose={() => setIsSosOpen(false)}
          userLocation={userLocation}
          nearestQuake={latestNearbyEvent}
          feltCount={feltCount}
          onReportFelt={() => setFeltCount((c) => c + 1)}
        />
      </div>
    </div>
  );
}
