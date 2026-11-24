import { startApp } from './app';
import { t } from './i18n';
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('index.html has no #app');
document.title = t('app.title');
startApp(root);
