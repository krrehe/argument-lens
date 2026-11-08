import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './styles-usage.css';
import './styles-disputes.css';
import './styles-theory.css';
import './styles-flow.css';
import './styles-history.css';
import './styles-sideby.css';
import './styles-tone.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
