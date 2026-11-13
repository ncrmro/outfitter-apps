import { version } from '../package.json';
import { createMediaConnector, type MediaTransport } from '@ncrmro/connector-media-core';
export const createLidarrConnector = (transport: MediaTransport = {}) => createMediaConnector('lidarr', transport, version);
export const lidarrConnector = createLidarrConnector();
