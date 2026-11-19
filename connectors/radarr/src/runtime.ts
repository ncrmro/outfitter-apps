import { version } from '../package.json';
import { createMediaConnector, type MediaTransport } from '@ncrmro/connector-media-core';
export const createRadarrConnector = (transport: MediaTransport = {}) => createMediaConnector('radarr', transport, version);
export const radarrConnector = createRadarrConnector();
