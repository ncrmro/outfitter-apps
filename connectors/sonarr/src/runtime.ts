import { version } from '../package.json';
import { createMediaConnector, type MediaTransport } from '@ncrmro/connector-media-core';
export const createSonarrConnector = (transport: MediaTransport = {}) => createMediaConnector('sonarr', transport, version);
export const sonarrConnector = createSonarrConnector();
