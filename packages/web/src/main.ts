import type { ServerMessage, TimeView } from '@cafe/core';
import { t } from './i18n';
import { connect, type ConnectionStatus } from './net/connection';
import { socketUrl } from './net/url';
import './style.css';

const app = document.getElementById('app');
if (!app) throw new Error('index.html has no #app');

app.innerHTML = `
  <h1></h1>
  <div class="status-strip">
    <span class="dot"></span><span id="conn"></span>
    <strong id="clock"></strong>
  </div>`;
const heading = app.querySelector('h1') as HTMLElement;
const dot = app.querySelector('.dot') as HTMLElement;
const conn = document.getElementById('conn') as HTMLElement;
const clock = document.getElementById('clock') as HTMLElement;
heading.textContent = t('app.title');
document.title = t('app.title');

function showStatus(status: ConnectionStatus): void {
  dot.className = `dot ${status}`;
  conn.textContent = t(`status.${status}`);
}

function showTime(time: TimeView): void {
  const pace = time.paused ? t('clock.paused') : `${t('clock.speed')} ${time.speed}x`;
  clock.textContent = `${t('clock.day')} ${time.day}, ${time.clock} · ${pace}`;
}

function onMessage(message: ServerMessage): void {
  if (message.kind === 'snapshot') showTime(message.snapshot.time);
  if (message.kind === 'clock') showTime(message.time);
}

connect(socketUrl(window.location), { onMessage, onStatus: showStatus });
