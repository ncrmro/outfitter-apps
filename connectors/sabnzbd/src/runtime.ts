import { version } from '../package.json';
import { createMediaConnector, type MediaTransport } from '@ncrmro/connector-media-core';
export const createSabnzbdConnector = (transport: MediaTransport = {}) => createMediaConnector('sabnzbd', transport, version);
export const sabnzbdConnector = createSabnzbdConnector();
