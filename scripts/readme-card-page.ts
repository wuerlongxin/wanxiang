import '../src/styles.css';

import { renderReadmeCard } from './readme-card-renderer';
import type { GameModeId } from '../src/types';

const modes = new Set<GameModeId>(['reflex', 'memory', 'strategy', 'expression', 'mischief']);
const requestedMode = new URLSearchParams(window.location.search).get('mode');
const mode = modes.has(requestedMode as GameModeId)
  ? requestedMode as GameModeId
  : 'strategy';

void document.fonts.ready.then(() => renderReadmeCard(mode));
