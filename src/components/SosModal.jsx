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

export default function SosModal({
  isOpen,
  onClose,
  userLocation,
  nearestQuake,
  onReportFelt,
  feltCount,
  t
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

  if (!isOpen || !t) return null;

  const safetyTabs = [
    { id: 'indoors', title: t.safetyIndoors, steps: t.safetyStepsIndoors || [] },
    { id: 'outdoors', title: t.safetyOutdoors, steps: t.safetyStepsOutdoors || [] },
    { id: 'trapped', title: t.safetyTrapped, steps: t.safetyStepsTrapped || [] }
  ];

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
      setShareFeedback(t.copiedClipboard);
    } else if (result.method === 'telegram') {
      setShareFeedback(t.openedTelegram);
    } else {
      setShareFeedback(t.readyToShare);
    }
    setTimeout(() => setShareFeedback(''), 4000);
  };

  return (
    <div className={`sos-modal-backdrop ${isStrobeActive ? 'strobe-flash' : ''}`}>
      <div className="sos-modal-card">
        <div className="sos-modal-header">
          <div className="sos-header-title">
            <AlertTriangle size={22} className="text-danger" />
            <span>{t.sosModalTitle}</span>
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
              <strong>{isSirenActive ? t.sirenStop : t.sirenStart}</strong>
              <span>{t.sirenSub}</span>
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
            <span>{isStrobeActive ? t.strobeStop : t.strobeStart}</span>
          </button>
        </div>

        {/* Быстрая отправка координат близким / в Telegram */}
        <div className="sos-share-section">
          <h4>{t.shareStatusHeading}</h4>
          <div className="sos-share-buttons">
            <button
              type="button"
              className="status-btn status-sos"
              onClick={() => handleShareStatus('sos')}
            >
              <Share2 size={18} />
              <span>{t.btnNeedHelp}</span>
            </button>

            <button
              type="button"
              className="status-btn status-safe"
              onClick={() => handleShareStatus('safe')}
            >
              <ShieldCheck size={18} />
              <span>{t.btnImSafe}</span>
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
              {t.btnIFeltIt} {feltCount > 0 ? `(${t.reportsCount}: ${feltCount})` : ''}
            </span>
          </button>

          {userLocation && (
            <div className="gps-readout">
              <Navigation size={14} />
              <span>
                {t.yourGpsCoords}: <b>{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}</b>
                {userLocation.accuracy ? ` (±${userLocation.accuracy} m)` : ''}
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
            {safetyTabs.map((tab) => (
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
            {safetyTabs.find((item) => item.id === activeSafetyTab)?.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
