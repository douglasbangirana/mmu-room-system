import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

try { document.documentElement.dataset.theme = localStorage.getItem('mmu_theme2') || 'light'; } catch { document.documentElement.dataset.theme = 'light'; }

createRoot(document.getElementById('root')).render(<App />);
