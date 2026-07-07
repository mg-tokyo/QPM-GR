// src/ui/sections/aboutWindow.ts

import { t } from '../../i18n';
import { getCurrentVersion } from '../../utils/versionChecker';
import { openExternalUrl } from '../hub/groups/toolsGroup';
import { openNativeCard, type OpenNativeCardOptions } from '../../integrations/nativeCardView';
import { TOKYO_CARD_PREVIEW_URL, TOKYO_CARD_VIDEO_URL } from '../../data/tokyoCard';
import { BUILT_IN_PRESETS } from '../../data/customCardPresets';

const SPONSORS_URL = 'https://github.com/sponsors/mg-tokyo';
const KOFI_URL = 'https://ko-fi.com/mgtokyo';
const FLAG_AU_URL = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1e6-1f1fa.svg';

const HEART_SVG = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 14s-5.5-3.5-5.5-7.5C2.5 4 4.5 2.5 6 2.5c1 0 1.8.6 2 1.5.2-.9 1-1.5 2-1.5 1.5 0 3.5 1.5 3.5 4S8 14 8 14Z"/></svg>`;
const KOFI_SVG = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 5.5h8v5A2.5 2.5 0 0 1 7.5 13h-3A2.5 2.5 0 0 1 2 10.5v-5Zm8 1h1.5a2 2 0 1 1 0 4H10v-1.5h1.25a.75.75 0 0 0 0-1.5H10v-1Z"/></svg>`;

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

  const kofiBtn = document.createElement('button');
  kofiBtn.type = 'button';
  kofiBtn.className = 'qpm-about__kofi-btn';
  kofiBtn.title = t('about.kofiTooltip');
  kofiBtn.innerHTML = KOFI_SVG;
  kofiBtn.addEventListener('click', () => {
    kofiBtn.classList.add('qpm-about__kofi-btn--pop');
    openExternalUrl(KOFI_URL);
  });
  kofiBtn.addEventListener('animationend', () => {
    kofiBtn.classList.remove('qpm-about__kofi-btn--pop');
  });

  sponsorRow.append(sponsorText, heartBtn, kofiBtn);

  // Clickable TOKYO card thumbnail — opens the native in-game card view.
  const tokyoCard = document.createElement('button');
  tokyoCard.type = 'button';
  tokyoCard.className = 'qpm-about__tokyo-card';
  tokyoCard.title = "Click to view Tokyo's card";

  // Animated preview — same WebM the in-game card uses. Falls back to the PNG poster
  // if the video can't autoplay (strict browser policies) or fails to load.
  const tokyoVideo = document.createElement('video');
  tokyoVideo.src = TOKYO_CARD_VIDEO_URL;
  tokyoVideo.poster = TOKYO_CARD_PREVIEW_URL;
  tokyoVideo.autoplay = true;
  tokyoVideo.loop = true;
  tokyoVideo.muted = true;
  tokyoVideo.playsInline = true;
  tokyoVideo.preload = 'auto';
  tokyoVideo.crossOrigin = 'anonymous';
  tokyoVideo.draggable = false;
  tokyoCard.appendChild(tokyoVideo);

  // Route through the Custom Cards built-in preset registry rather than the
  // raw TOKYO_CARD constants. The thumbnail above still uses the URL constants
  // directly because it's an HTML <video>, not a phantom-item open.
  tokyoCard.addEventListener('click', () => {
    const tokyoPreset = BUILT_IN_PRESETS.find((p) => p.id === 'qpm-builtin-tokyo');
    if (!tokyoPreset) return;
    const options: OpenNativeCardOptions = {
      fullTakeover: !!tokyoPreset.fullTakeover,
    };
    if (tokyoPreset.videoUrl) options.videoUrl = tokyoPreset.videoUrl;
    if (tokyoPreset.portraitUrl) options.portraitUrl = tokyoPreset.portraitUrl;
    void openNativeCard(tokyoPreset.item, options);
  });

  root.append(titleRow, author, tokyoCard, sponsorRow);
}
