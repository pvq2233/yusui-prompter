import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Presenter from './Presenter';
import './style.css';
if (window.yusuiDesktop) document.documentElement.classList.add('desktop-app');
const presenter = new URLSearchParams(location.search).get('view') === 'presenter';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{presenter ? <Presenter /> : <App />}</React.StrictMode>);
