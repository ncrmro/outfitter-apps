import { version } from '../package.json';
import { createMediaConnector, type MediaTransport } from '@ncrmro/connector-media-core';
export const createJellyfinConnector = (transport: MediaTransport = {}) => createMediaConnector('jellyfin', transport, version);
export const jellyfinConnector = createJellyfinConnector();
