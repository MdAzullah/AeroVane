import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FileSource, PMTiles, Protocol, TileType } from 'pmtiles';

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const mapApi = { maplibregl, protocol, PMTiles, FileSource, TileType };
(window as any).AeroVaneMap = mapApi;
(window as any).AeroVaneMap = mapApi;
