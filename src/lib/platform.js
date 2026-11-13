import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';

export function detectPlatform() {
  if (typeof window !== 'undefined') {
    const tg = window.Telegram?.WebApp;
    if (tg && tg.initData && tg.initData.length > 0) {
      return 'telegram';
    }
    if (Capacitor.isNativePlatform()) {
      return 'native';
    }
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator?.standalone === true;
    if (isStandalone) {
      return 'pwa';
    }
  }
  return 'web';
}

export function initTelegramMiniApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return null;
  try {
    tg.ready();
    tg.expand();
    // Подстраиваем цвет системной шапки Telegram под цветовую схему клиента (light/dark),
    // чтобы на iOS иконки закрытия (X) и меню (...) внутри кружков всегда были контрастными и видимыми
    if (tg.setHeaderColor) {
      tg.setHeaderColor(tg.colorScheme === 'light' ? 'bg_color' : 'secondary_bg_color');
    }
    if (tg.setBackgroundColor) {
      tg.setBackgroundColor('#0b1416');
    }
  } catch (err) {
    console.warn('Telegram WebApp init warning:', err);
  }
  return tg;
}

export async function triggerHaptic(type = 'impact') {
  try {
    const tg = window.Telegram?.WebApp;
    if (tg?.HapticFeedback && tg.initData) {
      if (type === 'danger' || type === 'error') {
        tg.HapticFeedback.notificationOccurred('error');
      } else if (type === 'warning') {
        tg.HapticFeedback.notificationOccurred('warning');
      } else if (type === 'selection') {
        tg.HapticFeedback.selectionChanged();
      } else {
        tg.HapticFeedback.impactOccurred('medium');
      }
      return;
    }

    if (Capacitor.isNativePlatform()) {
      if (type === 'danger' || type === 'error') {
        await Haptics.notification({ type: NotificationType.Error });
      } else if (type === 'warning') {
        await Haptics.notification({ type: NotificationType.Warning });
      } else {
        await Haptics.impact({ style: ImpactStyle.Medium });
      }
      return;
    }

    if (navigator.vibrate) {
      if (type === 'danger') {
        navigator.vibrate([200, 100, 200, 100, 300]);
      } else if (type === 'warning') {
        navigator.vibrate([120, 60, 120]);
      } else {
        navigator.vibrate(25);
      }
    }
  } catch {
    // Ignore on devices without vibration hardware
  }
}

export async function getUserLocation() {
  if (Capacitor.isNativePlatform()) {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy || 0)
    };
  }

  return await new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 0)
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

/**
 * Запрос разрешения и отправка Push / системного уведомления с точным расстоянием по прямой
 */
export async function requestNotificationPermission() {
  try {
    if (Capacitor.isNativePlatform()) {
      const perm = await LocalNotifications.requestPermissions();
      return perm.display === 'granted';
    }
    if ('Notification' in window) {
      if (Notification.permission === 'granted') return true;
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }
  } catch {
    // Ignore
  }
  return false;
}

export function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.01, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.28, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.13);
    });

    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    // ignore audio restriction
  }
}

export async function sendSeismicPushNotification({ title, body }) {
  triggerHaptic('danger');
  playAlertBeep();

  try {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 100000),
            title,
            body,
            schedule: { at: new Date(Date.now() + 200) }
          }
        ]
      });
      return true;
    }

    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      if (Notification.permission === 'granted') {
        const options = {
          body,
          icon: './pwa-192x192.png',
          badge: './pwa-192x192.png',
          vibrate: [200, 100, 200],
          tag: 'tremor-sos-push-' + Date.now()
        };

        // В PWA и мобильных браузерах требуется вызов через ServiceWorkerRegistration
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && typeof reg.showNotification === 'function') {
            await reg.showNotification(title, options);
            return true;
          }
        }

        new Notification(title, options);
        return true;
      }
    }
  } catch {
    // Fallback to in-app push banner
  }
  return false;
}

export async function shareEmergencyMessage({ status, userLocation, nearestQuake }) {
  const coordsText = userLocation
    ? `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`
    : 'Unknown coordinates';
  const mapsUrl = userLocation
    ? `https://maps.google.com/?q=${userLocation.lat},${userLocation.lng}`
    : '';

  const quakeLine = nearestQuake
    ? `\nNearest Tremor: M${nearestQuake.mag.toFixed(1)} — ${nearestQuake.place} (${nearestQuake.distanceKm ?? '?'} km)`
    : '';

  const text =
    status === 'sos'
      ? `🆘 [TREMOR SOS] I NEED HELP!\nMy coordinates: ${coordsText}${quakeLine}\nMap: ${mapsUrl}`
      : status === 'felt'
        ? `⚠️ [TREMOR SOS] I felt an earthquake!\nLocation: ${coordsText}${quakeLine}\nMap: ${mapsUrl}`
        : `✅ [TREMOR SOS] I am safe.\nMy coordinates: ${coordsText}${quakeLine}`;

  const tg = window.Telegram?.WebApp;
  if (tg && tg.initData && tg.openTelegramLink) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(mapsUrl || 'https://earthquake.usgs.gov')}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink(shareUrl);
    return { method: 'telegram', text };
  }

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'TREMOR SOS — Emergency Alert',
        text,
        url: mapsUrl || window.location.href
      });
      return { method: 'webshare', text };
    } catch {
      // User dismissed share sheet
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return { method: 'clipboard', text };
  }

  return { method: 'fallback', text };
}

export class SosAudioBeacon {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.timerId = null;
  }

  start() {
    if (this.isPlaying) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.isPlaying = true;
    this._scheduleLoop();
  }

  _scheduleLoop() {
    if (!this.isPlaying || !this.ctx) return;

    const unit = 0.14;
    const pattern = [
      unit, unit, unit,
      unit * 3, unit * 3, unit * 3,
      unit, unit, unit
    ];

    let offset = this.ctx.currentTime + 0.05;

    pattern.forEach((duration, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(idx >= 3 && idx <= 5 ? 1180 : 960, offset);

      gain.gain.setValueAtTime(0.01, offset);
      gain.gain.exponentialRampToValueAtTime(0.35, offset + 0.02);
      gain.gain.setValueAtTime(0.35, offset + duration - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, offset + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(offset);
      osc.stop(offset + duration);

      const gap = idx === 2 || idx === 5 ? unit * 2.5 : unit * 1.1;
      offset += duration + gap;
    });

    const totalMs = (offset - this.ctx.currentTime + 0.6) * 1000;
    this.timerId = setTimeout(() => this._scheduleLoop(), totalMs);
  }

  stop() {
    this.isPlaying = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
