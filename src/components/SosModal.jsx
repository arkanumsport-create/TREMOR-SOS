import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Volume2,
  VolumeX,
  Share2,
  ShieldCheck,
  Radio,
  Flashlight,
  X,
  CheckCircle2,
  Navigation
} from 'lucide-react';
import { SosAudioBeacon, shareEmergencyMessage, triggerHaptic } from '../lib/platform';

const SAFETY_TABS = [
  {
    id: 'indoors',
    title: 'В помещении',
    steps: [
      'УПАДИТЕ на колени, УКРОЙТЕСЬ под прочным столом или у несущей стены, ДЕРЖИТЕСЬ до окончания толчков.',
      'Отойдите от окон, зеркал, люстр и высоких шкафов.',
      'НЕ пользуйтесь лифтом! Спускайтесь только по лестнице после прекращения толчков.',
      'По возможности перекройте газ, воду и отключите электричество на щитке.'
    ]
  },
  {
    id: 'outdoors',
    title: 'На улице',
    steps: [
      'Выйдите на открытое пространство подальше от зданий, линий электропередач и деревьев.',
      'Не подходите к фасадам домов — возможен обвал стёкол, карнизов и балконов.',
      'Если вы у моря и толчок сильный — немедленно поднимайтесь на возвышенность (угроза цунами).'
    ]
  },
  {
    id: 'trapped',
    title: 'Под завалом',
    steps: [
      'Включите звуковой маяк SOS выше или стучите металлическим предметом по трубам/стенам.',
      'Не зажигайте спички и зажигалки (опасность утечки газа).',
      'Прикройте рот и нос тканью от пыли, экономьте силы и кислород.'
    ]
  }
];

export default function SosModal({
  isOpen,
  onClose,
  userLocation,
  nearestQuake,
  onReportFelt,
  feltCount
}) {
  const beaconRef = useRef(null);
  const [isSirenActive, setIsSirenActive] = useState(false);
  const [isStrobeActive, setIsStrobeActive] = useState(false);
  const [shareFeedback, setShareFeedback] = useState('');
  const [activeSafetyTab, setActiveSafetyTab] = useState('indoors');

  useEffect(() => {
    beaconRef.current = new SosAudioBeacon();
    return () => {
      beaconRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!isOpen && isSirenActive) {
      beaconRef.current?.stop();
      setIsSirenActive(false);
      setIsStrobeActive(false);
    }
  }, [isOpen, isSirenActive]);

  if (!isOpen) return null;

  const toggleSiren = () => {
    triggerHaptic('danger');
    if (isSirenActive) {
      beaconRef.current?.stop();
      setIsSirenActive(false);
    } else {
      beaconRef.current?.start();
      setIsSirenActive(true);
    }
  };

  const handleShareStatus = async (status) => {
    triggerHaptic(status === 'sos' ? 'danger' : 'impact');
    const result = await shareEmergencyMessage({
      status,
      userLocation,
      nearestQuake
    });

    if (result.method === 'clipboard') {
      setShareFeedback('Экстренное сообщение с координатами скопировано в буфер обмена!');
    } else if (result.method === 'telegram') {
      setShareFeedback('Открыто окно отправки в Telegram.');
    } else {
      setShareFeedback('Статус готов к отправке.');
    }
    setTimeout(() => setShareFeedback(''), 4000);
  };

  return (
    <div className={`sos-modal-backdrop ${isStrobeActive ? 'strobe-flash' : ''}`}>
      <div className="sos-modal-card">
        <div className="sos-modal-header">
          <div className="sos-header-title">
            <AlertTriangle size={22} className="text-danger" />
            <span>ЭКСТРЕННЫЙ ЦЕНТР TREMOR SOS</span>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Блок звукового маяка и стробоскопа */}
        <div className="sos-beacon-grid">
          <button
            type="button"
            className={`siren-action-btn ${isSirenActive ? 'active' : ''}`}
            onClick={toggleSiren}
          >
            {isSirenActive ? <VolumeX size={28} /> : <Volume2 size={28} />}
            <div className="siren-btn-text">
              <strong>{isSirenActive ? 'ВЫКЛЮЧИТЬ СИРЕНУ SOS' : 'ВКЛЮЧИТЬ СИРЕНУ SOS'}</strong>
              <span>Звуковой маяк Морзе (... --- ...) для спасателей</span>
            </div>
          </button>

          <button
            type="button"
            className={`strobe-action-btn ${isStrobeActive ? 'active' : ''}`}
            onClick={() => {
              triggerHaptic('warning');
              setIsStrobeActive((prev) => !prev);
            }}
          >
            <Flashlight size={22} />
            <span>{isStrobeActive ? 'Стоп вспышка' : 'Экран-маяк'}</span>
          </button>
        </div>

        {/* Быстрая отправка координат близким / в Telegram */}
        <div className="sos-share-section">
          <h4>Отправить координаты и статус близким</h4>
          <div className="sos-share-buttons">
            <button
              type="button"
              className="status-btn status-sos"
              onClick={() => handleShareStatus('sos')}
            >
              <Share2 size={18} />
              <span>🆘 Мне нужна помощь (SOS)</span>
            </button>

            <button
              type="button"
              className="status-btn status-safe"
              onClick={() => handleShareStatus('safe')}
            >
              <ShieldCheck size={18} />
              <span>✅ Я в безопасности</span>
            </button>
          </div>

          <button
            type="button"
            className="status-btn status-felt"
            onClick={() => {
              onReportFelt();
              handleShareStatus('felt');
            }}
          >
            <Radio size={18} />
            <span>
              ⚠️ Я почувствовал толчок! {feltCount > 0 ? `(Отметок: ${feltCount})` : ''}
            </span>
          </button>

          {userLocation && (
            <div className="gps-readout">
              <Navigation size={14} />
              <span>
                Ваши GPS координаты: <b>{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}</b>
                {userLocation.accuracy ? ` (±${userLocation.accuracy} м)` : ''}
              </span>
            </div>
          )}

          {shareFeedback && (
            <div className="share-feedback-banner">
              <CheckCircle2 size={16} />
              <span>{shareFeedback}</span>
            </div>
          )}
        </div>

        {/* Памятка выживания */}
        <div className="sos-safety-guide">
          <div className="safety-tabs">
            {SAFETY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`safety-tab-btn ${activeSafetyTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveSafetyTab(tab.id)}
              >
                {tab.title}
              </button>
            ))}
          </div>
          <ul className="safety-steps-list">
            {SAFETY_TABS.find((t) => t.id === activeSafetyTab)?.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
