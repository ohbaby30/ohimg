import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
const Empty={template:'<span></span>'};
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:Empty}]});
createApp(App).use(router).mount('#app');
