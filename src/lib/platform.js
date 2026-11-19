import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';

const TG_BOT_TOKEN = '9272896323:AAEaDtn3nE32bE-iYOhxHpOhAc-dllyiQPQ';

// Единый разблокированный AudioContext для iOS (Safari / PWA / Telegram WebView)
let sharedAudioCtx = null;

function getOrUnlockAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// Авто-разблокировка звука на iPhone при первом касании экрана
if (typeof window !== 'undefined') {
  const unlockHandler = () => {
    const ctx = getOrUnlockAudioContext();
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('touchstart', unlockHandler);
      window.removeEventListener('click', unlockHandler);
    }
  };
  window.addEventListener('touchstart', unlockHandler, { passive: true });
  window.addEventListener('click', unlockHandler, { passive: true });
}

export function detectPlatform() {
  if (typeof window !== 'undefined') {
    const tg = window.Telegram?.WebApp;
    if (tg && (tg.initData?.length > 0 || tg.platform !== 'unknown')) {
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

/**
 * Мощная кроссплатформенная вибрация:
 * - В Telegram Mini App (на iPhone и Android) использует нативный Taptic Engine через HapticFeedback (без проверки initData!)
 * - На Android (Web / PWA) использует длинную серию виброимпульсов navigator.vibrate
 * - В нативном приложении (App Store / Google Play) использует Capacitor Haptics
 */
export async function triggerHaptic(type = 'impact') {
  try {
    const tg = window.Telegram?.WebApp;
    if (tg?.HapticFeedback) {
      if (type === 'danger' || type === 'error') {
        // Серия из 6 мощных виброударов Taptic Engine на iPhone / Android (длительность ~1.3 сек)
        tg.HapticFeedback.notificationOccurred('error');
        [180, 360, 560, 760, 980, 1200].forEach((delayMs, idx) => {
          setTimeout(() => {
            try {
              if (idx % 2 === 0) {
                tg.HapticFeedback.impactOccurred('heavy');
              } else {
                tg.HapticFeedback.notificationOccurred('error');
              }
            } catch {
              // ignore
            }
          }, delayMs);
        });
      } else if (type === 'warning') {
        tg.HapticFeedback.notificationOccurred('warning');
        setTimeout(() => {
          try {
            tg.HapticFeedback.impactOccurred('rigid');
          } catch {
            // ignore
          }
        }, 160);
      } else if (type === 'selection') {
        tg.HapticFeedback.selectionChanged();
      } else {
        tg.HapticFeedback.impactOccurred('medium');
      }
    }

    if (Capacitor.isNativePlatform()) {
      if (type === 'danger' || type === 'error') {
        await Haptics.notification({ type: NotificationType.Error });
        setTimeout(() => Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {}), 220);
        setTimeout(() => Haptics.notification({ type: NotificationType.Error }).catch(() => {}), 460);
      } else if (type === 'warning') {
        await Haptics.notification({ type: NotificationType.Warning });
      } else {
        await Haptics.impact({ style: ImpactStyle.Medium });
      }
    }

    if (navigator.vibrate) {
      if (type === 'danger' || type === 'error') {
        navigator.vibrate([400, 120, 400, 120, 500, 120, 600]);
      } else if (type === 'warning') {
        navigator.vibrate([180, 80, 180]);
      } else {
        navigator.vibrate(35);
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

export async function requestNotificationPermission() {
  try {
    getOrUnlockAudioContext();
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

/**
 * Громкий двухтональный сигнал сейсмической тревоги (1.4 секунды, 6 импульсов)
 * Работает в Telegram Mini App, PWA и любом браузере на iPhone / Android / ПК без внешних MP3.
 */
export function playAlertBeep() {
  try {
    const ctx = getOrUnlockAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime + 0.02;

    // 6 громких тревожных импульсов (чередование 940 Гц и 1360 Гц)
    const pulses = [940, 1360, 940, 1360, 940, 1360];
    pulses.forEach((freq, i) => {
      const start = now + i * 0.21;
      const duration = 0.16;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.01, start);
      gain.gain.exponentialRampToValueAtTime(0.55, start + 0.02);
      gain.gain.setValueAtTime(0.55, start + duration - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    });
  } catch {
    // ignore audio restriction
  }
}

/**
 * Отправка реального системного пуш-сообщения со звуком и вибрацией через бота @TremorSOS_bot,
 * если пользователь открыл приложение внутри Telegram
 */
async function sendTelegramBotPush(title, body) {
  try {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!tgUser?.id) return false;

    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgUser.id,
        text: `${title}\n\n${body}`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🗺 Открыть радар TREMOR SOS',
                web_app: { url: 'https://arkanumsport-create.github.io/TREMOR-SOS/' }
              }
            ]
          ]
        }
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendSeismicPushNotification({ title, body }) {
  // 1. Сразу запускаем серию виброударов + громкую звуковую сирену тревоги внутри приложения
  triggerHaptic('danger');
  playAlertBeep();

  // 2. Если запущено в Telegram — параллельно шлём пуш от @TremorSOS_bot (даёт системный звук и вибрацию iOS/Android)
  sendTelegramBotPush(title, body);

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
          vibrate: [400, 120, 400, 120, 600],
          tag: 'tremor-sos-push-' + Date.now()
        };

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
  if (tg && tg.openTelegramLink) {
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
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
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
      gain.gain.exponentialRampToValueAtTime(0.55, offset + 0.02);
      gain.gain.setValueAtTime(0.55, offset + duration - 0.02);
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
