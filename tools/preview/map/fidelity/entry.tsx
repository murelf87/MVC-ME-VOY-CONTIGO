// Banco de pruebas del mapa: renderiza MvcMap (la misma implementación que usa la app) con el sustituto web de react-native-maps.
// Parámetros de la URL: ?scene=<id> (ver scenes.tsx) o ?free=1&w=..&h=..&lat=..&lng=..&z=..
import React from 'react';
// El espacio de trabajo móvil no instala @types/react-dom (solo lo usa este banco; esbuild no comprueba tipos): sin la directiva, tsc daría TS7016.
// @ts-ignore
import { createRoot } from 'react-dom/client';
import { SceneView } from './scenes';

const params = new URLSearchParams(window.location.search);
const root = document.getElementById('root');
if (root) createRoot(root).render(<SceneView params={params} />);
