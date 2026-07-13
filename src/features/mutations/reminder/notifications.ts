import { getMutationAction, getMutationMessage, getWeatherEmoji } from './weather';
import type { PlantData, WeatherType } from './types';

export function showMutationNotification(plants: PlantData[], weather: WeatherType): void {
  const message = getMutationMessage(plants, weather);

  showSimpleNotification(
    `${getWeatherEmoji(weather)} ${weather.toUpperCase()} Weather!`,
    `Place ${plants.length} plant${plants.length > 1 ? 's' : ''} ${getMutationAction(weather)}`,
    'success'
  );
}

export function showSimpleNotification(title: string, message: string, type: 'success' | 'info' | 'warning' = 'info'): void {
  const colors = {
    success: 'rgba(76, 175, 80, 0.95)',
    info: 'rgba(33, 150, 243, 0.95)',
    warning: 'rgba(255, 152, 0, 0.95)',
  };

  const existingNotifications = document.querySelectorAll('.quinoa-notification');
  let topOffset = 20;
  existingNotifications.forEach((notif: Element) => {
    const rect = (notif as HTMLElement).getBoundingClientRect();
    topOffset = Math.max(topOffset, rect.bottom - document.documentElement.getBoundingClientRect().top + 10);
  });

  const notification = document.createElement('div');
  notification.classList.add('quinoa-notification');
  notification.style.cssText = `
    position: fixed;
    top: ${topOffset}px;
    right: 20px;
    background: ${colors[type]};
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    font-family: Arial, sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 999999;
    max-width: 320px;
    animation: slideInRight 0.3s ease-out;
  `;

  notification.innerHTML = '';
  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'font-size: 16px; font-weight: bold; margin-bottom: 4px;';
  titleDiv.textContent = title;
  const msgDiv = document.createElement('div');
  msgDiv.style.cssText = 'font-size: 13px; opacity: 0.95;';
  msgDiv.textContent = message;
  notification.append(titleDiv, msgDiv);

  if (!document.getElementById('quinoa-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'quinoa-notification-styles';
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => {
      notification.remove();
      repositionNotifications();
    }, 300);
  }, 6000);
}

function repositionNotifications(): void {
  const notifications = document.querySelectorAll('.quinoa-notification');
  let topOffset = 20;
  notifications.forEach((notif: Element) => {
    (notif as HTMLElement).style.top = `${topOffset}px`;
    const rect = (notif as HTMLElement).getBoundingClientRect();
    topOffset = rect.bottom - document.documentElement.getBoundingClientRect().top + 10;
  });
}
