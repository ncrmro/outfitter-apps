import { version } from '../package.json';
import { createMediaConnector, type MediaTransport } from '@ncrmro/connector-media-core';
export const createTransmissionConnector = (transport: MediaTransport = {}) => createMediaConnector('transmission', transport, version);
export const transmissionConnector = createTransmissionConnector();
