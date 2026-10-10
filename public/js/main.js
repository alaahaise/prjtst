import { createApp } from 'vue';
import App from './App.js';
import { router } from './router.js';
import SvgIcon from './icons.js';

const app = createApp(App);
app.component('SvgIcon', SvgIcon);
app.use(router);
app.mount('#app');
