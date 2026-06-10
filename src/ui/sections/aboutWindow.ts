// src/ui/sections/aboutWindow.ts

import { t } from '../../i18n';
import { getCurrentVersion } from '../../utils/versionChecker';
import { openExternalUrl } from '../hub/groups/toolsGroup';

const SPONSORS_URL = 'https://github.com/sponsors/mg-tokyo';
const FLAG_AU_URL = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1e6-1f1fa.svg';

const HEART_SVG = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 14s-5.5-3.5-5.5-7.5C2.5 4 4.5 2.5 6 2.5c1 0 1.8.6 2 1.5.2-.9 1-1.5 2-1.5 1.5 0 3.5 1.5 3.5 4S8 14 8 14Z"/></svg>`;

export function renderAboutContent(root: HTMLElement): void {
  root.className = 'qpm-about';

  // Title line: QPM v3.x.x
  const titleRow = document.createElement('div');
  titleRow.className = 'qpm-about__title';

  const title = document.createElement('span');
  title.textContent = t('about.title');
  titleRow.appendChild(title);

  const version = document.createElement('span');
  version.className = 'qpm-about__version';
  version.textContent = `v${getCurrentVersion()}`;
  titleRow.appendChild(version);

  // Author line
  const author = document.createElement('div');
  author.className = 'qpm-about__author';
  author.appendChild(document.createTextNode(t('about.author') + ' '));
  const flag = document.createElement('img');
  flag.src = FLAG_AU_URL;
  flag.alt = '🇦🇺';
  flag.width = 16;
  flag.height = 16;
  flag.style.cssText = 'display: inline; vertical-align: -2px;';
  flag.draggable = false;
  author.appendChild(flag);

  // Sponsor line: text + heart button
  const sponsorRow = document.createElement('div');
  sponsorRow.className = 'qpm-about__sponsor-row';

  const sponsorText = document.createElement('span');
  sponsorText.className = 'qpm-about__sponsor-text';

  // Split the text to color "QPM" in accent
  const fullText = t('about.sponsorText');
  const qpmIndex = fullText.indexOf('QPM');
  if (qpmIndex !== -1) {
    sponsorText.appendChild(document.createTextNode(fullText.slice(0, qpmIndex)));
    const accent = document.createElement('span');
    accent.className = 'qpm-about__sponsor-accent';
    accent.textContent = 'QPM';
    sponsorText.appendChild(accent);
    sponsorText.appendChild(document.createTextNode(fullText.slice(qpmIndex + 3)));
  } else {
    sponsorText.textContent = fullText;
  }

  const heartBtn = document.createElement('button');
  heartBtn.type = 'button';
  heartBtn.className = 'qpm-about__heart-btn';
  heartBtn.title = t('about.sponsorTooltip');
  heartBtn.innerHTML = HEART_SVG;
  heartBtn.addEventListener('click', () => {
    heartBtn.classList.add('qpm-about__heart-btn--pop');
    openExternalUrl(SPONSORS_URL);
  });
  heartBtn.addEventListener('animationend', () => {
    heartBtn.classList.remove('qpm-about__heart-btn--pop');
  });

  sponsorRow.append(sponsorText, heartBtn);
  root.append(titleRow, author, sponsorRow);
}
